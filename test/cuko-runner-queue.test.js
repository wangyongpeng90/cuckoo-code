/**
 * [261126-q7mxk2-cuko-message-queue] 运行器 + 消息队列集成测试
 * 本地假服务 + 内存数据库，跑真实的 cuko-runner 和 cuko-queue（不 mock 内部模块）。
 * 覆盖：插话随工具结果发送（两种协议）、无工具时插话继续下一轮、正常结束自动续发、
 *       停止 / 出错暂停不续发、手动发送恢复队列、续发启动失败时消息放回并暂停。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Module from 'node:module';
import os from 'node:os';

// 隔离用户目录：别读写真实的 ~/.cuckoo
process.env.CUCKOO_HOME = os.tmpdir() + '/cuko-runner-queue-test-' + process.pid;

// 外部边界替身：运行器加载链路会调用 electron app，测试环境用 Module._load 拦截
const realLoad = Module._load;
const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    on() {},
    once() {},
  },
  BrowserWindow: { fromWebContents: () => null, fromId: () => null, getAllWindows: () => [] },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  shell: { openPath: async () => '' },
  dialog: {},
};
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return realLoad.call(this, request, ...rest);
};

let startCukoRun;
let cancelCukoRun;
let subscribeCukoRuns;
let cukoQueue;
let kickCukoQueue;
let runQueueItemNow;

const FENCE = String.fromCharCode(96).repeat(3);
const TOOL_REPLY = FENCE + 'cuckoo\nlog("tool-ok")\n' + FENCE;
const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';

function sendText(res, text) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(sse({ choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
  res.write(sse({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
  res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  res.end('data: [DONE]\n\n');
}

function sendCuko(res, text) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('event: message\ndata: ' + JSON.stringify({ output: text }) + '\n\n');
  res.end('event: done\ndata: ' + JSON.stringify({ providerSessionId: 'ps-1', usage: {} }) + '\n\n');
}

const DDL = [
  'CREATE TABLE cuko_providers (id TEXT PRIMARY KEY, name TEXT, base_url TEXT, api_key TEXT, protocol TEXT, created_at TEXT, updated_at TEXT, extra_params TEXT, reasoning_field TEXT, disable_reasoning_params TEXT)',
  'CREATE TABLE cuko_models (provider_id TEXT, model_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, api_meta TEXT, user_meta TEXT, source TEXT, listed INTEGER, PRIMARY KEY (provider_id, model_id))',
  'CREATE TABLE cuko_sessions (id TEXT PRIMARY KEY, title TEXT, provider_session_id TEXT, provider_id TEXT, model_id TEXT, project_dir TEXT, system_prompt TEXT, created_at TEXT, updated_at TEXT, archived INTEGER DEFAULT 0, reasoning_effort TEXT)',
  'CREATE TABLE cuko_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, think TEXT, usage_json TEXT, created_at TEXT, sent_role TEXT, sent_text TEXT)',
];

let server;
let db;
let requests = [];
let handlers = [];
const events = [];
const openResponses = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('等待超时');
    await sleep(20);
  }
}

const of = (sid, type) => events.filter((e) => e.sessionId === sid && e.type === type);
const lastMsg = (req) => req.body.messages[req.body.messages.length - 1];
const queueTexts = (sid) => cukoQueue.get(sid).items.map((x) => x.text);

function newSession(providerId) {
  const sid = randomUUID();
  db.prepare('INSERT INTO cuko_sessions (id, title, provider_id, model_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sid, 't', providerId, 'm1', '', 'now', 'now');
  return sid;
}

async function start(sid, text) {
  const r = await startCukoRun({ sessionId: sid, input: [{ type: 'text', text }], userMessage: { id: randomUUID(), content: text } });
  expect(r).toMatchObject({ success: true });
}

beforeAll(async () => {
  ({ startCukoRun, cancelCukoRun, subscribeCukoRuns, kickCukoQueue, runQueueItemNow } = await import('../src/app/cuko-runner.js'));
  ({ cukoQueue } = await import('../src/app/cuko-queue.js'));
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = raw;
      try { body = JSON.parse(raw); } catch { /* 保留原文 */ }
      requests.push({ url: req.url, body });
      const h = handlers.shift();
      if (h) h(body, res);
      else { res.writeHead(500); res.end('no handler'); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  db = new DatabaseSync(':memory:');
  for (const sql of DDL) db.exec(sql);
  const addProvider = db.prepare('INSERT INTO cuko_providers (id, name, base_url, api_key, protocol) VALUES (?, ?, ?, ?, ?)');
  addProvider.run('p-openai', 'openai', baseUrl, null, 'openai');
  addProvider.run('p-cuko', 'cuko', baseUrl, null, 'cuko');
  globalThis.__globalDb = db;
  subscribeCukoRuns({ isDestroyed: () => false, send: (_ch, ev) => events.push(ev), once() {} });
});

afterAll(async () => {
  for (const res of openResponses) {
    try { res.end(); } catch { /* 连接已断开 */ }
  }
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  delete globalThis.__globalDb;
  Module._load = realLoad;
});

beforeEach(() => {
  requests = [];
  handlers = [];
  events.length = 0;
});

describe('cuko-runner + 队列：插话', () => {
  it('本轮调了工具：插话跟工具结果一起发（相邻 user 合并），落库在工具卡片之后，界面先收到用户消息', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => { cukoQueue.enqueue(sid, '插话A', { lane: 'steer' }); sendText(res, TOOL_REPLY); });
    handlers.push((_b, res) => sendText(res, '收到'));
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(of(sid, 'run-complete')[0].status).toBe('complete');
    expect(requests).toHaveLength(2);
    const m = lastMsg(requests[1]);
    expect(m.role).toBe('user');
    expect(m.content).toContain('tool-ok');
    expect(m.content.endsWith('\n\n插话A')).toBe(true);

    const rows = db.prepare('SELECT role, content, sent_role, sent_text FROM cuko_messages WHERE session_id = ? ORDER BY rowid').all(sid);
    const toolIdx = rows.findIndex((r) => r.role === 'assistant' && String(r.content).startsWith('['));
    const steerIdx = rows.findIndex((r) => r.role === 'user' && r.content === '插话A');
    expect(toolIdx).toBeGreaterThan(-1);
    expect(steerIdx).toBeGreaterThan(toolIdx);
    expect(rows[steerIdx]).toMatchObject({ sent_role: 'user', sent_text: '插话A' });

    const mine = events.filter((e) => e.sessionId === sid);
    const userIdx = mine.findIndex((e) => e.type === 'user-message' && e.content === '插话A' && e.source === 'steer');
    const starts = mine.map((e, i) => (e.type === 'run-start' ? i : -1)).filter((i) => i >= 0);
    expect(userIdx).toBeGreaterThan(-1);
    expect(starts).toHaveLength(2);
    expect(userIdx).toBeLessThan(starts[1]);
    expect(cukoQueue.get(sid).steerItems).toEqual([]);
  });

  it('本轮没调工具：插话作为新的用户消息继续下一轮，整个过程只有一次运行', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => { cukoQueue.enqueue(sid, '插话B', { lane: 'steer' }); sendText(res, '第一轮'); });
    handlers.push((_b, res) => sendText(res, '第二轮'));
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 1);
    await sleep(100);
    expect(of(sid, 'run-complete')).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[1].body.messages.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(lastMsg(requests[1])).toEqual({ role: 'user', content: '插话B' });
  });

  it('Cuko 协议：插话追加在工具结果之后，请求 type 仍是 tool，库里不写发送原文', async () => {
    const sid = newSession('p-cuko');
    handlers.push((_b, res) => { cukoQueue.enqueue(sid, '插话C', { lane: 'steer' }); sendCuko(res, TOOL_REPLY); });
    handlers.push((_b, res) => sendCuko(res, '收到'));
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(of(sid, 'run-complete')[0].status).toBe('complete');
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe('/v1/responses');
    expect(requests[1].body.type).toBe('tool');
    const input = requests[1].body.input;
    expect(input[input.length - 1]).toEqual({ type: 'text', text: '插话C' });
    expect(input.some((p) => String(p.text).includes('tool-ok'))).toBe(true);
    const row = db.prepare("SELECT sent_role, sent_text FROM cuko_messages WHERE session_id = ? AND role = 'user' AND content = ?").get(sid, '插话C');
    expect(row).toMatchObject({ sent_role: null, sent_text: null });
  });
});

describe('cuko-runner + 队列：排队与暂停', () => {
  it('正常结束后自动发下一条，界面收到这条用户消息', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => { cukoQueue.enqueue(sid, '下一条'); sendText(res, 'r1'); });
    handlers.push((_b, res) => sendText(res, 'r2'));
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 2);
    expect(of(sid, 'run-complete').map((e) => e.status)).toEqual(['complete', 'complete']);
    expect(lastMsg(requests[1])).toEqual({ role: 'user', content: '下一条' });
    expect(of(sid, 'user-message').some((e) => e.content === '下一条' && e.source === 'queue')).toBe(true);
    expect(queueTexts(sid)).toEqual([]);
  });

  it('停止：队列暂停、消息保留、不自动发；之后手动发送恢复队列并接着发', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => {
      cukoQueue.enqueue(sid, '排队1');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse({ choices: [{ index: 0, delta: { content: '一半' }, finish_reason: null }] }));
      openResponses.push(res);
    });
    await start(sid, 'hello');
    await waitFor(() => requests.length === 1);
    await sleep(50);
    expect(cancelCukoRun(sid)).toMatchObject({ success: true });
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(of(sid, 'run-complete')[0].status).toBe('cancelled');
    await sleep(200);
    expect(requests).toHaveLength(1);
    expect(queueTexts(sid)).toEqual(['排队1']);
    expect(cukoQueue.isPaused(sid)).toBe(true);
    expect(of(sid, 'queue-update').some((e) => e.paused === true)).toBe(true);

    handlers.push((_b, res) => sendText(res, '手动回复'));
    handlers.push((_b, res) => sendText(res, '排队回复'));
    await start(sid, '手动');
    await waitFor(() => of(sid, 'run-complete').length === 3);
    expect(requests).toHaveLength(3);
    expect(lastMsg(requests[2])).toEqual({ role: 'user', content: '排队1' });
    expect(queueTexts(sid)).toEqual([]);
    expect(cukoQueue.isPaused(sid)).toBe(false);
  });

  it('出错（401）：队列暂停、消息保留、不自动发', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => {
      cukoQueue.enqueue(sid, '排队1');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad key' } }));
    });
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(of(sid, 'run-complete')[0].status).toBe('error');
    await sleep(200);
    expect(requests).toHaveLength(1);
    expect(queueTexts(sid)).toEqual(['排队1']);
    expect(cukoQueue.isPaused(sid)).toBe(true);
  });

  it('续发启动失败（模型被清掉）：消息放回队首、顺序不变、队列暂停、推送 queue-error', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => {
      cukoQueue.enqueue(sid, '排队1');
      cukoQueue.enqueue(sid, '排队2');
      db.prepare('UPDATE cuko_sessions SET model_id = NULL WHERE id = ?').run(sid);
      sendText(res, 'r1');
    });
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'queue-error').length === 1);
    expect(of(sid, 'run-complete')).toHaveLength(1);
    expect(of(sid, 'queue-error')[0].error).toContain('模型');
    expect(requests).toHaveLength(1);
    expect(queueTexts(sid)).toEqual(['排队1', '排队2']);
    expect(cukoQueue.isPaused(sid)).toBe(true);
  });
});

describe('cuko-runner + 队列：界面触发的续发', () => {
  it('空闲时入队再触发：直接发出，界面收到这条用户消息', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => sendText(res, 'r1'));
    cukoQueue.enqueue(sid, '空闲入队');
    kickCukoQueue(sid);
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(requests).toHaveLength(1);
    expect(lastMsg(requests[0])).toEqual({ role: 'user', content: '空闲入队' });
    expect(of(sid, 'user-message').some((e) => e.content === '空闲入队' && e.source === 'queue')).toBe(true);
    expect(queueTexts(sid)).toEqual([]);
  });

  it('连续触发两次只开一个运行，两条按顺序先后发出', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => sendText(res, 'r1'));
    handlers.push((_b, res) => sendText(res, 'r2'));
    cukoQueue.enqueue(sid, 'a');
    cukoQueue.enqueue(sid, 'b');
    kickCukoQueue(sid);
    kickCukoQueue(sid);
    await waitFor(() => of(sid, 'run-complete').length === 2);
    await sleep(100);
    expect(of(sid, 'run-complete')).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect(lastMsg(requests[0])).toEqual({ role: 'user', content: 'a' });
    expect(lastMsg(requests[1])).toEqual({ role: 'user', content: 'b' });
  });

  it('暂停后「立即发送」：这条先发、队列恢复、剩下的接着发；条目不存在返回失败', async () => {
    const sid = newSession('p-openai');
    cukoQueue.enqueue(sid, '排队1');
    const b = cukoQueue.enqueue(sid, '排队2').item;
    cukoQueue.pause(sid);
    expect(runQueueItemNow(sid, 'no-such-id')).toMatchObject({ success: false });
    handlers.push((_b, res) => sendText(res, 'r2'));
    handlers.push((_b, res) => sendText(res, 'r1'));
    expect(runQueueItemNow(sid, b.id)).toMatchObject({ success: true });
    await waitFor(() => of(sid, 'run-complete').length === 2);
    expect(lastMsg(requests[0])).toEqual({ role: 'user', content: '排队2' });
    expect(lastMsg(requests[1])).toEqual({ role: 'user', content: '排队1' });
    expect(queueTexts(sid)).toEqual([]);
    expect(cukoQueue.isPaused(sid)).toBe(false);
  });
});

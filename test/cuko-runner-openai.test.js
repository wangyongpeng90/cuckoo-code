/**
 * [261123-q4h7tn-cuko-openai] 运行器 OpenAI 协议集成测试
 * 本地起一个假的 OpenAI 服务 + 内存数据库，跑真实的 cuko-runner（不 mock 内部模块）。
 * 覆盖：前缀不变的多轮重放、工具循环、临时错误自动重试、401 不重试且不进历史、停止保留已输出部分。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Module from 'node:module';
import os from 'node:os';

// 隔离用户目录（项目测试规则）：别读写真实的 ~/.cuckoo
process.env.CUCKOO_HOME = os.tmpdir() + '/cuko-runner-openai-test-' + process.pid;

// 外部边界替身：运行器 → prompt-builder → mcp/client → infra/paths 在加载时调用 app.getAppPath()，
// Node 测试环境没有 electron app，照 test/session/prompt-builder.test.js 用 Module._load 拦截。
// vitest 配置为 pool: 'forks'，替换只影响本文件。
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

// 替身装好后再加载运行器（静态 import 会先于上面的代码执行）
let startCukoRun;
let cancelCukoRun;
let subscribeCukoRuns;

const FENCE = String.fromCharCode(96).repeat(3);
const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';

function sendText(res, text, usage) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(sse({ choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
  res.write(sse({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
  res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  if (usage) res.write(sse({ choices: [], usage }));
  res.end('data: [DONE]\n\n');
}

const DDL = [
  'CREATE TABLE cuko_providers (id TEXT PRIMARY KEY, name TEXT, base_url TEXT, api_key TEXT, protocol TEXT, created_at TEXT, updated_at TEXT, extra_params TEXT, reasoning_field TEXT, disable_reasoning_params TEXT)',
  'CREATE TABLE cuko_models (provider_id TEXT, model_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, api_meta TEXT, user_meta TEXT, source TEXT, listed INTEGER, PRIMARY KEY (provider_id, model_id))',
  'CREATE TABLE cuko_sessions (id TEXT PRIMARY KEY, title TEXT, provider_session_id TEXT, provider_id TEXT, model_id TEXT, project_dir TEXT, system_prompt TEXT, created_at TEXT, updated_at TEXT, archived INTEGER DEFAULT 0, reasoning_effort TEXT)',
  'CREATE TABLE cuko_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, think TEXT, usage_json TEXT, created_at TEXT, sent_role TEXT, sent_text TEXT)',
];

let server;
let db;
const requests = [];
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

beforeAll(async () => {
  ({ startCukoRun, cancelCukoRun, subscribeCukoRuns } = await import('../src/app/cuko-runner.js'));
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = raw;
      try { body = JSON.parse(raw); } catch { /* 保留原文 */ }
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      const h = handlers.shift();
      if (h) h(res);
      else sendText(res, 'fallback');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';

  db = new DatabaseSync(':memory:');
  for (const sql of DDL) db.exec(sql);
  db.prepare('INSERT INTO cuko_providers (id, name, base_url, api_key, protocol) VALUES (?, ?, ?, ?, ?)').run('p1', 'fake', baseUrl, 'k-test', 'openai');
  db.prepare('INSERT INTO cuko_models (provider_id, model_id, name) VALUES (?, ?, ?)').run('p1', 'm1', 'm1');
  globalThis.__globalDb = db;

  subscribeCukoRuns({ send: (_channel, ev) => events.push(ev), isDestroyed: () => false, once() {} });
});

afterAll(async () => {
  for (const res of openResponses) { try { res.end(); } catch { /* ignore */ } }
  if (server) {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  delete globalThis.__globalDb;
  Module._load = realLoad;
});

beforeEach(() => {
  requests.length = 0;
  handlers = [];
});

function newSession() {
  const id = randomUUID();
  db.prepare('INSERT INTO cuko_sessions (id, title, provider_id, model_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'test', 'p1', 'm1', null, '2026-11-23T00:00:00+08:00', '2026-11-23T00:00:00+08:00');
  return id;
}

// [261123-q4h7tn-cuko-openai] startCukoRun 改成 async（要解密库里的密钥），这里跟着 await
async function startTurn(sessionId, text) {
  const r = await startCukoRun({ sessionId, input: [{ type: 'text', text }], userMessage: { id: randomUUID(), content: text } });
  expect(r).toMatchObject({ success: true });
  return r.runId;
}

async function runTurn(sessionId, text) {
  const runId = await startTurn(sessionId, text);
  return waitFor(() => events.find((e) => e.type === 'run-complete' && e.runId === runId));
}

const rowsOf = (sid) => db.prepare('SELECT role, content, sent_role, sent_text, usage_json FROM cuko_messages WHERE session_id = ? ORDER BY rowid ASC').all(sid);

describe('cuko-runner：OpenAI 协议', () => {
  it('两轮对话：第二轮请求以第一轮为前缀，不用 system 角色，地址不重复拼 /v1，缓存命中落库', async () => {
    const sid = newSession();
    handlers = [
      (res) => sendText(res, '你好', { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 }),
      (res) => sendText(res, '再见', { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 10 }),
    ];
    expect((await runTurn(sid, 'hi')).status).toBe('complete');
    expect((await runTurn(sid, 'again')).status).toBe('complete');

    expect(requests).toHaveLength(2);
    const [a, b] = requests;
    expect(a.url).toBe('/v1/chat/completions');
    expect(a.auth).toBe('Bearer k-test');
    expect(a.body).toMatchObject({ model: 'm1', stream: true, stream_options: { include_usage: true } });
    expect(a.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(b.body.messages).toEqual([...a.body.messages, { role: 'assistant', content: '你好' }, { role: 'user', content: 'again' }]);
    const sa = JSON.stringify(a.body.messages);
    expect(JSON.stringify(b.body.messages).startsWith(sa.slice(0, sa.length - 1))).toBe(true);
    expect(b.body.messages.some((m) => m.role === 'system')).toBe(false);

    const rows = rowsOf(sid);
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(JSON.parse(rows[3].usage_json)).toMatchObject({ cache_read_tokens: 10, cache_miss_tokens: 10 });
  }, 20000);

  it('工具循环：回复带 cuckoo 代码块时执行并以 user 消息回传结果', async () => {
    const sid = newSession();
    const reply = '先跑一下\n' + FENCE + 'cuckoo\nlog("tool-ok")\n' + FENCE;
    handlers = [(res) => sendText(res, reply), (res) => sendText(res, '完成')];
    expect((await runTurn(sid, 'hi')).status).toBe('complete');

    expect(requests).toHaveLength(2);
    const msgs = requests[1].body.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: 'assistant', content: reply });
    expect(msgs[2].role).toBe('user');
    expect(/tool-ok|错误原因/.test(msgs[2].content)).toBe(true);

    const rows = rowsOf(sid);
    expect(rows.map((r) => r.sent_role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  }, 60000);

  it('临时错误：503 后自动重试，两次请求体完全一样', async () => {
    const sid = newSession();
    handlers = [
      (res) => { res.writeHead(503); res.end('busy'); },
      (res) => sendText(res, 'ok'),
    ];
    expect((await runTurn(sid, 'hi')).status).toBe('complete');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].body)).toBe(JSON.stringify(requests[0].body));
    expect(events.some((e) => e.type === 'round-retry' && e.sessionId === sid && e.attempt === 1)).toBe(true);
    expect(rowsOf(sid).at(-1)).toMatchObject({ sent_role: 'assistant', sent_text: 'ok' });
  }, 20000);

  it('401：不重试、这一轮不进历史，下一轮发出的历史里没有错误内容', async () => {
    const sid = newSession();
    handlers = [(res) => { res.writeHead(401); res.end('bad key'); }];
    const done = await runTurn(sid, 'hi');
    expect(done.status).toBe('error');
    expect(String(done.error)).toContain('401');
    expect(requests).toHaveLength(1);
    expect(rowsOf(sid).at(-1)).toMatchObject({ role: 'assistant', sent_role: 'none', sent_text: null });

    handlers = [(res) => sendText(res, 'ok')];
    expect((await runTurn(sid, 'again')).status).toBe('complete');
    expect(requests[1].body.messages).toEqual([{ role: 'user', content: 'hi\n\nagain' }]);
  }, 20000);

  it('用户停止：状态为已停止，已输出的部分进历史', async () => {
    const sid = newSession();
    handlers = [(res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }));
      openResponses.push(res);
    }];
    const runId = await startTurn(sid, 'hi');
    await waitFor(() => events.find((e) => e.type === 'delta' && e.sessionId === sid && e.delta === 'partial'));
    expect(cancelCukoRun(sid)).toMatchObject({ success: true });
    const done = await waitFor(() => events.find((e) => e.type === 'run-complete' && e.runId === runId));
    expect(done.status).toBe('cancelled');
    expect(rowsOf(sid).at(-1)).toMatchObject({ role: 'assistant', sent_role: 'assistant', sent_text: 'partial' });
  }, 20000);
});


// [261123-q4h7tn-cuko-openai] 请求日志：协议 / 尝试次数 / 用量归一 / 原始报文（密钥打码）/ 列表只给摘要 / 超过 20 条释放原文
let listCukoRequestLogs;
let getCukoRequestLogRaw;
let clearCukoRequestLogs;

const LOG_USAGE = { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 60 }, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40 };

function headerOf(headers, name) {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

describe('cuko-runner：请求日志', () => {
  beforeAll(async () => {
    ({ listCukoRequestLogs, getCukoRequestLogRaw, clearCukoRequestLogs } = await import('../src/app/cuko-runner.js'));
  });

  it('一次成功请求：协议 / 尝试次数 / 用量归一；原文与假服务收到的一致；密钥打码；列表不含原文', async () => {
    const longAuth = 'k-test-abcdefgh1234';
    db.prepare('UPDATE cuko_providers SET api_key = ? WHERE id = ?').run(longAuth, 'p1');
    try {
      clearCukoRequestLogs();
      const sid = newSession();
      handlers.push((res) => sendText(res, 'ok', LOG_USAGE));
      await runTurn(sid, 'hello');
      expect(requests).toHaveLength(1);
      expect(requests[0].auth).toBe('Bearer ' + longAuth);

      const logs = listCukoRequestLogs();
      expect(logs).toHaveLength(1);
      const entry = logs[0];
      expect(entry.protocol).toBe('openai');
      expect(entry.attempt).toBe(1);
      expect(entry.maxAttempts).toBe(4);
      expect(entry.status).toBe('ok');
      expect(entry.httpStatus).toBe(200);
      expect(entry.usage.input_tokens).toBe(100);
      expect(entry.usage.cache_read_tokens).toBe(60);
      expect(entry.usage.cache_miss_tokens).toBe(40);
      expect(entry.hasRaw).toBe(true);
      expect(entry.requestBody).toBeUndefined();
      expect(entry.requestHeaders).toBeUndefined();
      expect(entry.responseText).toBeUndefined();

      const raw = getCukoRequestLogRaw(entry.id);
      expect(raw.method).toBe('POST');
      expect(raw.rawReleased).toBeFalsy();
      expect(JSON.parse(raw.requestBody)).toEqual(requests[0].body);
      expect(headerOf(raw.requestHeaders, 'authorization')).toBe('Bearer ****1234');
      expect(JSON.stringify(raw)).not.toContain(longAuth);
      expect(raw.responseText).toContain('[DONE]');
    } finally {
      db.prepare('UPDATE cuko_providers SET api_key = ? WHERE id = ?').run('k-test', 'p1');
    }
  });

  it('503 自动重试：每次尝试各记一条，attempt 依次 1、2，maxAttempts 为 4，两次请求体原文相同', async () => {
    clearCukoRequestLogs();
    const sid = newSession();
    handlers.push((res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"busy"}');
    });
    handlers.push((res) => sendText(res, 'ok', LOG_USAGE));
    await runTurn(sid, 'retry me');
    expect(requests).toHaveLength(2);

    const logs = listCukoRequestLogs().slice().reverse();
    expect(logs.map((e) => e.attempt)).toEqual([1, 2]);
    expect(logs.map((e) => e.maxAttempts)).toEqual([4, 4]);
    expect(logs.map((e) => e.status)).toEqual(['error', 'ok']);
    expect(logs.map((e) => e.httpStatus)).toEqual([503, 200]);
    expect(logs[1].usage.cache_read_tokens).toBe(60);

    const first = getCukoRequestLogRaw(logs[0].id);
    const second = getCukoRequestLogRaw(logs[1].id);
    expect(first.responseText).toContain('busy');
    expect(second.requestBody).toBe(first.requestBody);
    expect(JSON.parse(second.requestBody)).toEqual(requests[1].body);
  }, 20000);

  it('超过 20 条后，更早的记录释放原文（列表 hasRaw 为 false，原文接口标 rawReleased）', async () => {
    clearCukoRequestLogs();
    const sid = newSession();
    for (let i = 0; i < 21; i++) {
      handlers.push((res) => sendText(res, 'r' + i));
      await runTurn(sid, 'n' + i);
    }
    const logs = listCukoRequestLogs();
    expect(logs).toHaveLength(21);

    const oldest = logs[20];
    expect(oldest.hasRaw).toBe(false);
    const oldRaw = getCukoRequestLogRaw(oldest.id);
    expect(oldRaw.rawReleased).toBe(true);
    expect(oldRaw.requestBody).toBeUndefined();
    expect(oldRaw.responseText).toBeUndefined();

    const kept = getCukoRequestLogRaw(logs[19].id);
    expect(kept.rawReleased).toBeFalsy();
    expect(typeof kept.requestBody).toBe('string');
  }, 60000);
});
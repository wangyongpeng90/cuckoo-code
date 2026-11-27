/**
 * [261127-w3pd8n-cuko-default-workspace] 会话没绑定工作区时，运行器自动绑定默认目录
 * 本地假服务 + 内存数据库，跑真实的 cuko-runner（不 mock 内部模块）。
 * 覆盖：两种协议的第一条消息都带系统提示词；会话写回默认目录、加入工作区列表；已绑定的会话不动。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Module from 'node:module';
import os from 'node:os';

process.env.CUCKOO_HOME = os.tmpdir() + '/cuko-runner-defws-test-' + process.pid;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cuko-runner-defws-ud-'));
const DEFAULT_DIR = path.join(USER_DATA, 'cuko-default-workspace');

const realLoad = Module._load;
const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => USER_DATA,
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
let subscribeCukoRuns;

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
  res.end('event: done\ndata: ' + JSON.stringify({ providerSessionId: 'ps-' + randomUUID(), usage: {} }) + '\n\n');
}

const DDL = [
  'CREATE TABLE cuko_providers (id TEXT PRIMARY KEY, name TEXT, base_url TEXT, api_key TEXT, protocol TEXT, created_at TEXT, updated_at TEXT, extra_params TEXT, reasoning_field TEXT, disable_reasoning_params TEXT)',
  'CREATE TABLE cuko_models (provider_id TEXT, model_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, api_meta TEXT, user_meta TEXT, source TEXT, listed INTEGER, PRIMARY KEY (provider_id, model_id))',
  'CREATE TABLE cuko_sessions (id TEXT PRIMARY KEY, title TEXT, provider_session_id TEXT, provider_id TEXT, model_id TEXT, project_dir TEXT, system_prompt TEXT, created_at TEXT, updated_at TEXT, archived INTEGER DEFAULT 0, reasoning_effort TEXT)',
  'CREATE TABLE cuko_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, think TEXT, usage_json TEXT, created_at TEXT, sent_role TEXT, sent_text TEXT)',
  'CREATE TABLE cuko_workspaces (path TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT, archived INTEGER DEFAULT 0)',
];

let server;
let db;
let requests = [];
let handlers = [];
const events = [];

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
const sessionRow = (sid) => db.prepare('SELECT project_dir, system_prompt FROM cuko_sessions WHERE id = ?').get(sid);

function newSession(providerId, projectDir = '') {
  const sid = randomUUID();
  db.prepare('INSERT INTO cuko_sessions (id, title, provider_id, model_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sid, 't', providerId, 'm1', projectDir, 'now', 'now');
  return sid;
}

async function start(sid, text) {
  const r = await startCukoRun({ sessionId: sid, input: [{ type: 'text', text }], userMessage: { id: randomUUID(), content: text } });
  expect(r).toMatchObject({ success: true });
}

beforeAll(async () => {
  ({ startCukoRun, subscribeCukoRuns } = await import('../src/app/cuko-runner.js'));
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
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  delete globalThis.__globalDb;
  Module._load = realLoad;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  handlers = [];
  events.length = 0;
});

describe('cuko-runner：没绑定工作区时用默认目录', () => {
  it('OpenAI：绑定默认目录、加入工作区列表、第一条消息带系统提示词', async () => {
    const sid = newSession('p-openai');
    handlers.push((_b, res) => sendText(res, 'ok'));
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(of(sid, 'run-complete')[0].status).toBe('complete');

    const s = sessionRow(sid);
    expect(s.project_dir).toBe(DEFAULT_DIR);
    expect(fs.existsSync(DEFAULT_DIR)).toBe(true);
    expect(String(s.system_prompt || '').trim().length).toBeGreaterThan(0);

    const first = requests[0].body.messages[0];
    expect(first.role).toBe('user');
    expect(first.content.endsWith('\n\n---\n\nhello')).toBe(true);
    expect(first.content.length).toBeGreaterThan('\n\n---\n\nhello'.length);

    expect(db.prepare('SELECT name FROM cuko_workspaces WHERE path = ?').get(DEFAULT_DIR)).toMatchObject({ name: '默认工作区' });
    expect(of(sid, 'session-project').map((e) => e.projectDir)).toEqual([DEFAULT_DIR]);
  });

  it('Cuko 协议：系统提示词分段拼在用户输入前面', async () => {
    const sid = newSession('p-cuko');
    handlers.push((_b, res) => sendCuko(res, 'ok'));
    await start(sid, 'hello');
    await waitFor(() => of(sid, 'run-complete').length === 1);
    expect(of(sid, 'run-complete')[0].status).toBe('complete');
    const input = requests[0].body.input;
    expect(input.length).toBeGreaterThan(1);
    expect(input[input.length - 1]).toEqual({ type: 'text', text: 'hello' });
    expect(String(input[0].text || '').trim().length).toBeGreaterThan(0);
    expect(sessionRow(sid).project_dir).toBe(DEFAULT_DIR);
  });

  it('已绑定工作区：不改目录、不推 session-project', async () => {
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'cuko-runner-defws-own-'));
    try {
      const sid = newSession('p-openai', own);
      handlers.push((_b, res) => sendText(res, 'ok'));
      await start(sid, 'hello');
      await waitFor(() => of(sid, 'run-complete').length === 1);
      expect(sessionRow(sid).project_dir).toBe(own);
      expect(of(sid, 'session-project')).toEqual([]);
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }
  });
});

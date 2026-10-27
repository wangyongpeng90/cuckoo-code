'use strict';
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSessionStore } from '../../src/session/store.js';

const tmpDir = path.join(process.cwd(), 'test', 'tmp', 'session-store-test');

beforeEach(() => {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  while (_dbs.length > 0) {
    try { _dbs.pop().close(); } catch { /* ignore */ }
  }
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 建一个内存 SQLite + sessions 表，供测试用 */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      logic_id TEXT PRIMARY KEY,
      web_id TEXT UNIQUE,
      profile_id TEXT,
      project_dir TEXT,
      title TEXT,
      pending_messages TEXT,
      archived INTEGER DEFAULT 0,
      superseded INTEGER DEFAULT 0,
      parent_id TEXT,
      kind TEXT,
      agent_name TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

/** 追踪本测试创建的所有 db，afterEach 统一清理 */
const _dbs = [];

function makeStore(profileId = 'p1') {
  const mockWindowState = {
    getMainWindow: () => null,
  };
  const db = makeDb();
  _dbs.push(db);
  return createSessionStore(profileId, db, mockWindowState);
}

test('extractSessionIdFromUrl 标准 URL', () => {
  const store = makeStore();
  const url = 'https://chat.deepseek.com/a/chat/s/bd9953b8-ff70-4207-9a12-5967be02a066';
  assert.strictEqual(store.extractSessionIdFromUrl(url), 'bd9953b8-ff70-4207-9a12-5967be02a066');
});

test('extractSessionIdFromUrl /s/ 备选', () => {
  const store = makeStore();
  // 平台差异下沉到 provider.extractSessionId，需用已识别平台的 URL
  assert.strictEqual(store.extractSessionIdFromUrl('https://chat.deepseek.com/s/abc123'), 'abc123');
});

test('extractSessionIdFromUrl 未识别平台返回 null', () => {
  const store = makeStore();
  assert.strictEqual(store.extractSessionIdFromUrl('https://x.com/s/abc123'), null);
});

test('extractSessionIdFromUrl 无会话返回 null', () => {
  const store = makeStore();
  assert.strictEqual(store.extractSessionIdFromUrl('https://chat.deepseek.com/'), null);
  assert.strictEqual(store.extractSessionIdFromUrl(null), null);
  assert.strictEqual(store.extractSessionIdFromUrl(''), null);
});

test('readSessionStore 不存在返回空对象', () => {
  const store = makeStore();
  assert.deepStrictEqual(store.readSessionStore(), {});
});

test('writeSessionStore 已废弃（no-op）——写不影响 SQLite 读取', () => {
  // [022-mod] writeSessionStore 是 JSON 时代的全量覆盖接口，SQLite 迁移后
  // 仅在 noPersist（纯内存模式）生效，正常模式下是 no-op。详见 store.ts:61-64 注释。
  const store = makeStore();
  store.writeSessionStore({ a: 'dir1' });
  assert.deepStrictEqual(store.readSessionStore(), {});
});

test('saveSessionDirMapping / getProjectDirBySessionId', () => {
  const store = makeStore();
  store.saveSessionDirMapping('id1', 'C:/proj');
  assert.strictEqual(store.getProjectDirBySessionId('id1'), 'C:/proj');
  assert.strictEqual(store.getProjectDirBySessionId('missing'), null);
  assert.strictEqual(store.getProjectDirBySessionId(null), null);
});

test('saveSessionDirMapping 空 sessionId 不保存', () => {
  const store = makeStore();
  store.saveSessionDirMapping('', 'C:/proj');
  assert.deepStrictEqual(store.readSessionStore(), {});
});

test('state 初始值', () => {
  const store = makeStore();
  assert.strictEqual(store.state.currentSessionId, null);
  assert.strictEqual(store.state.selectedProjectDir, null);
  assert.strictEqual(store.state.pendingProjectDir, null);
});

test('不同 profile 的存储文件互相隔离', () => {
  const s1 = makeStore('p1');
  const s2 = makeStore('p2');
  s1.saveSessionDirMapping('sess-1', 'C:/proj1');
  s2.saveSessionDirMapping('sess-1', 'C:/proj2');
  assert.strictEqual(s1.getProjectDirBySessionId('sess-1'), 'C:/proj1');
  assert.strictEqual(s2.getProjectDirBySessionId('sess-1'), 'C:/proj2');
});

test('handleUrlChange 首页 → 清空 currentSessionId，清空 selectedProjectDir', () => {
  // [022] 已废除 local-xxx 临时 ID：落地首页就清空当前会话。
  const sent = [];
  const fakeView = { webContents: { isDestroyed: () => false, send: (ch, data) => sent.push([ch, data]) } };
  const fakeWin = { webContents: { isDestroyed: () => false, send: () => {} } };
  const db = makeDb(); _dbs.push(db);
  const store = createSessionStore('p1', db, { getMainWindow: () => fakeWin });
  store.state.currentSessionId = 'old';
  store.state.selectedProjectDir = 'C:/old';
  store.handleUrlChange('https://chat.deepseek.com/', fakeView);
  assert.strictEqual(store.state.currentSessionId, null, 'currentSessionId 必须清空为 null');
  assert.strictEqual(store.state.selectedProjectDir, null);
  assert.ok(sent.some(([ch]) => ch === 'project-dir-updated'));
});

test('handleUrlChange 恢复已保存目录', () => {
  const sent = [];
  const fakeView = { webContents: { isDestroyed: () => false, send: (ch, data) => sent.push([ch, data]) } };
  const fakeWin = { webContents: { isDestroyed: () => false, send: () => {} } };
  const db = makeDb(); _dbs.push(db);
  const store = createSessionStore('p1', db, { getMainWindow: () => fakeWin });
  store.saveSessionDirMapping('abc123', 'C:/proj');
  store.handleUrlChange('https://chat.deepseek.com/a/chat/s/abc123', fakeView);
  assert.strictEqual(store.state.currentSessionId, 'abc123');
  assert.strictEqual(store.state.selectedProjectDir, 'C:/proj');
  assert.ok(sent.some(([ch]) => ch === 'session-restored'));
  assert.ok(sent.some(([ch]) => ch === 'project-dir-updated'));
});


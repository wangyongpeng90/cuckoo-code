/**
 * workspace-registry 单元测试（022 决策 9.5 + 9.6）
 *
 * 被测对象：src/session/workspace-registry.ts
 * 契约来源：docs/requirements/022-dsh-plugin-compat.md C4-D + docs/dsh-compat-decisions.md 第九章
 *   - 9.5：持久化 SQLite workspaces 表
 *   - 9.6：attachSession 五道校验（对齐 DSH entity.ts:109-149）
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWorkspaceRegistry } from '../../src/session/workspace-registry.js';

/** 每个测试独立的环境：内存 DB + 临时目录 */
function setup() {
  const db = new DatabaseSync(':memory:');
  // workspace-registry 的 attachSession 会读 sessions 表，测试里手动建
  db.exec(`
    CREATE TABLE sessions (
      logic_id TEXT PRIMARY KEY,
      project_dir TEXT,
      title TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-ws-'));
  return { db, tmpRoot };
}

function cleanup(env) {
  try { env.db.close(); } catch { /* ignore */ }
  try { fs.rmSync(env.tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 往 sessions 表插一条测试数据 */
function seedSession(env, logicId, projectDir) {
  const now = new Date().toISOString();
  env.db.prepare(
    'INSERT INTO sessions (logic_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(logicId, projectDir, now, now);
}

// ===== create =====

test('create：新建工作区，path 是 realpath 后的绝对路径', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-a');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    assert.strictEqual(ws.path, fs.realpathSync(dir));
    assert.ok(ws.id && ws.id.length > 0);
    assert.deepStrictEqual(ws.sessionIds, []);
    assert.ok(ws.createdAt && ws.updatedAt);
  } finally { cleanup(env); }
});

test('create：同路径重复 create 幂等（返回已存在的）', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-b');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const w1 = await reg.create(dir);
    const w2 = await reg.create(dir);
    assert.strictEqual(w1.id, w2.id);
    assert.strictEqual(reg.list().length, 1);
  } finally { cleanup(env); }
});

test('create：路径不存在 → throw', async () => {
  const env = setup();
  try {
    const reg = createWorkspaceRegistry(env.db);
    await assert.rejects(
      () => reg.create(path.join(env.tmpRoot, 'nope')),
      /not a directory|ENOENT|does not exist/i,
    );
  } finally { cleanup(env); }
});

test('create：路径是文件不是目录 → throw', async () => {
  const env = setup();
  try {
    const filePath = path.join(env.tmpRoot, 'a.txt');
    fs.writeFileSync(filePath, 'x');
    const reg = createWorkspaceRegistry(env.db);
    await assert.rejects(() => reg.create(filePath), /not a directory/i);
  } finally { cleanup(env); }
});

// ===== get / list / resolveByPath =====

test('get：已存在的 id 返回 Workspace', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-c');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    const found = reg.get(ws.id);
    assert.ok(found);
    assert.strictEqual(found.id, ws.id);
  } finally { cleanup(env); }
});

test('get：不存在的 id 返回 undefined', () => {
  const env = setup();
  try {
    const reg = createWorkspaceRegistry(env.db);
    assert.strictEqual(reg.get('nonexistent'), undefined);
  } finally { cleanup(env); }
});

test('list：返回全部工作区', async () => {
  const env = setup();
  try {
    const d1 = path.join(env.tmpRoot, 'p1');
    const d2 = path.join(env.tmpRoot, 'p2');
    fs.mkdirSync(d1); fs.mkdirSync(d2);
    const reg = createWorkspaceRegistry(env.db);
    await reg.create(d1);
    await reg.create(d2);
    assert.strictEqual(reg.list().length, 2);
  } finally { cleanup(env); }
});

test('resolveByPath：匹配已注册的 path', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-d');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    const found = reg.resolveByPath(fs.realpathSync(dir));
    assert.ok(found);
    assert.strictEqual(found.id, ws.id);
  } finally { cleanup(env); }
});

test('resolveByPath：未注册的 path 返回 undefined', () => {
  const env = setup();
  try {
    const reg = createWorkspaceRegistry(env.db);
    assert.strictEqual(reg.resolveByPath('/some/unknown/path'), undefined);
  } finally { cleanup(env); }
});

// ===== attachSession 五道校验 =====

test('attachSession：幂等——已挂过的 session 不重复写入', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-e');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    seedSession(env, 'sess-1', fs.realpathSync(dir));
    await ws.attachSession('sess-1');
    await ws.attachSession('sess-1');  // 第二次
    assert.deepStrictEqual(ws.sessionIds, ['sess-1']);
  } finally { cleanup(env); }
});

test('attachSession：session 无 cwd → throw "carries no cwd"', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-f');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    seedSession(env, 'sess-nocwd', null);
    await assert.rejects(
      () => ws.attachSession('sess-nocwd'),
      /carries no cwd/i,
    );
  } finally { cleanup(env); }
});

test('attachSession：cwd 路径不存在 → throw "does not resolve"', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-g');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    seedSession(env, 'sess-bad', path.join(env.tmpRoot, 'ghost'));
    await assert.rejects(
      () => ws.attachSession('sess-bad'),
      /does not resolve/i,
    );
  } finally { cleanup(env); }
});

test('attachSession：cwd 是文件不是目录 → throw "is not a directory"', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-h');
    fs.mkdirSync(dir);
    const filePath = path.join(env.tmpRoot, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    seedSession(env, 'sess-file', filePath);
    await assert.rejects(
      () => ws.attachSession('sess-file'),
      /is not a directory/i,
    );
  } finally { cleanup(env); }
});

test('attachSession：cwd 与 workspace.path 不一致 → throw "resolves to"', async () => {
  const env = setup();
  try {
    const dirA = path.join(env.tmpRoot, 'proj-i');
    const dirB = path.join(env.tmpRoot, 'proj-j');
    fs.mkdirSync(dirA); fs.mkdirSync(dirB);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dirA);
    seedSession(env, 'sess-mismatch', fs.realpathSync(dirB));
    await assert.rejects(
      () => ws.attachSession('sess-mismatch'),
      /resolves to/i,
    );
  } finally { cleanup(env); }
});

test('attachSession：正常挂载——sessionIds 前插 + updatedAt 更新', async () => {
  const env = setup();
  try {
    const dir = path.join(env.tmpRoot, 'proj-k');
    fs.mkdirSync(dir);
    const reg = createWorkspaceRegistry(env.db);
    const ws = await reg.create(dir);
    const before = ws.updatedAt;
    seedSession(env, 'sess-ok', fs.realpathSync(dir));
    await new Promise(r => setTimeout(r, 10));   // 让 updatedAt 能变化
    await ws.attachSession('sess-ok');
    assert.deepStrictEqual(ws.sessionIds, ['sess-ok']);
    assert.ok(ws.updatedAt >= before);
    // 持久化验证：重新从 db 读
    const reg2 = createWorkspaceRegistry(env.db);
    assert.deepStrictEqual(reg2.get(ws.id).sessionIds, ['sess-ok']);
  } finally { cleanup(env); }
});

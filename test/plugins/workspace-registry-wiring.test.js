/**
 * [022] 接线测试：ctx.get('workspaceRegistry') 返回持久化注册表
 *
 * 契约来源：docs/dsh-compat-decisions.md 9.5 + 022 档案 C4-D
 *   - host.db 有值 → 返回真实 registry（create/get/list 可用）
 *   - host.db 缺失 → 返回空壳（get 返回 undefined，create 抛错）
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

/** 建一个带 sessions + workspaces 表的内存 db */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      logic_id TEXT PRIMARY KEY,
      project_dir TEXT,
      title TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

/** 写一个最小插件，apply 里调 ctx.get('workspaceRegistry') 并把结果挂到 globalThis */
function makePlugin(dir, globalKey, code) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ws-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    'export function apply(ctx) {',
    '  globalThis.__' + globalKey + '__ = (async () => {',
    code,
    '  })();',
    '}',
  ].join('\n'), 'utf-8');
}

test('[022] workspaceRegistry：host.db 有值 → 返回真实注册表（create/get/list）', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-wsreg-ok-'));
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-proj-'));
  const db = makeDb();
  try {
    makePlugin(pluginDir, 'wsrOk', [
      "    const reg = ctx.get('workspaceRegistry');",
      "    const ws = await reg.create('" + projDir.replace(/\\/g, '\\\\') + "');",
      "    const got = reg.get(ws.id);",
      "    const all = reg.list();",
      "    return { wsId: ws.id, wsPath: ws.path, gotId: got && got.id, listLen: all.length };",
    ].join('\n'));

    await loadCuckooPlugin(pluginDir, { db });
    const result = await globalThis.__wsrOk__;

    assert.ok(result.wsId, 'create 应返回 id');
    assert.ok(result.wsPath, 'create 应返回 path');
    assert.strictEqual(result.gotId, result.wsId, 'get 应能查到刚建的');
    assert.strictEqual(result.listLen, 1, 'list 应返回 1 条');
  } finally {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.rmSync(projDir, { recursive: true, force: true });
  }
});

test('[022] workspaceRegistry：host.db 缺失 → 返回空壳（get=undefined，create 抛错）', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-wsreg-null-'));
  try {
    makePlugin(pluginDir, 'wsrNull', [
      "    const reg = ctx.get('workspaceRegistry');",
      "    const getResult = reg.get('any-id');",
      "    const listResult = reg.list();",
      "    let createErr = null;",
      "    try { await reg.create('C:/whatever'); } catch (e) { createErr = e.message; }",
      "    return { getResult, listLen: listResult.length, createErr };",
    ].join('\n'));

    await loadCuckooPlugin(pluginDir, {});  // 不传 db
    const result = await globalThis.__wsrNull__;

    assert.strictEqual(result.getResult, undefined, 'get 应返回 undefined');
    assert.strictEqual(result.listLen, 0, 'list 应返回空数组');
    assert.ok(/db not available/.test(result.createErr || ''), 'create 应抛 db not available');
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

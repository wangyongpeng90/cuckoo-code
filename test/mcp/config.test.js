'use strict';
/**
 * mcp/config 测试：配置读写 + server 增删改（启/停）
 * electron 的 app.getPath 是外部边界，mock 它指向临时目录（符合"只 mock 外部边界"原则）。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal();
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = path.join(os.tmpdir(), 'cuckoo-mcp-config-test');
  return {
    ...actual,
    createRequire: () => (id) => {
      if (id === 'electron') return { app: { getPath: () => dir } };
      throw new Error('unexpected require: ' + id);
    },
  };
});

let cfg;
let TMP;

beforeEach(async () => {
  vi.resetModules();
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  TMP = path.join(os.tmpdir(), 'cuckoo-mcp-config-test');
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  cfg = await import('../../src/mcp/config.js');
});

test('readConfig 文件不存在返回空结构', () => {
  assert.deepStrictEqual(cfg.readConfig(), { mcpServers: {} });
});

test('upsertServer 写入 stdio 配置', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'server'] });
  const c = cfg.readConfig();
  assert.strictEqual(c.mcpServers.fs.command, 'npx');
  assert.deepStrictEqual(c.mcpServers.fs.args, ['-y', 'server']);
});

test('upsertServer 写入 http 配置（带 url/headers）', () => {
  cfg.upsertServer({ name: 'db', type: 'http', url: 'https://x', headers: { a: '1' } });
  const c = cfg.readConfig();
  assert.strictEqual(c.mcpServers.db.url, 'https://x');
  assert.deepStrictEqual(c.mcpServers.db.headers, { a: '1' });
  // http 类型不应写 command
  assert.strictEqual(c.mcpServers.db.command, undefined);
});

test('getServers 默认启用，type 由 url 决定', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx' });
  cfg.upsertServer({ name: 'db', type: 'http', url: 'https://x' });
  const list = cfg.getServers();
  const fsS = list.find(s => s.name === 'fs');
  const dbS = list.find(s => s.name === 'db');
  assert.strictEqual(fsS.type, 'stdio');
  assert.strictEqual(fsS.enabled, true, '默认启用');
  assert.strictEqual(dbS.type, 'http');
});

test('setServerEnabled(false) 后 getEnabledServers 不含它', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx' });
  cfg.setServerEnabled('fs', false);
  assert.strictEqual(cfg.getServers().find(s => s.name === 'fs').enabled, false);
  assert.strictEqual(cfg.getEnabledServers().length, 0);
});

test('removeServer 同时清配置与状态', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx' });
  cfg.setServerEnabled('fs', false);
  cfg.removeServer('fs');
  assert.strictEqual(cfg.getServers().length, 0);
  // 状态文件里也应无 fs（重建后默认启用，但配置已删 → getServers 为空）
  assert.strictEqual(cfg.readConfig().mcpServers.fs, undefined);
});

test('upsertServer 覆盖同名 server', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'a' });
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'b' });
  assert.strictEqual(cfg.readConfig().mcpServers.fs.command, 'b');
  assert.strictEqual(cfg.getServers().length, 1);
});

'use strict';
/**
 * mcp-manager 校验逻辑测试：handleMcpSave 的配置校验失败路径
 * DOM/electronAPI/panel 是外部边界，按需 mock。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

let toasts = [];
vi.mock('../../../src/overlay/panel.js', () => ({
  showToast: (msg) => { toasts.push(msg); },
  showConfirmDialog: async () => false,
}));

let mgr;
let els;
let upserted;
let removed;

function setupGlobals() {
  els = {};
  upserted = [];
  removed = [];
  toasts = [];
  globalThis.window = {
    electronAPI: {
      listMcpServers: async () => ({ success: true, servers: [] }),
      upsertMcpServer: async (s) => { upserted.push(s); return { success: true }; },
      removeMcpServer: async (n) => { removed.push(n); return { success: true }; },
      getMcpTools: async () => ({ success: true, tools: [] }),
    },
  };
  globalThis.document = {
    getElementById: (id) => els[id] || null,
  };
}

function setJson(v) {
  els['cuckoo-mcp-json'] = { value: v };
}

beforeEach(async () => {
  vi.resetModules();
  setupGlobals();
  mgr = await import('../../../src/overlay/panels/mcp-manager.js');
});

test('空输入 → 提示"请输入配置"，不 upsert', async () => {
  setJson('   ');
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('请输入配置')));
  assert.strictEqual(upserted.length, 0);
});

test('非法 JSON → 提示保存失败', async () => {
  setJson('{ not json');
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('保存失败')));
  assert.strictEqual(upserted.length, 0);
});

test('缺少 mcpServers → 提示格式错误', async () => {
  setJson(JSON.stringify({ foo: 1 }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('mcpServers')));
});

test('server 定义非对象 → 报错', async () => {
  setJson(JSON.stringify({ mcpServers: { a: 'x' } }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('必须是对象')));
});

test('url 与 command 同时指定 → 报错', async () => {
  setJson(JSON.stringify({ mcpServers: { a: { url: 'https://x', command: 'npx' } } }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('不能同时指定')));
});

test('缺少 command 或 url → 报错', async () => {
  setJson(JSON.stringify({ mcpServers: { a: { foo: 1 } } }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('缺少 command 或 url')));
});

test('url 非字符串 → 报错', async () => {
  setJson(JSON.stringify({ mcpServers: { a: { url: 123 } } }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('url 必须是非空字符串')));
});

test('args 非数组 → 报错', async () => {
  setJson(JSON.stringify({ mcpServers: { a: { command: 'npx', args: 'x' } } }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('args 必须是数组')));
});

test('env 非对象 → 报错', async () => {
  setJson(JSON.stringify({ mcpServers: { a: { command: 'npx', env: [1] } } }));
  await mgr.handleMcpSave(() => {});
  assert.ok(toasts.some(t => t.includes('env 必须是对象')));
});

test('合法 stdio 配置 → upsert 成功', async () => {
  setJson(JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 's'] } } }));
  await mgr.handleMcpSave(() => {});
  assert.strictEqual(upserted.length, 1);
  assert.strictEqual(upserted[0].name, 'fs');
  assert.strictEqual(upserted[0].type, 'stdio');
});

test('合法 http 配置 → type=http', async () => {
  setJson(JSON.stringify({ mcpServers: { db: { url: 'https://x' } } }));
  await mgr.handleMcpSave(() => {});
  assert.strictEqual(upserted[0].type, 'http');
});

test('删除 JSON 里不存在的旧 server', async () => {
  window.electronAPI.listMcpServers = async () => ({ success: true, servers: [{ name: 'old' }] });
  setJson(JSON.stringify({ mcpServers: { new: { command: 'npx' } } }));
  await mgr.handleMcpSave(() => {});
  assert.deepStrictEqual(removed, ['old']);
  assert.strictEqual(upserted[0].name, 'new');
});

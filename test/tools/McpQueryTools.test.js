'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { McpListServersTool, McpGetToolsTool } from '../../src/tools/impl/mcp-query.js';

test('McpListServersTool 构造器', () => {
  const t = new McpListServersTool();
  assert.strictEqual(t.name, 'mcpListServers');
  assert.strictEqual(t.jsApi, 'mcpListServers()');
});

test('McpListServersTool apiMetas.doc', async () => {
  // [261125] usage 字段已合并进 doc（api.d.ts 精简）
  const { apiMetas } = await import('../../src/tools/impl/mcp-query.js');
  const meta = apiMetas.find((m) => m.name === 'mcpListServers');
  assert.ok(meta && meta.doc, 'doc 应存在');
  // 说明"列出已配置的 MCP server"且是使用前的前置步骤
  assert.match(meta.doc, /列出已配置的 MCP server/);
  assert.match(meta.doc, /先调用/);
});

test('McpGetToolsTool 构造器', () => {
  const t = new McpGetToolsTool();
  assert.strictEqual(t.name, 'mcpGetTools');
  assert.strictEqual(t.jsApi, 'mcpGetTools(serverName)');
  assert.ok(t.parameters.required.includes('server'));
});

test('McpGetToolsTool apiMetas.doc', async () => {
  const { apiMetas } = await import('../../src/tools/impl/mcp-query.js');
  const meta = apiMetas.find((m) => m.name === 'mcpGetTools');
  assert.ok(meta && meta.doc, 'doc 应存在');
  // 说明"查看指定 server 的工具"，并指向 mcpCall
  assert.match(meta.doc, /查看指定 MCP server/);
  assert.match(meta.doc, /mcpCall/);
});

test('McpGetToolsTool 缺 server 返回错误', async () => {
  const t = new McpGetToolsTool();
  const r = await t.execute({});
  assert.strictEqual(r.success, false);
  assert.match(r.error, /server 不能为空/);
});


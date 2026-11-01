'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { McpListServersTool, McpGetToolsTool } from '../../src/tools/impl/mcp-query.js';

test('McpListServersTool 构造器', () => {
  const t = new McpListServersTool();
  assert.strictEqual(t.name, 'mcpListServers');
  assert.strictEqual(t.jsApi, 'mcpListServers()');
});

test('McpListServersTool apiMetas.usage', async () => {
  const { apiMetas } = await import('../../src/tools/impl/mcp-query.js');
  const meta = apiMetas.find((m) => m.name === 'mcpListServers');
  assert.ok(meta && meta.usage, 'usage 应存在');
  assert.match(meta.usage, /mcpListServers/);
});

test('McpGetToolsTool 构造器', () => {
  const t = new McpGetToolsTool();
  assert.strictEqual(t.name, 'mcpGetTools');
  assert.strictEqual(t.jsApi, 'mcpGetTools(serverName)');
  assert.ok(t.parameters.required.includes('server'));
});

test('McpGetToolsTool apiMetas.usage', async () => {
  const { apiMetas } = await import('../../src/tools/impl/mcp-query.js');
  const meta = apiMetas.find((m) => m.name === 'mcpGetTools');
  assert.ok(meta && meta.usage, 'usage 应存在');
  assert.match(meta.usage, /mcpGetTools/);
});

test('McpGetToolsTool 缺 server 返回错误', async () => {
  const t = new McpGetToolsTool();
  const r = await t.execute({});
  assert.strictEqual(r.success, false);
  assert.match(r.error, /server 不能为空/);
});


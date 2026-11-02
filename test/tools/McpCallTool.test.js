'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { McpCallTool } from '../../src/tools/impl/mcp-call.js';

test('McpCallTool 构造器', () => {
  const t = new McpCallTool();
  assert.strictEqual(t.name, 'mcpCall');
  assert.strictEqual(t.jsApi, 'mcpCall(server, tool, args)');
  assert.ok(t.parameters.required.includes('server'));
  assert.ok(t.parameters.required.includes('tool'));
});

test('McpCallTool apiMetas.usage 提到前置查询工具', async () => {
  const { apiMetas } = await import('../../src/tools/impl/mcp-call.js');
  const usage = apiMetas[0].usage;
  assert.ok(typeof usage === 'string' && usage.length > 0, 'usage 应存在');
  assert.match(usage, /mcpCall/);
  assert.match(usage, /mcpListServers/);
  assert.match(usage, /mcpGetTools/);
});

test('McpCallTool 缺 server 返回错误', async () => {
  const t = new McpCallTool();
  const r = await t.execute({});
  assert.strictEqual(r.success, false);
  assert.match(r.error, /server 不能为空/);
});

test('McpCallTool 缺 tool 返回错误', async () => {
  const t = new McpCallTool();
  const r = await t.execute({ server: 'everything' });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /tool 不能为空/);
});


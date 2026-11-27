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

test('McpCallTool apiMetas.doc 提到前置查询工具', async () => {
  // [261125] usage 字段已合并进 doc（api.d.ts 精简），断言改为看 doc
  const { apiMetas } = await import('../../src/tools/impl/mcp-call.js');
  const doc = apiMetas[0].doc;
  assert.ok(typeof doc === 'string' && doc.length > 0, 'doc 应存在');
  // 说明"调用 MCP 工具"，并指向两个前置查询工具
  assert.match(doc, /MCP server 的工具/);
  assert.match(doc, /mcpListServers/);
  assert.match(doc, /mcpGetTools/);
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


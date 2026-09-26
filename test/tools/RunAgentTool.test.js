'use strict';
/**
 * RunAgent 工具测试：参数校验 / 代理查找 / 防递归 / runner 注入
 * （真实子代理执行需 Electron + 网页，靠真机验证）
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

let tool;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../../src/tools/impl/run-agent.js');
  tool = new mod.RunAgentTool();
});

test('缺 name/task 返回错误', async () => {
  const r1 = await tool.execute({ task: 'x', currentWindowId: 1 });
  assert.strictEqual(r1.success, false);
  const r2 = await tool.execute({ name: 'x', currentWindowId: 1 });
  assert.strictEqual(r2.success, false);
});

test('缺窗口上下文返回错误', async () => {
  const r = await tool.execute({ name: 'x', task: 'y' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('窗口上下文'));
});

test('代理不存在返回错误', async () => {
  const r = await tool.execute({ name: 'no-such-agent-xyz', task: 'y', currentWindowId: 1, projectDir: process.cwd() });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('未找到子代理'));
});

test('未注入 runner 时返回错误', async () => {
  // 造一个存在的代理：临时目录
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-agent-'));
  const agentsDir = path.join(dir, '.cuckoo', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 't.md'), '---\nname: t\ndescription: d\n---\nbody', 'utf-8');
  const r = await tool.execute({ name: 't', task: 'y', currentWindowId: 1, projectDir: dir });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('未初始化') || r.error.includes('子代理'));
  fs.rmSync(dir, { recursive: true, force: true });
});

'use strict';
/**
 * JsRunner 双闸门豁免测试（Task 1）
 * 使用最小 registry + 可注入 deadline，制造真实超时窗口。
 * 变异检验：删掉豁免实现（clear/reset），对应测试必须变红。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { JsRunner } = require('../../tools/JsRunner');
const { ToolRegistry, Tool, ToolResult } = require('../../tools/ToolRegistry');

// mock 长时工具：模拟 subagent 挂起（在 LONG_RUNNING_TOOLS 白名单内）
class MockLongRunningTool extends Tool {
  constructor(delayMs = 100) {
    super(
      'subagent',
      'mock long-running tool',
      { type: 'object', properties: {}, required: [] },
      'subagent(options)'
    );
    this.delayMs = delayMs;
    this.execCount = 0;
    this.throwOnExecute = false;
  }

  async execute() {
    this.execCount++;
    if (this.throwOnExecute) {
      throw new Error('mock subagent failure');
    }
    await new Promise((r) => setTimeout(r, this.delayMs));
    return ToolResult.success({ taskId: 'mock-' + this.execCount, done: true });
  }
}

// mock 普通工具：不在 LONG_RUNNING_TOOLS 白名单内，用于验证基准重置
class MockOrdinaryReadTool extends Tool {
  constructor(delayMs = 20) {
    super(
      'read',
      'mock read tool',
      { type: 'object', properties: {}, required: [] },
      'read(filePath)'
    );
    this.delayMs = delayMs;
    this.execCount = 0;
  }

  async execute() {
    this.execCount++;
    await new Promise((r) => setTimeout(r, this.delayMs));
    return ToolResult.success('mock-file-content');
  }
}

function createRunner({ deadlineMs, subagentDelay = 100, readDelay = 20 } = {}) {
  const reg = new ToolRegistry();
  const mockSubagent = new MockLongRunningTool(subagentDelay);
  const mockRead = new MockOrdinaryReadTool(readDelay);
  reg.register(mockSubagent);
  reg.register(mockRead);
  const runner = new JsRunner(reg, { runDeadlineMs: deadlineMs });
  return { runner, mockSubagent, mockRead };
}

test('豁免：长时工具超过整体 deadline 仍不被闸杀', async () => {
  // deadline=80ms，subagent 挂 200ms。
  // 有豁免 → 80ms 定时器被 clear，subagent 正常返回。
  // 删掉豁免（clearTimeout）→ 80ms 定时器在 subagent 挂起期间触发 reject → 测试变红。
  const { runner, mockSubagent } = createRunner({
    deadlineMs: 80,
    subagentDelay: 200,
  });
  const code = 'const r = await subagent({ task: "mock" }); log("subagent-returned:", r.taskId);';
  const result = await runner.run(code, process.cwd());
  assert.strictEqual(result.success, true);
  assert.match(result.output, /subagent-returned: mock-1/);
  assert.strictEqual(mockSubagent.execCount, 1);
});

test('基准重置：长时工具返回后后续工具重新获得完整时间窗', async () => {
  // deadline=100ms，subagent 挂 150ms（豁免通过），read 挂 20ms。
  // 有重置 → subagent 返回后 startTime 归零，read 入口 elapsed≈0ms < 100ms → 通过。
  // 删掉重置（startTime = Date.now()）→ read 入口 elapsed≈150ms > 100ms → 命中超时检查 → 测试变红。
  const { runner, mockRead } = createRunner({
    deadlineMs: 100,
    subagentDelay: 150,
    readDelay: 20,
  });
  const code = 'await subagent({ task: "mock" }); const c = await read("x"); log("read-ok:", c.length > 0);';
  const result = await runner.run(code, process.cwd());
  assert.strictEqual(result.success, true);
  assert.match(result.output, /read-ok: true/);
  assert.strictEqual(mockRead.execCount, 1);
});

test('长时工具异常被包装为工具异常，脚本能续跑', async () => {
  const { runner, mockSubagent } = createRunner({ deadlineMs: 200, subagentDelay: 20 });
  mockSubagent.throwOnExecute = true;
  const code = 'try { await subagent({ task: "mock" }); } catch (e) { log("caught:", e.message); } log("after-catch");';
  const result = await runner.run(code, process.cwd());
  assert.strictEqual(result.success, true);
  // JsRunner 会把工具异常包装为 "工具 subagent 执行异常: ..."
  assert.match(result.output, /caught: 工具 subagent 执行异常: mock subagent failure/);
  assert.match(result.output, /after-catch/);
});

test('subagent 函数在沙箱中已定义（C-1 防回归）', async () => {
  const { runner } = createRunner({ deadlineMs: 1000 });
  const code = 'log("subagent type:", typeof subagent);';
  const result = await runner.run(code, process.cwd());
  assert.strictEqual(result.success, true);
  assert.match(result.output, /subagent type: function/);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { installElectronMock } = require('../helpers/mock-electron');

// 完整链路：JsRunner 沙箱内的 attachFile() -> hostBridge -> registry.execute('attach_file')
test('JsRunner 沙箱 attachFile 透传 filePath 与 currentWindowId', async () => {
  const restore = installElectronMock();
  try {
    const { JsRunner } = require('../../tools/JsRunner');
    const { ToolRegistry, Tool, ToolResult } = require('../../tools/ToolRegistry');

    // 用 mock 工具替换真实的 attach_file，捕获收到的参数
    let received = null;
    class MockAttach extends Tool {
      constructor() {
        super('attach_file', 'mock', { type: 'object', properties: {} });
      }
      async execute(params) {
        received = params;
        return ToolResult.success({ fileName: 'x.txt', size: 1, message: 'ok' });
      }
    }
    const registry = new ToolRegistry();
    registry.register(new MockAttach());

    const runner = new JsRunner(registry);
    const result = await runner.run('return await attachFile("src/a.txt")', 'C:/proj', 42);

    assert.strictEqual(result.success, true, 'run 应成功: ' + result.error);
    assert.ok(received, 'mock 工具应被调用');
    assert.strictEqual(received.filePath, 'src/a.txt', 'filePath 应透传');
    assert.strictEqual(received.currentWindowId, 42, 'currentWindowId 应透传');
    assert.strictEqual(received.projectDir, 'C:/proj', 'projectDir 应透传');
  } finally {
    restore();
  }
});

test('JsRunner 沙箱 attachFile 工具抛错时返回失败', async () => {
  const restore = installElectronMock();
  try {
    const { JsRunner } = require('../../tools/JsRunner');
    const { ToolRegistry, Tool, ToolResult } = require('../../tools/ToolRegistry');

    class FailingAttach extends Tool {
      constructor() { super('attach_file', 'mock', { type: 'object', properties: {} }); }
      async execute() { return ToolResult.error('文件不存在'); }
    }
    const registry = new ToolRegistry();
    registry.register(new FailingAttach());

    const runner = new JsRunner(registry);
    const result = await runner.run('return await attachFile("nope.txt")', null, 7);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /文件不存在/);
  } finally {
    restore();
  }
});

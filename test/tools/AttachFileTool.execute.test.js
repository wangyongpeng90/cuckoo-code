'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installElectronMock, fakeElectron } = require('../helpers/mock-electron');

let restoreElectron;

beforeEach(() => {
  restoreElectron = installElectronMock();
  // 每次重新加载，确保拿到 mock 的 electron
  delete require.cache[require.resolve('../../tools/AttachFileTool')];
});

afterEach(() => {
  if (restoreElectron) restoreElectron();
});

function makeWindow(id, executeImpl) {
  const win = {
    id,
    isDestroyed: () => false,
    webContents: { executeJavaScript: executeImpl },
  };
  fakeElectron.BrowserWindow._registry.set(id, win);
  return win;
}

test('attach_file 缺少窗口上下文报错', async () => {
  const { AttachFileTool } = require('../../tools/AttachFileTool');
  const tool = new AttachFileTool();
  const res = await tool.execute({ filePath: 'x.txt', projectDir: os.tmpdir(), windowId: null });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /窗口/);
});

test('attach_file 文件不存在报错', async () => {
  const { AttachFileTool } = require('../../tools/AttachFileTool');
  const tool = new AttachFileTool();
  makeWindow(101, async () => ({ success: true, fileName: 'x' }));
  const res = await tool.execute({ filePath: 'definitely-missing-xyz.txt', projectDir: os.tmpdir(), windowId: 101 });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /文件不存在/);
});

test('attach_file 目标为目录报错', async () => {
  const { AttachFileTool } = require('../../tools/AttachFileTool');
  const tool = new AttachFileTool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-dir-'));
  makeWindow(102, async () => ({ success: true, fileName: 'x' }));
  const res = await tool.execute({ filePath: dir, windowId: 102 });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /不是文件/);
});

test('attach_file 成功路径：读取文件并以 base64 注入', async () => {
  const { AttachFileTool } = require('../../tools/AttachFileTool');
  const tool = new AttachFileTool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-ok-'));
  const file = path.join(dir, 'demo.md');
  fs.writeFileSync(file, '# hello attach');

  let captured = null;
  makeWindow(103, async (code) => {
    captured = code;
    return { success: true, fileName: 'demo.md' };
  });

  const res = await tool.execute({ filePath: 'demo.md', projectDir: dir, windowId: 103 });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.fileName, 'demo.md');
  assert.strictEqual(res.data.size, fs.statSync(file).size);
  // 注入代码包含 base64 内容与文件名
  const expectedB64 = fs.readFileSync(file).toString('base64');
  assert.ok(captured.includes(expectedB64), '注入代码应包含文件 base64');
  assert.ok(captured.includes('demo.md'), '注入代码应包含文件名');
  assert.ok(captured.includes('DataTransfer'), '注入代码应使用 DataTransfer');
  fakeElectron.BrowserWindow._registry.delete(103);
});

test('attach_file 上传失败透传错误', async () => {
  const { AttachFileTool } = require('../../tools/AttachFileTool');
  const tool = new AttachFileTool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-fail-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'data');
  makeWindow(104, async () => ({ success: false, error: '上传超时，未检测到附件出现' }));
  const res = await tool.execute({ filePath: 'a.txt', projectDir: dir, windowId: 104 });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /上传超时/);
  fakeElectron.BrowserWindow._registry.delete(104);
});

test('attach_file 窗口不存在报错', async () => {
  const { AttachFileTool } = require('../../tools/AttachFileTool');
  const tool = new AttachFileTool();
  const res = await tool.execute({ filePath: 'a.txt', windowId: 99999 });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /窗口/);
});

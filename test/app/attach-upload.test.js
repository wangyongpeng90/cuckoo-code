'use strict';
/**
 * attach-upload 公共上传通道测试
 *
 * 覆盖本次飞书图片修复的核心：
 *   1. attachFn（注入页面的合成事件通道）—— 关键：dispatch 成功即算成功（图片无文件名文本）
 *   2. uploadAttachment —— CDP 优先，失败兜底合成事件
 *
 * attach-upload.ts 顶层 import cdp-attach.js（间接依赖 electron），
 * 故此处 mock 掉 cdp-attach.js（外部边界），只测本模块自身逻辑。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

// mock cdp-attach.js：切断对 electron/provider 的依赖，并让测试可控返回
let cdpResult = { success: false, error: 'mock-default' };
let cdpCalls = [];
vi.mock('../../src/app/ipc/cdp-attach.js', () => ({
  cdpAttach: async (ctx, file) => {
    cdpCalls.push({ ctx, file });
    return cdpResult;
  },
}));

let attachFn;
let uploadAttachment;

beforeEach(async () => {
  vi.resetModules();
  cdpCalls = [];
  cdpResult = { success: false, error: 'mock-default' };
  ({ attachFn, uploadAttachment } = await import('../../src/app/ipc/attach-upload.js'));
});

// ---------- 假 DOM 工具 ----------

/** 造一个假的 file input（记录 dispatch 次数、可设 files） */
function makeInput() {
  const input = {
    _dispatched: 0,
    files: [],
    parentElement: null,
    innerText: '',
    dispatchEvent() { this._dispatched++; return true; },
  };
  return input;
}

/** 造一个最小可用的 window（atob / Uint8Array / File / DataTransfer / setTimeout / Date） */
function makeWindow() {
  return {
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    Uint8Array,
    File: function (parts, name, opts) { this.name = name; this.type = opts && opts.type; },
    DataTransfer: function () {
      this.items = { add() {} };
      this.files = [];
    },
    Event: function (type, opts) { this.type = type; this.bubbles = opts && opts.bubbles; },
    setTimeout: (fn) => setTimeout(fn, 0),
    Date,
  };
}

/** 造 document：querySelector 返回给定 input（或 null） */
function makeDoc(input) {
  return {
    querySelector() { return input; },
    querySelectorAll() { return []; },
    body: { innerText: '' },
  };
}

// ---------- attachFn ----------

test('attachFn：找到 input → dispatch 成功即返回成功（图片场景关键）', async () => {
  const input = makeInput();
  const doc = makeDoc(input);
  const win = makeWindow();
  // base64 "hi"
  const r = await attachFn(doc, win, Buffer.from('hi').toString('base64'), 'feishu-123.png', 'image/png', 5000, 10);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.fileName, 'feishu-123.png');
  assert.strictEqual(input._dispatched, 1, '应触发一次 change');
});

test('attachFn：文件名不含文本也能成功（图片缩略图场景，核心回归）', async () => {
  // 关键：input.innerText 与 body.innerText 都不含文件名 —— 旧逻辑会误判失败
  const input = makeInput();
  input.innerText = '';
  const doc = makeDoc(input);
  doc.body.innerText = '（只有缩略图，无文件名文本）';
  const win = makeWindow();
  const r = await attachFn(doc, win, 'aGk=', 'feishu-abc.png', 'image/png', 200, 10);
  // dispatch 成功即成功，不应进入 fileVisible 的等待/超时分支
  assert.strictEqual(r.success, true);
});

test('attachFn：找不到 input 且无上传按钮 → 失败', async () => {
  const doc = makeDoc(null);          // querySelector 返回 null
  doc.querySelectorAll = () => [];    // 无候选按钮
  const win = makeWindow();
  // 内部会等 2500ms 再放弃；测试超时 30s 够用
  const r = await attachFn(doc, win, 'aGk=', 'x.png', 'image/png', 100, 10);
  assert.strictEqual(r.success, false);
  assert.match(r.error, /未找到文件上传输入框/);
});

test('attachFn：dispatchEvent 抛错时走退化检测 → 最终超时失败', async () => {
  const input = makeInput();
  input.dispatchEvent = () => { throw new Error('boom'); };
  const doc = makeDoc(input);
  const win = makeWindow();
  // submitted=false → 进入 fileVisible 循环；fileVisible 永远 false → 超时
  const r = await attachFn(doc, win, 'aGk=', 'x.png', 'image/png', 50, 10);
  assert.strictEqual(r.success, false);
  assert.match(r.error, /上传超时/);
});

// ---------- uploadAttachment ----------

test('uploadAttachment：无 view → no-ai-view', async () => {
  const r = await uploadAttachment({}, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.error, 'no-ai-view');
  assert.strictEqual(cdpCalls.length, 0, '不应调用 cdpAttach');
});

test('uploadAttachment：view 已销毁 → no-ai-view', async () => {
  const ctx = { view: { webContents: { isDestroyed: () => true } } };
  const r = await uploadAttachment(ctx, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.error, 'no-ai-view');
});

test('uploadAttachment：CDP 成功 → 直接返回，不走合成兜底', async () => {
  cdpResult = { success: true, mode: 'cdp' };
  let execCalled = false;
  const ctx = { providerId: 'deepseek', view: { webContents: { isDestroyed: () => false, executeJavaScript: async () => { execCalled = true; return { success: true }; } } } };
  const r = await uploadAttachment(ctx, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.mode, 'cdp');
  assert.strictEqual(cdpCalls.length, 1, '应调用一次 cdpAttach');
  assert.strictEqual(execCalled, false, 'CDP 成功时不应执行合成脚本');
});

test('uploadAttachment：CDP 失败 → 兜底合成事件，成功则返回 synthetic', async () => {
  cdpResult = { success: false, error: 'file-chooser-timeout' };
  const ctx = { providerId: 'deepseek', view: { webContents: { isDestroyed: () => false, executeJavaScript: async () => ({ success: true, fileName: 'a.png' }) } } };
  const r = await uploadAttachment(ctx, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.mode, 'synthetic');
  assert.strictEqual(cdpCalls.length, 1);
});

test('uploadAttachment：CDP 抛异常 → 仍兜底合成事件', async () => {
  cdpResult = null; // 让 mock 返回 null（非异常，但走兜底）
  const ctx = { providerId: 'deepseek', view: { webContents: { isDestroyed: () => false, executeJavaScript: async () => ({ success: true }) } } };
  const r = await uploadAttachment(ctx, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.mode, 'synthetic');
});

test('uploadAttachment：CDP 与合成都失败 → 返回失败并带 error', async () => {
  cdpResult = { success: false, error: 'cdp-fail' };
  const ctx = { providerId: 'deepseek', view: { webContents: { isDestroyed: () => false, executeJavaScript: async () => ({ success: false, error: 'synthetic-fail' }) } } };
  const r = await uploadAttachment(ctx, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.error, 'synthetic-fail');
});

test('uploadAttachment：合成脚本抛错 → 返回 inject-failed', async () => {
  cdpResult = { success: false, error: 'cdp-fail' };
  const ctx = { providerId: 'deepseek', view: { webContents: { isDestroyed: () => false, executeJavaScript: async () => { throw new Error('eval boom'); } } } };
  const r = await uploadAttachment(ctx, { name: 'a.png', data: 'aGk=', mime: 'image/png' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.error, 'eval boom');
});

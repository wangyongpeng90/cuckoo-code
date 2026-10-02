'use strict';
/**
 * 框架侧投递反馈：isSystemTag 判定 + onMessageDelivered 派发
 * （纯净模式据此显示"框架正在驱动 AI 页面"的运行态）
 *
 * window/document/provider 是外部边界，按需 mock（与 chat-input.test.js 同款）。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRequire: () => () => ({ ipcRenderer: { on: () => {}, invoke: async () => ({}) } }),
  };
});

vi.mock('../../src/providers/registry.js', () => ({
  getProviderByUrl: () => null,
}));

let chat;

/** 构造可见 textarea（原型带 value 访问器，走 setInputContent 的原生 setter 分支） */
function makeTextarea() {
  const proto = window.HTMLTextAreaElement.prototype;
  if (!Object.getOwnPropertyDescriptor(proto, 'value')) {
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get() { return this._v || ''; },
      set(v) { this._v = v; },
    });
  }
  return {
    __style: { display: 'block', visibility: 'visible', opacity: '1' },
    tagName: 'TEXTAREA',
    focus() {},
    dispatchEvent() {},
  };
}

function setupGlobals() {
  globalThis.window = {
    location: { href: 'https://chat.deepseek.com/' },
    getComputedStyle: (el) => el.__style || { display: 'block', visibility: 'visible', opacity: '1' },
    HTMLTextAreaElement: { prototype: {} },
    HTMLInputElement: { prototype: {} },
  };
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ style: {} }),
    body: { appendChild() {} },
    execCommand: () => true,
  };
  globalThis.Event = class { constructor() {} };
  globalThis.KeyboardEvent = class { constructor() {} };
  globalThis.ClipboardEvent = class { constructor() {} };
  globalThis.DataTransfer = class { setData() {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
}

beforeEach(async () => {
  vi.resetModules();
  setupGlobals();
  chat = await import('../../src/overlay/chat-input.js');
});

test('isSystemTag：框架内部消息全部命中', () => {
  for (const tag of ['JS汇总', '看门狗', '重试', '重试(操作频繁)', '压缩-摘要', 'MCP信息',
    '技能与代理清单', '继续', 'JSON工具调用提示', 'XML工具调用提示', '系统提示词', '飞书']) {
    assert.strictEqual(chat.isSystemTag(tag), true, tag + ' 应判定为系统消息');
  }
});

test('isSystemTag：用户与 harness 消息不算系统消息', () => {
  assert.strictEqual(chat.isSystemTag('harness'), false);
  assert.strictEqual(chat.isSystemTag('生成文档'), false);
  assert.strictEqual(chat.isSystemTag(undefined), false);
  assert.strictEqual(chat.isSystemTag(''), false);
});

test('onMessageDelivered：框架消息投递时派发且标记 isSystem', async () => {
  document.querySelectorAll = () => [makeTextarea()];
  const got = [];
  chat.onMessageDelivered((info) => got.push(info));

  const ok = await chat.sendToChat('【JS 执行结果汇总】...', 'JS汇总', 0);
  assert.strictEqual(ok, true, '投递应成功（输入框可见）');
  await new Promise((r) => setTimeout(r, 20)); // 投递是异步的（setTimeout 0）

  assert.strictEqual(got.length, 1, '应派发一次投递事件');
  assert.strictEqual(got[0].tag, 'JS汇总');
  assert.strictEqual(got[0].isSystem, true, '工具结果回传应标记为系统消息');
});

test('onMessageDelivered：用户消息投递时 isSystem=false', async () => {
  document.querySelectorAll = () => [makeTextarea()];
  const got = [];
  chat.onMessageDelivered((info) => got.push(info));

  await chat.sendToChat('你好', 'harness', 0);
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].isSystem, false);
});

test('找不到输入框时不派发投递事件', async () => {
  document.querySelectorAll = () => [];
  const got = [];
  chat.onMessageDelivered((info) => got.push(info));
  const ok = await chat.sendToChat('test', 'JS汇总', 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(ok, false);
  assert.strictEqual(got.length, 0);
});

test('取消注册后不再派发', async () => {
  document.querySelectorAll = () => [];
  const got = [];
  const off = chat.onMessageDelivered((info) => got.push(info));
  off();
  await chat.sendToChat('test', 'JS汇总', 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(got.length, 0);
});

'use strict';
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';

// watchdog 是带模块级状态的单例，用 resetModules + 动态 import 隔离
let wd;
let win;

function setupGlobals() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  // 支持事件派发的 window 模拟
  const listeners = {};
  win = {
    location: { href: 'https://chat.deepseek.com/a/chat/s/abc123' },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
    _dispatch: (type, detail) => {
      for (const fn of listeners[type] || []) fn({ type, detail });
    },
  };
  globalThis.window = win;
  globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, appendChild() {} }),
    body: { appendChild() {} },
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return store;
}

/** 派发一次流静默事件（默认用当前会话 ID） */
function emitIdle(sessionId) {
  win._dispatch('cuckoo-stream-idle', { sessionId });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  setupGlobals();
  wd = await import('../../../src/bridge/loop/watchdog.js');
});

afterEach(() => {
  wd.reset();
  wd.setSuspended(false);
  vi.useRealTimers();
});

test('_readConfig 返回默认值', () => {
  const cfg = wd._readConfig();
  assert.strictEqual(cfg.prompt, '请继续');
  assert.strictEqual(cfg.count, 3);
});

test('_readConfig 从 localStorage 覆盖', () => {
  localStorage.setItem('cuckoo-watchdog-prompt', '继续吧');
  localStorage.setItem('cuckoo-watchdog-count', '5');
  const cfg = wd._readConfig();
  assert.strictEqual(cfg.prompt, '继续吧');
  assert.strictEqual(cfg.count, 5);
});

test('_readConfig 非法值回退默认', () => {
  localStorage.setItem('cuckoo-watchdog-count', 'xyz');
  const cfg = wd._readConfig();
  assert.strictEqual(cfg.count, 3);
});

test('未启动时派发静默事件不计数', () => {
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 0);
});

test('启动后派发静默事件计数 +1', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 2);
});

test('startWatchdog 幂等（重复调用不重复注册）', () => {
  wd.startWatchdog();
  wd.startWatchdog();
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
});

test('会话不匹配时忽略静默事件', () => {
  wd.startWatchdog();
  emitIdle('other-session'); // 与当前 URL 会话 abc123 不符
  assert.strictEqual(wd._getIdleCount(), 0);
});

test('会话匹配时处理静默事件', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
});

test('次数达上限后停止催继续', () => {
  localStorage.setItem('cuckoo-watchdog-count', '1');
  wd.startWatchdog();
  emitIdle('abc123'); // 第 1 次
  assert.strictEqual(wd._getIdleCount(), 1);
  emitIdle('abc123'); // 达上限，不再增
  assert.strictEqual(wd._getIdleCount(), 1);
});

test('次数为负数表示无限', () => {
  localStorage.setItem('cuckoo-watchdog-count', '-1');
  wd.startWatchdog();
  for (let i = 0; i < 5; i++) emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 5);
});

test('onResponseReceived(finished) 重置计数', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 2);
  wd.onResponseReceived('finished');
  assert.strictEqual(wd._getIdleCount(), 0);
});

test('onResponseReceived(error) 不重置计数', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  wd.onResponseReceived('error');
  assert.strictEqual(wd._getIdleCount(), 1);
});

test('reset 清理计数', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  wd.reset();
  assert.strictEqual(wd._getIdleCount(), 0);
});

test('setSuspended(true) 后忽略静默事件', () => {
  wd.startWatchdog();
  wd.setSuspended(true);
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 0);
});

test('setSuspended(true) 会清空进行中计数', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
  wd.setSuspended(true);
  assert.strictEqual(wd._getIdleCount(), 0);
  wd.setSuspended(false);
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
});

test('startSessionWatcher 记录初始会话；checkSessionChange 检测切换后重置', () => {
  wd.startWatchdog();
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
  // 记录初始会话（abc123）
  wd.startSessionWatcher();
  // 切到新会话，主动调用 checkSessionChange（现在由 URL 变化事件驱动）
  win.location.href = 'https://chat.deepseek.com/a/chat/s/def456';
  wd.checkSessionChange();
  assert.strictEqual(wd._getIdleCount(), 0);
});

test('checkSessionChange 会话未变时不重置', () => {
  wd.startWatchdog();
  wd.startSessionWatcher();
  emitIdle('abc123');
  assert.strictEqual(wd._getIdleCount(), 1);
  wd.checkSessionChange(); // 会话未变
  assert.strictEqual(wd._getIdleCount(), 1);
});

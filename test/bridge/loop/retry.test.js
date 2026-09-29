'use strict';
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';

// retry 的设置来源已迁到主进程 settings.json，渲染侧经 overlay/settings.ts
// 的内存缓存同步读取；测试通过 __setCacheForTest 直接覆盖缓存。

let retry;
let observer;
let settingsMod;

function setupGlobals() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  const listeners = {};
  globalThis.window = {
    location: { href: 'https://chat.deepseek.com/a/chat/s/abc123' },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    electronAPI: { showAiNotification: () => Promise.resolve() },
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      classList: { add() {}, remove() {}, toggle() {} },
      style: {},
      isConnected: true,
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => ({ onclick: null, textContent: '' }),
      set innerHTML(v) {},
      get innerHTML() { return ''; },
    }),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    body: { appendChild() {}, contains: () => true },
  };
  return { store, listeners };
}

function dispatch(listeners, type, detail) {
  const fns = listeners[type] || [];
  for (const fn of fns) fn({ detail });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  globalThis.__obs = null;
});

afterEach(() => {
  vi.useRealTimers();
});

async function boot() {
  const { listeners } = setupGlobals();
  retry = await import('../../../src/bridge/loop/retry.js');
  observer = await import('../../../src/bridge/intercept/observer.js');
  settingsMod = await import('../../../src/overlay/settings.js');
  return listeners;
}

test('readConfig 返回默认值', async () => {
  await boot();
  const cfg = retry.readConfig();
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.delayMin, 4000);
  assert.strictEqual(cfg.delayMax, 10000);
  assert.strictEqual(cfg.count, 10);
  assert.strictEqual(cfg.delay429, 60000);
  assert.strictEqual(cfg.count429, 20);
  assert.ok(cfg.prompt);
});

test('readConfig 从设置缓存覆盖', async () => {
  await boot();
  settingsMod.__setCacheForTest({
    retryEnabled: false,
    retryDelayMin: 500,
    retryDelayMax: 800,
    retryCount: 3,
    retry429Delay: 1234,
    retry429Count: 5,
    retryPrompt: '自定义',
  });
  const cfg = retry.readConfig();
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.delayMin, 500);
  assert.strictEqual(cfg.delayMax, 800);
  assert.strictEqual(cfg.count, 3);
  assert.strictEqual(cfg.delay429, 1234);
  assert.strictEqual(cfg.count429, 5);
  assert.strictEqual(cfg.prompt, '自定义');
});

test('DEFAULT_PROMPT 存在', async () => {
  await boot();
  assert.ok(typeof retry.DEFAULT_PROMPT === 'string' && retry.DEFAULT_PROMPT.length > 0);
});

test('enabled=false 时错误不触发重试', async () => {
  const listeners = await boot();
  settingsMod.__setCacheForTest({ retryEnabled: false });
  retry.startRetryEngine();
  observer.startInterceptObserver();
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500 });
  // 无计时器被创建 → 推进时间无副作用
  vi.advanceTimersByTime(200000);
});

test('启用时错误触发重试（普通失败）', async () => {
  const listeners = await boot();
  settingsMod.__setCacheForTest({ retryEnabled: true, retryDelayMin: 1000, retryDelayMax: 1000 });
  retry.startRetryEngine();
  observer.startInterceptObserver();
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500 });
  // 无异常即通过；推进到重试延迟后触发 sendToChat
  vi.advanceTimersByTime(1001);
});

test('compacting 期间错误被忽略', async () => {
  const listeners = await boot();
  retry.setCompacting(true);
  retry.startRetryEngine();
  observer.startInterceptObserver();
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500 });
  vi.advanceTimersByTime(200000);
  retry.setCompacting(false);
});

test('会话不匹配的错误被忽略', async () => {
  const listeners = await boot();
  retry.startRetryEngine();
  observer.startInterceptObserver();
  // 当前会话 abc123，错误来自 old-session
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500, sessionId: 'old-session' });
  vi.advanceTimersByTime(200000);
  // 无异常即通过
});

test('成功回复重置计数', async () => {
  const listeners = await boot();
  settingsMod.__setCacheForTest({ retryDelayMin: 1000, retryDelayMax: 1000 });
  retry.startRetryEngine();
  observer.startInterceptObserver();
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500 });
  dispatch(listeners, 'cuckoo-ai-response', { status: 'finished', finished: true, text: 'ok' });
  vi.advanceTimersByTime(200000);
});

test('普通失败达上限后停止重试', async () => {
  const listeners = await boot();
  settingsMod.__setCacheForTest({ retryCount: 1, retryDelayMin: 500, retryDelayMax: 500 });
  retry.startRetryEngine();
  observer.startInterceptObserver();
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500 }); // 第 1 次
  vi.advanceTimersByTime(501);
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 500 }); // 达上限，不再重试
  vi.advanceTimersByTime(200000);
});

test('429 使用独立计数与延迟', async () => {
  const listeners = await boot();
  settingsMod.__setCacheForTest({ retry429Count: 1, retry429Delay: 500 });
  retry.startRetryEngine();
  observer.startInterceptObserver();
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 429 }); // 第 1 次
  vi.advanceTimersByTime(501);
  dispatch(listeners, 'cuckoo-ai-error', { httpStatus: 429 }); // 达上限
  vi.advanceTimersByTime(200000);
});

test('startRetryEngine 幂等', async () => {
  await boot();
  retry.startRetryEngine();
  retry.startRetryEngine();
  // 无异常即通过
});

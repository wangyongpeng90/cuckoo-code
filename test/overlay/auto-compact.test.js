// @vitest-environment happy-dom
'use strict';
/**
 * auto-compact 运行态测试（Task 8 起设置 UI 已迁往 shell，本模块只管运行态）：
 * 配置来自 overlay/settings.ts 缓存（主进程 settings.json），
 * 收到回复后按阈值触发压缩；设置变更（本窗口/广播）同步运行态。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import { setupDom } from '../helpers/dom';

let autoCompact;
let settingsMod;
let dom;

function makeDeps(overrides = {}) {
  const deps = {
    onResponse: (cb) => { deps.responseCb = cb; },
    triggerCompaction: () => { deps.compactCalls.push(1); return Promise.resolve(); },
    notify: (msg, ms) => { deps.notifications.push([msg, ms]); },
    compactCalls: [],
    notifications: [],
    responseCb: null,
    ...overrides,
  };
  return deps;
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  dom = setupDom('');
  window.electronAPI = {};
  settingsMod = await import('../../src/overlay/settings.js');
  autoCompact = await import('../../src/overlay/auto-compact.js');
});

afterEach(() => {
  dom.cleanup();
  delete window.electronAPI;
});

test('默认配置：关闭 + 阈值 80 万，不触发压缩', () => {
  const deps = makeDeps();
  autoCompact.initAutoCompact(deps);
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 9999999 } });
  assert.strictEqual(deps.compactCalls.length, 0);
});

test('从设置缓存加载已有配置（运行态）', () => {
  settingsMod.__setCacheForTest({ autoCompactEnabled: true, autoCompactThreshold: 50 });
  const deps = makeDeps();
  autoCompact.initAutoCompact(deps);
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 499999 } });
  assert.strictEqual(deps.compactCalls.length, 0);
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 500000 } });
  assert.strictEqual(deps.compactCalls.length, 1);
});

test('低于阈值不触发，达到阈值触发并提示', () => {
  settingsMod.__setCacheForTest({ autoCompactEnabled: true, autoCompactThreshold: 80 });
  const deps = makeDeps();
  autoCompact.initAutoCompact(deps);
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 799999 } });
  assert.strictEqual(deps.compactCalls.length, 0);
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 800000 } });
  assert.strictEqual(deps.compactCalls.length, 1);
  assert.strictEqual(deps.notifications.length, 1);
  assert.strictEqual(deps.notifications[0][0].includes('80'), true);
});

test('压缩进行中不重复触发，完成后可再次触发', async () => {
  let release;
  const deps = makeDeps({
    triggerCompaction: () => { deps.compactCalls.push(1); return new Promise((r) => { release = r; }); },
  });
  settingsMod.__setCacheForTest({ autoCompactEnabled: true, autoCompactThreshold: 80 });
  autoCompact.initAutoCompact(deps);

  deps.responseCb('', { tokenUsage: { accumulatedTokens: 900000 } });
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 950000 } });
  assert.strictEqual(deps.compactCalls.length, 1); // 进行中，第二次被抑制

  release();
  await new Promise((r) => setTimeout(r, 0));
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 960000 } });
  assert.strictEqual(deps.compactCalls.length, 2); // 完成后允许再次触发
});

test('响应缺少 tokenUsage 时不触发也不报错', () => {
  settingsMod.__setCacheForTest({ autoCompactEnabled: true, autoCompactThreshold: 80 });
  const deps = makeDeps();
  autoCompact.initAutoCompact(deps);
  deps.responseCb('', null);
  deps.responseCb('', {});
  assert.strictEqual(deps.compactCalls.length, 0);
});

test('设置广播到达：运行态同步刷新（模拟另一窗口改动自动压缩配置）', () => {
  const deps = makeDeps();
  autoCompact.initAutoCompact(deps);
  // 另一窗口保存后，主进程广播 settings-changed → applyRemoteSettings
  settingsMod.applyRemoteSettings({
    ...settingsMod.getCachedSettings(),
    autoCompactEnabled: true,
    autoCompactThreshold: 20,
  });
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 199999 } });
  assert.strictEqual(deps.compactCalls.length, 0);
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 200000 } });
  assert.strictEqual(deps.compactCalls.length, 1);
});

test('广播关闭自动压缩后不再触发', () => {
  settingsMod.__setCacheForTest({ autoCompactEnabled: true, autoCompactThreshold: 20 });
  const deps = makeDeps();
  autoCompact.initAutoCompact(deps);
  settingsMod.applyRemoteSettings({
    ...settingsMod.getCachedSettings(),
    autoCompactEnabled: false,
  });
  deps.responseCb('', { tokenUsage: { accumulatedTokens: 9999999 } });
  assert.strictEqual(deps.compactCalls.length, 0);
});

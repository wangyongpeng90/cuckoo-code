'use strict';
/**
 * window-manager 渲染逻辑测试：renderWindowList（列表为空/有数据/失败兜底）
 * DOM/electronAPI/panel 是外部边界，按需 mock。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

let toasts = [];
vi.mock('../../../src/overlay/panel.js', () => ({
  showToast: (msg) => { toasts.push(msg); },
}));

let mgr;
let els;
let listEl;

function makeListEl() {
  return {
    innerHTML: '',
    querySelectorAll: () => [],
  };
}

function setupGlobals() {
  els = {};
  toasts = [];
  listEl = makeListEl();
  els['cuckoo-window-list'] = listEl;
  els['cuckoo-window-manager'] = {
    classList: { add() {}, remove() {} },
  };
  globalThis.window = { electronAPI: {} };
  globalThis.document = { getElementById: (id) => els[id] || null };
}

beforeEach(async () => {
  vi.resetModules();
  setupGlobals();
  mgr = await import('../../../src/overlay/panels/window-manager.js');
});

test('无 list 元素时直接返回', async () => {
  els['cuckoo-window-list'] = null;
  await mgr.renderWindowList();
  // 不抛错即通过
});

test('空列表显示"暂无窗口"', async () => {
  window.electronAPI.listProfiles = async () => ({ success: true, profiles: [] });
  await mgr.renderWindowList();
  assert.ok(listEl.innerHTML.includes('暂无窗口'));
});

test('listProfiles 失败时显示"暂无窗口"（profiles 回退空）', async () => {
  window.electronAPI.listProfiles = async () => ({ success: false });
  await mgr.renderWindowList();
  assert.ok(listEl.innerHTML.includes('暂无窗口'));
});

test('渲染窗口列表：名称 + 平台名', async () => {
  window.electronAPI.listProfiles = async () => ({
    success: true,
    profiles: [{ id: 'p1', name: '我的窗口', providerId: 'deepseek', autoOpen: false }],
  });
  window.electronAPI.listProviders = async () => ({
    success: true,
    providers: [{ id: 'deepseek', name: 'DeepSeek' }],
  });
  await mgr.renderWindowList();
  assert.ok(listEl.innerHTML.includes('我的窗口'));
  assert.ok(listEl.innerHTML.includes('DeepSeek'));
});

test('autoOpen=true 时复选框带 checked', async () => {
  window.electronAPI.listProfiles = async () => ({
    success: true,
    profiles: [{ id: 'p1', name: 'A', providerId: 'deepseek', autoOpen: true }],
  });
  window.electronAPI.listProviders = async () => ({ success: false });
  await mgr.renderWindowList();
  assert.ok(listEl.innerHTML.includes('checked'));
});

test('未知 providerId 时平台名回退"平台"', async () => {
  window.electronAPI.listProfiles = async () => ({
    success: true,
    profiles: [{ id: 'p1', name: 'A', providerId: 'unknown', autoOpen: false }],
  });
  window.electronAPI.listProviders = async () => ({ success: true, providers: [] });
  await mgr.renderWindowList();
  assert.ok(listEl.innerHTML.includes('平台'));
});

test('listProfiles 抛异常时显示"加载失败"', async () => {
  window.electronAPI.listProfiles = async () => { throw new Error('boom'); };
  await mgr.renderWindowList();
  assert.ok(listEl.innerHTML.includes('加载失败'));
});

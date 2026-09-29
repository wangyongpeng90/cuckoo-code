// @vitest-environment happy-dom
'use strict';
/**
 * overlay/settings.ts 测试：设置缓存、旧版 localStorage 数据迁移、hook 键镜像。
 * localStorage / document 由 happy-dom 提供；window.electronAPI 用内存桩模拟主进程。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import { setupDom } from '../helpers/dom';

let settingsMod;
let KEYS;
let DEFAULT_SETTINGS;
let api;
let dom;

function makeApi(overrides = {}) {
  return {
    migrateCalls: [],
    async migrateSettings(patch) {
      this.migrateCalls.push(patch);
      return { success: true, applied: true };
    },
    async getSettings() {
      return { ...DEFAULT_SETTINGS };
    },
    async saveSettings(patch) {
      return { success: true, settings: { ...DEFAULT_SETTINGS, ...patch } };
    },
    async resetSettings() {
      return { success: true, settings: { ...DEFAULT_SETTINGS } };
    },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  dom = setupDom('');
  const storeMod = await import('../../src/app/settings-store.js');
  DEFAULT_SETTINGS = storeMod.DEFAULT_SETTINGS;
  api = makeApi();
  window.electronAPI = api;
  const storage = await import('../../src/overlay/storage.js');
  KEYS = storage.KEYS;
  settingsMod = await import('../../src/overlay/settings.js');
});

afterEach(() => {
  dom.cleanup();
});

test('init 前 getCachedSettings 返回默认值', () => {
  const s = settingsMod.getCachedSettings();
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(s.retryEnabled, true);
});

test('无旧键：不触发迁移，缓存取主进程设置，镜像 hook 键', async () => {
  const s = await settingsMod.initSettings();
  assert.strictEqual(api.migrateCalls.length, 0);
  assert.strictEqual(s.retryDelayMin, 4000);
  assert.strictEqual(localStorage.getItem(KEYS.xhrIdleTimeout), '300000');
});

test('有旧键：解析后经 migrateSettings 迁移，旧键删除，非设置键保留', async () => {
  localStorage.setItem(KEYS.retryEnabled, '0');
  localStorage.setItem(KEYS.retryDelayMin, '1500');
  localStorage.setItem(KEYS.retryCount, '7');
  localStorage.setItem(KEYS.retryPrompt, '旧提示词');
  localStorage.setItem(KEYS.watchdogCount, '5');
  localStorage.setItem(KEYS.xhrIdleTimeout, '123456');
  localStorage.setItem(KEYS.autoCompactEnabled, '1');
  localStorage.setItem(KEYS.autoCompactThreshold, '50');
  localStorage.setItem(KEYS.sendDelayMin, '111');
  localStorage.setItem(KEYS.attachDelayMax, '2222');
  // 非设置键：fab 位置（遗留键，T8 起不再使用但迁移不应清它）、token 统计、ds-headers 不动
  localStorage.setItem('cuckoo-fab-pos', '{"left":1,"top":2}');
  localStorage.setItem(KEYS.tokenCache, '{}');
  localStorage.setItem('cuckoo-ds-headers', '{}');

  await settingsMod.initSettings();

  assert.strictEqual(api.migrateCalls.length, 1);
  const patch = api.migrateCalls[0];
  assert.strictEqual(patch.retryEnabled, false);
  assert.strictEqual(patch.retryDelayMin, 1500);
  assert.strictEqual(patch.retryCount, 7);
  assert.strictEqual(patch.retryPrompt, '旧提示词');
  assert.strictEqual(patch.watchdogCount, 5);
  assert.strictEqual(patch.xhrIdleTimeout, 123456);
  assert.strictEqual(patch.autoCompactEnabled, true);
  assert.strictEqual(patch.autoCompactThreshold, 50);
  assert.strictEqual(patch.sendDelayMin, 111);
  assert.strictEqual(patch.attachDelayMax, 2222);
  // 旧设置键全部删除
  assert.strictEqual(localStorage.getItem(KEYS.retryEnabled), null);
  assert.strictEqual(localStorage.getItem(KEYS.retryCount), null);
  assert.strictEqual(localStorage.getItem(KEYS.autoCompactEnabled), null);
  assert.strictEqual(localStorage.getItem(KEYS.attachDelayMax), null);
  // 非设置键保留；镜像键重新写入（新值来自主进程默认 300000）
  assert.strictEqual(localStorage.getItem('cuckoo-fab-pos'), '{"left":1,"top":2}');
  assert.strictEqual(localStorage.getItem(KEYS.tokenCache), '{}');
  assert.strictEqual(localStorage.getItem('cuckoo-ds-headers'), '{}');
  assert.strictEqual(localStorage.getItem(KEYS.xhrIdleTimeout), '300000');
});

test('旧键值非法：该字段不进补丁，但旧键仍被清除', async () => {
  localStorage.setItem(KEYS.retryCount, 'abc');
  localStorage.setItem(KEYS.autoCompactThreshold, '-5');
  await settingsMod.initSettings();
  assert.strictEqual(api.migrateCalls.length, 1);
  const patch = api.migrateCalls[0];
  assert.strictEqual('retryCount' in patch, false);
  assert.strictEqual('autoCompactThreshold' in patch, false);
  assert.strictEqual(localStorage.getItem(KEYS.retryCount), null);
});

test('主进程标记已迁移（applied=false）：旧键仍被删除，设置以主进程为准', async () => {
  localStorage.setItem(KEYS.retryCount, '99');
  api.migrateSettings = async (patch) => {
    api.migrateCalls.push(patch);
    return { success: true, applied: false };
  };
  await settingsMod.initSettings();
  assert.strictEqual(api.migrateCalls.length, 1);
  assert.strictEqual(localStorage.getItem(KEYS.retryCount), null);
  assert.strictEqual(settingsMod.getCachedSettings().retryCount, 10); // 主进程默认值
});

test('saveSettings 更新缓存并镜像 hook 键', async () => {
  await settingsMod.initSettings();
  const ok = await settingsMod.saveSettings({ xhrIdleTimeout: 60000, retryCount: 3 });
  assert.strictEqual(ok, true);
  assert.strictEqual(settingsMod.getCachedSettings().retryCount, 3);
  assert.strictEqual(localStorage.getItem(KEYS.xhrIdleTimeout), '60000');
});

test('resetSettings 恢复默认缓存', async () => {
  await settingsMod.initSettings();
  await settingsMod.saveSettings({ retryCount: 1 });
  const ok = await settingsMod.resetSettings();
  assert.strictEqual(ok, true);
  assert.strictEqual(settingsMod.getCachedSettings().retryCount, 10);
});

test('electronAPI 不可用：initSettings 不抛错，缓存保持默认值', async () => {
  window.electronAPI = undefined;
  const s = await settingsMod.initSettings();
  assert.strictEqual(s.retryCount, 10);
  // 默认值镜像仍写入
  assert.strictEqual(localStorage.getItem(KEYS.xhrIdleTimeout), '300000');
});

test('electronAPI 报错：initSettings 兜底默认值，saveSettings 返回 false', async () => {
  window.electronAPI = {
    async getSettings() { throw new Error('ipc down'); },
    async saveSettings() { throw new Error('ipc down'); },
    async migrateSettings() { throw new Error('ipc down'); },
  };
  localStorage.setItem(KEYS.retryCount, '8');
  const s = await settingsMod.initSettings();
  assert.strictEqual(s.retryCount, 10);
  const ok = await settingsMod.saveSettings({ retryCount: 5 });
  assert.strictEqual(ok, false);
  assert.strictEqual(settingsMod.getCachedSettings().retryCount, 10);
});

test('applyRemoteSettings 刷新缓存、镜像并通知订阅者（模拟另一窗口保存后的广播）', async () => {
  await settingsMod.initSettings();
  const seen = [];
  settingsMod.onSettingsChanged((s) => seen.push(s.retryCount));
  settingsMod.applyRemoteSettings({ ...DEFAULT_SETTINGS, retryCount: 6, xhrIdleTimeout: 60000 });
  assert.strictEqual(settingsMod.getCachedSettings().retryCount, 6);
  assert.strictEqual(localStorage.getItem(KEYS.xhrIdleTimeout), '60000');
  assert.deepStrictEqual(seen, [6]);
});

test('applyRemoteSettings 非法载荷忽略', () => {
  settingsMod.applyRemoteSettings(null);
  settingsMod.applyRemoteSettings('x');
  assert.strictEqual(settingsMod.getCachedSettings().retryCount, 10);
});

test('迁移时 xhr-idle-timeout 旧键不被删除，由镜像覆盖（无空窗期）', async () => {
  localStorage.setItem(KEYS.xhrIdleTimeout, '123456');
  localStorage.setItem(KEYS.retryCount, '8');
  await settingsMod.initSettings();
  assert.strictEqual(api.migrateCalls.length, 1);
  // 旧键始终存在（未被 removeItem），最终被镜像为权威值
  assert.strictEqual(localStorage.getItem(KEYS.xhrIdleTimeout), '300000');
  assert.strictEqual(localStorage.getItem(KEYS.retryCount), null);
});

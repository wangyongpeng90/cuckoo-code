// @vitest-environment happy-dom
'use strict';
/**
 * storage 模块测试：KEYS 键名集中管理 + readKey/writeKey 窄封装。
 * localStorage 由 happy-dom 提供，每个用例前清空。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

let storage;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  storage = await import('../../src/overlay/storage.js');
});

test('KEYS 无重复值', () => {
  const values = Object.values(storage.KEYS);
  assert.strictEqual(new Set(values).size, values.length);
});

test('KEYS 值全部是 cuckoo- 前缀的非空字符串', () => {
  const values = Object.values(storage.KEYS);
  assert.strictEqual(values.length > 0, true);
  for (const v of values) {
    assert.strictEqual(typeof v, 'string');
    assert.strictEqual(v.startsWith('cuckoo-'), true, 'key without cuckoo- prefix: ' + v);
  }
});

test('readKey 键不存在时返回调用方给的默认值', () => {
  assert.strictEqual(storage.readKey(storage.KEYS.tokenCache, 'dft'), 'dft');
  assert.deepStrictEqual(storage.readKey(storage.KEYS.tokenCache, { a: 1 }), { a: 1 });
});

test('readKey 遇到坏 JSON 返回默认值而不是抛错', () => {
  localStorage.setItem(storage.KEYS.tokenCache, '{broken json');
  assert.deepStrictEqual(storage.readKey(storage.KEYS.tokenCache, { a: 1 }), { a: 1 });
});

test('readKey 解析合法 JSON', () => {
  localStorage.setItem(storage.KEYS.tokenCache, JSON.stringify({ s1: 10 }));
  assert.deepStrictEqual(storage.readKey(storage.KEYS.tokenCache, null), { s1: 10 });
});

test('writeKey JSON 序列化，readKey 可读回', () => {
  storage.writeKey(storage.KEYS.tokenCache, { s1: 3 });
  assert.strictEqual(localStorage.getItem(storage.KEYS.tokenCache), '{"s1":3}');
  assert.deepStrictEqual(storage.readKey(storage.KEYS.tokenCache, null), { s1: 3 });
});

test('removeKey 删除键且不抛错', () => {
  storage.writeKey(storage.KEYS.tokenDaily, { '2026-09-28': 1 });
  storage.removeKey(storage.KEYS.tokenDaily);
  assert.strictEqual(localStorage.getItem(storage.KEYS.tokenDaily), null);
  storage.removeKey(storage.KEYS.tokenDaily); // 幂等
});

test('settings 的 reset 走主进程 settings.json，不再触碰任何 localStorage 键', async () => {
  // 主进程桩：resetSettings 返回默认值
  window.electronAPI = {
    resetCalls: 0,
    async resetSettings() {
      window.electronAPI.resetCalls++;
      const { DEFAULT_SETTINGS } = await import('../../src/app/settings-store.js');
      return { success: true, settings: { ...DEFAULT_SETTINGS } };
    },
  };
  const { resetSettings } = await import('../../src/overlay/settings.js');
  // 所有 KEYS 都写入值（含残留的旧版设置键）
  for (const v of Object.values(storage.KEYS)) localStorage.setItem(v, 'x');
  await resetSettings();
  // 不再删除任何 localStorage 键（旧设置键的清理由 overlay/settings.ts 的迁移负责）
  const removed = Object.values(storage.KEYS).filter((v) => localStorage.getItem(v) === null);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(window.electronAPI.resetCalls, 1);
});

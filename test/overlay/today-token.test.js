'use strict';
/**
 * 今日窗口 token 统计测试（v3 口径：每天累加"当轮完整 acc"，跨天归零；子代理不参与）
 * 直接测 src/overlay/token-counter.ts 的真实实现。
 *
 * 口径示例（acc 为服务端返回的"当轮总量"）：
 *  9-26 第1轮 acc=100 → 今日 100
 *  9-27 打开         → 今日 0（跨天归零）
 *  9-27 第1轮 acc=200 → 今日 200
 *  9-27 第2轮 acc=500 → 今日 700
 *  9-28 打开         → 今日 0
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';

const TOKEN_DAILY_KEY = 'cuckoo-token-daily';
const DAILY_VERSION_KEY = 'cuckoo-token-daily-version';
const DAILY_VERSION = '3';

let counter;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  counter = await import('../../src/overlay/token-counter.js');
  counter.setIsSubagentWindow(false);
  // 模拟应用已初始化（版本已迁移），避免读取时误触发清空
  localStorage.setItem(DAILY_VERSION_KEY, DAILY_VERSION);
  vi.setSystemTime(new Date(2026, 8, 26, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

test('9-26 用 100，9-27 打开应为 0', () => {
  vi.setSystemTime(new Date(2026, 8, 26, 12, 0, 0));
  counter.saveTokenForSession('s1', 100);
  assert.strictEqual(counter.getTodayCumulative(), 100);

  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  assert.strictEqual(counter.getTodayCumulative(), 0); // 新的一天，今日归零
});

test('今天第 1 次对话 200，今日 = 200', () => {
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  counter.saveTokenForSession('s1', 200);
  assert.strictEqual(counter.getTodayCumulative(), 200);
});

test('今天第 2 次对话 acc=500，今日 = 700（累加完整 acc）', () => {
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  counter.saveTokenForSession('s1', 200);
  counter.saveTokenForSession('s1', 500);
  assert.strictEqual(counter.getTodayCumulative(), 700); // 200 + 500
});

test('今天第 3 次对话 acc=900，今日 = 1600', () => {
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  counter.saveTokenForSession('s1', 200);
  counter.saveTokenForSession('s1', 500);
  counter.saveTokenForSession('s1', 900);
  assert.strictEqual(counter.getTodayCumulative(), 1600); // 200+500+900
});

test('子代理窗口不计入今日', () => {
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  counter.setIsSubagentWindow(true);
  counter.saveTokenForSession('sub', 9999);
  assert.strictEqual(counter.getTodayCumulative(), 0);
});

test('旧口径数据（v2）触发迁移清空', () => {
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  // 模拟旧版本（未迁移）
  localStorage.removeItem(DAILY_VERSION_KEY);
  localStorage.setItem(TOKEN_DAILY_KEY, JSON.stringify({ '2026-09-26': 99999999 }));
  assert.strictEqual(counter.getTodayCumulative(), 0); // 版本不对 → 清空
  assert.strictEqual(localStorage.getItem(DAILY_VERSION_KEY), '3');
});

test('同一天多会话共享今日累计', () => {
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  counter.saveTokenForSession('s1', 200);
  counter.saveTokenForSession('s2', 300);
  assert.strictEqual(counter.getTodayCumulative(), 500); // 200 + 300
});

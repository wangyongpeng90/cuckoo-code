// @vitest-environment happy-dom
'use strict';
/**
 * src/overlay/retry-countdown.ts 倒计时浮层测试。
 * showRetryCountdown 渲染/更新浮层，取消按钮触发回调，hideRetryCountdown 隐藏。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';

import { setupDom } from '../helpers/dom';

let ctx;
let countdown;

beforeEach(async () => {
  vi.resetModules();
  ctx = setupDom();
  countdown = await import('../../src/overlay/retry-countdown.js');
});

afterEach(() => {
  ctx.cleanup();
});

function box() {
  return document.getElementById('cuckoo-retry-countdown');
}

test('showRetryCountdown 渲染倒计时元素并显示秒数', () => {
  countdown.showRetryCountdown(5, () => {});
  const el = box();
  assert.ok(el !== null, '应创建 #cuckoo-retry-countdown');
  assert.strictEqual(el.classList.contains('cuckoo-hidden'), false);
  const text = document.getElementById('cuckoo-retry-countdown-text');
  assert.ok(text !== null, '应创建倒计时文本元素');
  assert.ok(text.textContent.includes('5'), '文本应包含剩余秒数');
  assert.ok(text.textContent.includes('重试'), '文本应提示自动重试');
});

test('点击取消按钮触发 onCancel 回调', () => {
  let cancelled = 0;
  countdown.showRetryCountdown(5, () => { cancelled++; });
  const btn = document.getElementById('cuckoo-retry-cancel');
  assert.ok(btn !== null, '应创建取消按钮');
  btn.click();
  assert.strictEqual(cancelled, 1);
});

test('hideRetryCountdown 隐藏浮层', () => {
  countdown.showRetryCountdown(5, () => {});
  countdown.hideRetryCountdown();
  const el = box();
  assert.ok(el !== null);
  assert.strictEqual(el.classList.contains('cuckoo-hidden'), true);
});

test('重复 show 复用同一元素并更新秒数', () => {
  countdown.showRetryCountdown(9, () => {});
  const first = box();
  countdown.showRetryCountdown(3, () => {});
  const second = box();
  assert.strictEqual(first === second, true);
  const text = document.getElementById('cuckoo-retry-countdown-text');
  assert.ok(text.textContent.includes('3'));
});

test('hide 后取消按钮不再触发旧回调', () => {
  let cancelled = 0;
  countdown.showRetryCountdown(5, () => { cancelled++; });
  countdown.hideRetryCountdown();
  document.getElementById('cuckoo-retry-cancel').click();
  assert.strictEqual(cancelled, 0);
});

test('未 show 直接 hide 不抛错', () => {
  assert.doesNotThrow(() => countdown.hideRetryCountdown());
});

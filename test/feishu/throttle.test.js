'use strict';
/**
 * 飞书工具状态推送限流测试（纯逻辑）
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { ToolPushThrottle, DEFAULT_TOOL_PUSH_LIMIT } from '../../src/feishu/throttle.js';

test('阈值前：正常放行，不询问', () => {
  const t = new ToolPushThrottle(3);
  assert.deepStrictEqual(t.tryPush('c1'), { allow: true, shouldAsk: false });
  assert.deepStrictEqual(t.tryPush('c1'), { allow: true, shouldAsk: false });
});

test('达到阈值：不放行 + 应询问', () => {
  const t = new ToolPushThrottle(3);
  t.tryPush('c1'); // 1
  t.tryPush('c1'); // 2
  const r = t.tryPush('c1'); // 3 → 达阈值
  assert.strictEqual(r.allow, false);
  assert.strictEqual(r.shouldAsk, true);
  assert.strictEqual(t.peek('c1').paused, true);
  assert.strictEqual(t.peek('c1').asking, true);
});

test('暂停后：静默丢弃，不再询问', () => {
  const t = new ToolPushThrottle(2);
  t.tryPush('c1');            // 1
  t.tryPush('c1');            // 2 → 询问
  const r1 = t.tryPush('c1'); // 已暂停
  const r2 = t.tryPush('c1');
  assert.deepStrictEqual(r1, { allow: false, shouldAsk: false });
  assert.deepStrictEqual(r2, { allow: false, shouldAsk: false });
});

test('询问中回复「继续」→ resume + 计数复位', () => {
  const t = new ToolPushThrottle(2);
  t.tryPush('c1'); t.tryPush('c1'); // 触发询问
  assert.strictEqual(t.handleReply('c1', '继续'), 'resume');
  assert.strictEqual(t.peek('c1').paused, false);
  assert.strictEqual(t.peek('c1').count, 0);
  // 继续后可再次放行
  assert.deepStrictEqual(t.tryPush('c1'), { allow: true, shouldAsk: false });
});

test('询问中回复「暂停」→ pause + 保持暂停', () => {
  const t = new ToolPushThrottle(2);
  t.tryPush('c1'); t.tryPush('c1');
  assert.strictEqual(t.handleReply('c1', '暂停'), 'pause');
  assert.strictEqual(t.peek('c1').paused, true);
  assert.strictEqual(t.peek('c1').asking, false);
  assert.deepStrictEqual(t.tryPush('c1'), { allow: false, shouldAsk: false });
});

test('未询问时回复「继续/暂停」→ null（不拦截）', () => {
  const t = new ToolPushThrottle(8);
  // 从未触发询问
  assert.strictEqual(t.handleReply('c1', '继续'), null);
  assert.strictEqual(t.handleReply('c1', '暂停'), null);
  // 未知 chatId
  assert.strictEqual(t.handleReply('nope', '继续'), null);
});

test('询问超时：关闭询问窗口，保持暂停', () => {
  const t = new ToolPushThrottle(2);
  t.tryPush('c1'); t.tryPush('c1'); // 询问中
  t.askTimeout('c1');
  assert.strictEqual(t.peek('c1').asking, false);
  assert.strictEqual(t.peek('c1').paused, true);
  // 超时后回复「继续」不再被拦截
  assert.strictEqual(t.handleReply('c1', '继续'), null);
});

test('新一轮 reset：计数与暂停全复位', () => {
  const t = new ToolPushThrottle(2);
  t.tryPush('c1'); t.tryPush('c1'); // 暂停
  t.reset('c1');
  assert.strictEqual(t.peek('c1').count, 0);
  assert.strictEqual(t.peek('c1').paused, false);
  assert.strictEqual(t.peek('c1').asking, false);
  assert.deepStrictEqual(t.tryPush('c1'), { allow: true, shouldAsk: false });
});

test('不同 chatId 相互隔离', () => {
  const t = new ToolPushThrottle(2);
  t.tryPush('c1'); t.tryPush('c1'); // c1 暂停
  // c2 不受影响
  assert.deepStrictEqual(t.tryPush('c2'), { allow: true, shouldAsk: false });
  assert.strictEqual(t.peek('c1').paused, true);
  assert.strictEqual(t.peek('c2').paused, false);
});

test('空 chatId：一律不放行、不询问', () => {
  const t = new ToolPushThrottle(2);
  assert.deepStrictEqual(t.tryPush(''), { allow: false, shouldAsk: false });
});

test('默认阈值常量', () => {
  assert.strictEqual(DEFAULT_TOOL_PUSH_LIMIT, 8);
  const t = new ToolPushThrottle();
  for (let i = 0; i < DEFAULT_TOOL_PUSH_LIMIT - 1; i++) {
    assert.strictEqual(t.tryPush('c').allow, true);
  }
  assert.strictEqual(t.tryPush('c').shouldAsk, true);
});

test('非法阈值回退到默认', () => {
  const t = new ToolPushThrottle(0);
  assert.strictEqual(t.limitValue, DEFAULT_TOOL_PUSH_LIMIT);
  const t2 = new ToolPushThrottle(-5);
  assert.strictEqual(t2.limitValue, DEFAULT_TOOL_PUSH_LIMIT);
});

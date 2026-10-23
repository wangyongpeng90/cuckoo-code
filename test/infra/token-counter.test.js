'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import {
  EstimateTokenCounter,
  getTokenCounter,
  setExactTokenCounter,
} from '../../src/infra/token-counter.js';

test('空文本返回 0', () => {
  const c = new EstimateTokenCounter();
  assert.strictEqual(c.count(''), 0);
});

test('纯中文估算在合理区间', () => {
  const c = new EstimateTokenCounter();
  // 10 个汉字，估算应约 7 左右（0.65*10*1.05≈6.8 → ceil 7），给宽松区间
  const n = c.count('一二三四五六七八九十');
  assert.ok(n >= 5 && n <= 15, 'got ' + n);
});

test('纯英文估算在合理区间', () => {
  const c = new EstimateTokenCounter();
  const n = c.count('hello world');
  assert.ok(n >= 2 && n <= 10, 'got ' + n);
});

test('代码文本估算为正数', () => {
  const c = new EstimateTokenCounter();
  const n = c.count('const x = await read("a.txt");');
  assert.ok(n > 5, 'got ' + n);
});

test('长文本 token 数随长度单调增长', () => {
  const c = new EstimateTokenCounter();
  const short = c.count('hello');
  const long = c.count('hello'.repeat(100));
  assert.ok(long > short);
});

test('countMessage 含角色开销，system 高于 user', () => {
  const c = new EstimateTokenCounter();
  const user = c.countMessage('user', 'hello');
  const system = c.countMessage('system', 'hello');
  assert.ok(user > c.count('hello'), 'user 应含开销');
  assert.ok(system > user, 'system 开销应高于 user');
});

test('EstimateTokenCounter.isExact 为 false', () => {
  assert.strictEqual(new EstimateTokenCounter().isExact, false);
});

test('getTokenCounter 默认返回估算计数器', () => {
  assert.strictEqual(getTokenCounter().isExact, false);
});

test('setExactTokenCounter 注入后可替换，传 null 恢复', () => {
  const fake = { count: () => 42, countMessage: () => 42, isExact: true };
  try {
    setExactTokenCounter(fake);
    assert.strictEqual(getTokenCounter().isExact, true);
    assert.strictEqual(getTokenCounter().count('x'), 42);
  } finally {
    setExactTokenCounter(null);
  }
  assert.strictEqual(getTokenCounter().isExact, false);
});

'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { estimateTokens, createTpsMeter, formatTps } from '../../src/overlay/tps.js';

test('estimateTokens 空文本返回 0', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens(null), 0);
});

test('estimateTokens 中文约 0.7 token/字', () => {
  assert.strictEqual(estimateTokens('你好世界'), 3); // 4*0.7=2.8→3
});

test('estimateTokens 英文约 0.27 token/字符（含 1.05 保守上偏）', () => {
  // 8*0.27*1.05=2.27→3；4*0.27*1.05=1.13→2
  assert.strictEqual(estimateTokens('abcdefgh'), 3);
  assert.strictEqual(estimateTokens('abcd'), 2);
});

test('estimateTokens 数字权重', () => {
  assert.strictEqual(estimateTokens('1234567890'), 4);
});

test('estimateTokens emoji 权重更高', () => {
  const n = estimateTokens('😀😀');
  assert.ok(n >= 4, 'emoji tokens=' + n);
});

test('formatTps 无数据返回空串', () => {
  assert.strictEqual(formatTps(0), '');
  assert.strictEqual(formatTps(-1), '');
  assert.strictEqual(formatTps(NaN), '');
});

test('formatTps 小于 100 保留一位小数', () => {
  assert.strictEqual(formatTps(12.34), '12.3');
  assert.strictEqual(formatTps(0.5), '0.5');
});

test('formatTps 大于等于 100 取整', () => {
  assert.strictEqual(formatTps(123.6), '124');
});

test('createTpsMeter 初始值为 0', () => {
  const m = createTpsMeter();
  assert.strictEqual(m.value, 0);
  assert.strictEqual(m.active, false);
});

test('createTpsMeter 精确路径：用 accumulated 差值算 TPS（不含输入）', () => {
  const m = createTpsMeter();
  const t0 = 1000;
  // 本轮起始 acc=1000（prompt），1 秒后 acc=1050 → 输出 50 token → 50 t/s
  m.update('', false, 1000, t0);
  m.update('', false, 1050, t0 + 1000);
  assert.ok(Math.abs(m.value - 50) < 0.001, 'value=' + m.value);
  assert.strictEqual(m.tokens, 50);
});

test('createTpsMeter 回退路径：累积一段时间后算出估算 TPS', () => {
  const m = createTpsMeter();
  const t0 = 1000;
  m.update('你好', false, null, t0);
  m.update('你好世界', false, null, t0 + 1000);
  assert.ok(m.value > 0, 'value=' + m.value);
  assert.strictEqual(m.active, true);
});

test('createTpsMeter 计时窗口过短不更新（防虚高）', () => {
  const m = createTpsMeter();
  m.update('你好世界', false, null, 1000);
  m.update('你好世界你好', false, null, 1100); // 仅 0.1s
  assert.strictEqual(m.value, 0);
});

test('createTpsMeter finished 冻结最终值', () => {
  const m = createTpsMeter();
  m.update('你好', false, null, 1000);
  m.update('你好世界', false, null, 2000);
  const v = m.value;
  m.update('你好世界', true, null, 3000);
  assert.strictEqual(m.value, v);
  assert.strictEqual(m.active, false);
});

// ===== 关键：防叠加（两轮 token 不能累加）=====
test('createTpsMeter 正常完成一轮后，下一轮不叠加（finished 触发重置）', () => {
  const m = createTpsMeter();
  const t0 = 1000;
  // 第一轮：acc 1000 → 1050，输出 50 token，1 秒 → 50 t/s
  m.update('', false, 1000, t0);
  m.update('', false, 1050, t0 + 1000);
  assert.ok(Math.abs(m.value - 50) < 0.001);
  // 第一轮结束
  m.update('', true, 1050, t0 + 1000);
  // 第二轮：acc 2000（新 prompt）→ 2100，输出 100 token，1 秒 → 100 t/s
  m.update('', false, 2000, t0 + 2000);
  m.update('', false, 2100, t0 + 3000);
  // 若叠加会得到 (2100-1000)/... ≈ 1100，正确应为 100
  assert.ok(Math.abs(m.value - 100) < 0.001, 'value=' + m.value + '（叠加会变成 ~1100）');
  assert.strictEqual(m.tokens, 100);
});

test('createTpsMeter 上一轮被中止（无 finished），下一轮正文回退也重置（防叠加）', () => {
  const m = createTpsMeter();
  const t0 = 1000;
  // 第一轮：正文增长到 10 字符
  m.update('你好世界你好世界你好世界', false, 1000, t0);
  m.update('你好世界你好世界你好世界！', false, 1050, t0 + 1000);
  // 第一轮被中止：没有 finished，直接进入第二轮（正文从短开始）
  m.update('新', false, 2000, t0 + 2000);
  m.update('新的一轮', false, 2100, t0 + 3000);
  // 第二轮 baseAcc 应为 2000，输出 100 token/1s = 100 t/s（非叠加）
  assert.ok(Math.abs(m.value - 100) < 0.001, 'value=' + m.value);
});

test('createTpsMeter acc 恒定不增长时回退估算（不会一直不显示）', () => {
  const m = createTpsMeter();
  const t0 = 1000;
  // 服务端 acc 一直等于 1000（未包含输出，或未更新）
  m.update('你好', false, 1000, t0);
  m.update('你好世界这是测试内容', false, 1000, t0 + 1000);
  // acc 差值为 0 → 回退估算，应算出正值而非 0
  assert.ok(m.value > 0, 'value=' + m.value + '（回归：曾因 acc 恒定而恒为 0）');
});

test('createTpsMeter reset 清空状态与展示值', () => {
  const m = createTpsMeter();
  m.update('你好', false, null, 1000);
  m.update('你好世界', false, null, 2000);
  m.reset();
  assert.strictEqual(m.value, 0);
  assert.strictEqual(m.active, false);
});

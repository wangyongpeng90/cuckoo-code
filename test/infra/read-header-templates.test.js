'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import {
  READ_HEADER_FULL_KEY, READ_HEADER_PARTIAL_KEY,
  DEFAULT_READ_HEADER_FULL, DEFAULT_READ_HEADER_PARTIAL,
  renderReadHeader, pickAndRender,
} from '../../src/infra/read-header-templates.js';

test('renderReadHeader 替换已知占位符', () => {
  assert.strictEqual(
    renderReadHeader('{path}（第 {start}-{end} 行，共 {total} 行）', { path: 'a.txt', start: 1, end: 10, total: 20 }),
    'a.txt（第 1-10 行，共 20 行）'
  );
});

test('renderReadHeader 未知占位符原样保留', () => {
  assert.strictEqual(renderReadHeader('{path} {unknown}', { path: 'a.txt' }), 'a.txt {unknown}');
});

test('renderReadHeader 多处同名占位符全部替换', () => {
  assert.strictEqual(renderReadHeader('{path} / {path}', { path: 'x' }), 'x / x');
});

test('pickAndRender 池为空回退 fallback', () => {
  const s = pickAndRender([], ['fallback {path}'], { path: 'a.txt' });
  assert.strictEqual(s, 'fallback a.txt');
});

test('pickAndRender 只从给定池里取', () => {
  const pool = ['甲 {path}', '乙 {path}'];
  const allowed = new Set(['甲 a.txt', '乙 a.txt']);
  for (let i = 0; i < 50; i++) {
    assert.ok(allowed.has(pickAndRender(pool, ['不应出现'], { path: 'a.txt' })));
  }
});

test('默认池均非空且含必要占位符', () => {
  assert.ok(DEFAULT_READ_HEADER_FULL.length > 0);
  for (const t of DEFAULT_READ_HEADER_FULL) {
    assert.ok(t.indexOf('{path}') >= 0, '完整池应含 {path}：' + t);
    assert.ok(t.indexOf('{total}') >= 0, '完整池应含 {total}：' + t);
  }
  assert.ok(DEFAULT_READ_HEADER_PARTIAL.length > 0);
  for (const t of DEFAULT_READ_HEADER_PARTIAL) {
    assert.ok(t.indexOf('{path}') >= 0, '部分池应含 {path}：' + t);
    assert.ok(t.indexOf('{start}') >= 0, '部分池应含 {start}：' + t);
    assert.ok(t.indexOf('{end}') >= 0, '部分池应含 {end}：' + t);
    assert.ok(t.indexOf('{total}') >= 0, '部分池应含 {total}：' + t);
  }
});

test('键名互不相同', () => {
  assert.notStrictEqual(READ_HEADER_FULL_KEY, READ_HEADER_PARTIAL_KEY);
});

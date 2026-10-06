'use strict';
import { test } from 'vitest';
import assert from 'node:assert';

// 与 observer.ts 保持一致的正则（行首锚定）
const SNAPSHOT_MARKER_RE = /^[ \t]*[\[【]快照[\]】]\s*([^\n]+)/gm;

function extract(re, text) {
  return Array.from(text.matchAll(re)).map((m) => (m[1] || '').trim()).filter(Boolean);
}

test('提取 [快照] 半角（行首）', () => {
  assert.deepStrictEqual(extract(SNAPSHOT_MARKER_RE, '[快照]重构前'), ['重构前']);
});
test('标记在行中（非行首）不识别', () => {
  assert.deepStrictEqual(extract(SNAPSHOT_MARKER_RE, '先存个档 [快照]重构前'), []);
});
test('提取 【快照】 全角', () => {
  assert.deepStrictEqual(extract(SNAPSHOT_MARKER_RE, '【快照】改前'), ['改前']);
});
test('多条快照', () => {
  assert.deepStrictEqual(extract(SNAPSHOT_MARKER_RE, '[快照]A\n[快照]B'), ['A', 'B']);
});
test('无标记返回空', () => {
  assert.deepStrictEqual(extract(SNAPSHOT_MARKER_RE, '普通回复没有标记'), []);
});
test('标记不跨行', () => {
  assert.deepStrictEqual(extract(SNAPSHOT_MARKER_RE, '[快照]第一行\n第二行'), ['第一行']);
});

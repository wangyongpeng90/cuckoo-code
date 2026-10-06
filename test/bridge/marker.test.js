'use strict';
import { test } from 'vitest';
import assert from 'node:assert';

// 与 observer.ts 保持一致的正则（行首锚定）
const MEMORY_MARKER_RE = /^[ \t]*[\[【]记忆[\]】]\s*([^\n]+)/gm;

function extract(re, text) {
  return Array.from(text.matchAll(re)).map((m) => (m[1] || '').trim()).filter(Boolean);
}

test('提取 [记忆] 半角（行首）', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '[记忆]用户偏好中文'), ['用户偏好中文']);
});
test('标记在行中（非行首）不识别', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '好的。[记忆]用户偏好中文'), []);
});
test('提取 【记忆】 全角', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '【记忆】喜欢简洁'), ['喜欢简洁']);
});
test('多条记忆', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '[记忆]A\n[记忆]B'), ['A', 'B']);
});
test('无标记返回空', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '普通回复没有标记'), []);
});
test('标记不跨行', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '[记忆]第一行\n第二行'), ['第一行']);
});
test('不误伤正文中引用的 [记忆]（非行首）', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '你可以说 [记忆]内容 来记录'), []);
});
test('行首有前导空白仍识别', () => {
  assert.deepStrictEqual(extract(MEMORY_MARKER_RE, '   [记忆]缩进也可以'), ['缩进也可以']);
});

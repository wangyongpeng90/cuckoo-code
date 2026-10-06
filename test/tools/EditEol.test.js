'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { applyEditPreservingEol, buildNormIndexMap, countOccurrences } from '../../src/tools/impl/edit.js';

const CR = '\r', LF = '\n';

test('applyEditPreservingEol: 纯 LF 文件保持 LF', () => {
  const raw = 'a' + LF + 'b' + LF + 'c';
  const out = applyEditPreservingEol(raw, 'b', 'B', false);
  assert.strictEqual(out, 'a' + LF + 'B' + LF + 'c');
});

test('applyEditPreservingEol: 纯 CRLF 文件保持 CRLF', () => {
  const raw = 'a' + CR + LF + 'b' + CR + LF + 'c';
  const out = applyEditPreservingEol(raw, 'b', 'B', false);
  assert.strictEqual(out, 'a' + CR + LF + 'B' + CR + LF + 'c');
});

test('applyEditPreservingEol: 混合文件未编辑区域行尾不变（核心）', () => {
  // 第 1 行 CRLF，第 2 行 LF，第 3 行 CRLF
  const raw = 'line1' + CR + LF + 'line2' + LF + 'line3' + CR + LF + 'target' + CR + LF + 'end';
  const out = applyEditPreservingEol(raw, 'target', 'REPLACED', false);
  // 前三行行尾原样保留
  assert.strictEqual(out, 'line1' + CR + LF + 'line2' + LF + 'line3' + CR + LF + 'REPLACED' + CR + LF + 'end');
});

test('applyEditPreservingEol: 被替换处行尾风格决定新文本', () => {
  const raw = 'a' + CR + LF + 'x' + LF + 'y' + CR + LF + 'z';
  // 替换 'x'（LF 处）为多行文本 → 新文本用 LF
  const out1 = applyEditPreservingEol(raw, 'x', 'X1' + LF + 'X2', false);
  assert.strictEqual(out1, 'a' + CR + LF + 'X1' + LF + 'X2' + LF + 'y' + CR + LF + 'z');
  // 替换 'y'（匹配文本不含换行）→ 新文本跟随文件主导格式（此文件 CRLF 多 → CRLF）
  const out2 = applyEditPreservingEol(raw, 'y', 'Y1' + LF + 'Y2', false, 'CRLF');
  assert.strictEqual(out2, 'a' + CR + LF + 'x' + LF + 'Y1' + CR + LF + 'Y2' + CR + LF + 'z');
});

test('applyEditPreservingEol: replaceAll 全部替换', () => {
  const raw = 'x' + CR + LF + 'x' + LF + 'x';
  const out = applyEditPreservingEol(raw, 'x', 'Z', true);
  assert.strictEqual(out, 'Z' + CR + LF + 'Z' + LF + 'Z');
});

test('buildNormIndexMap: CRLF 映射长度正确', () => {
  const { norm, start, len } = buildNormIndexMap('a' + CR + LF + 'b');
  assert.strictEqual(norm, 'a' + LF + 'b');
  assert.deepStrictEqual(start, [0, 1, 3]);
  assert.deepStrictEqual(len, [1, 2, 1]);
});

test('countOccurrences: 非重叠计数', () => {
  assert.strictEqual(countOccurrences('aaa', 'a'), 3);
  assert.strictEqual(countOccurrences('aaa', 'aa'), 1);
  assert.strictEqual(countOccurrences('abc', 'x'), 0);
});

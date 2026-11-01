'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { parseEditArgs, formatEditOutput, formatDryRunOutput } from '../../src/tools/impl/edit.js';

test('parseEditArgs 正常', () => {
  assert.deepStrictEqual(parseEditArgs('a.txt', 'old', 'new', false), { filePath: 'a.txt', oldString: 'old', newString: 'new', replaceAll: false, dryRun: false });
  assert.deepStrictEqual(parseEditArgs('a.txt', 'old', 'new', true), { filePath: 'a.txt', oldString: 'old', newString: 'new', replaceAll: true, dryRun: false });
  assert.deepStrictEqual(parseEditArgs('a.txt', 'old', 'new', true, true), { filePath: 'a.txt', oldString: 'old', newString: 'new', replaceAll: true, dryRun: true });
  assert.deepStrictEqual(parseEditArgs('a.txt', 'old', 'new', false, false), { filePath: 'a.txt', oldString: 'old', newString: 'new', replaceAll: false, dryRun: false });
  // dryRun 参数缺失或非 true 时统一为 false（老版本兼容）
  assert.deepStrictEqual(parseEditArgs('a.txt', 'old', 'new', false, undefined), { filePath: 'a.txt', oldString: 'old', newString: 'new', replaceAll: false, dryRun: false });
  assert.deepStrictEqual(parseEditArgs('a.txt', 'old', 'new', false, 1), { filePath: 'a.txt', oldString: 'old', newString: 'new', replaceAll: false, dryRun: false });
});

test('parseEditArgs 空 filePath', () => {
  assert.throws(() => parseEditArgs('', 'o', 'n', false), /filePath must be a non-empty string/);
});

test('parseEditArgs 空 oldString', () => {
  assert.throws(() => parseEditArgs('a.txt', '', 'n', false), /oldString must be a non-empty string/);
  assert.throws(() => parseEditArgs('a.txt', null, 'n', false), /oldString must be a non-empty string/);
});

test('parseEditArgs newString 非字符串', () => {
  assert.throws(() => parseEditArgs('a.txt', 'o', 123, false), /newString must be a string/);
});

test('parseEditArgs old === new 抛错', () => {
  assert.throws(() => parseEditArgs('a.txt', 'same', 'same', false), /oldString and newString must differ/);
});

test('formatEditOutput 唯一/全部替换', () => {
  assert.strictEqual(formatEditOutput('a.txt', false), '已更新 a.txt，替换了 1 处。');
  assert.strictEqual(formatEditOutput('a.txt', true, 3), '已更新 a.txt，替换了 3 处。');
  // 省略 occurrences 时默认为 1
  assert.strictEqual(formatEditOutput('a.txt', true), '已更新 a.txt，替换了 1 处。');
  // 非 replaceAll 时只报 1 处（即使 occurrences > 1 也不会走到这里）
  assert.strictEqual(formatEditOutput('a.txt', false, 5), '已更新 a.txt，替换了 1 处。');
});

test('formatDryRunOutput 预览', () => {
  assert.match(formatDryRunOutput('a.txt', 'x', 'y', 1, false), /\[预览\]/);
  assert.match(formatDryRunOutput('a.txt', 'x', 'y', 1, false), /将替换 1 处/);
  assert.match(formatDryRunOutput('a.txt', 'x', 'y', 3, true), /将全部替换 3 处/);
  // 非 replaceAll 时始终显示将替换 1 处，即使 occurrences 大于 1
  assert.match(formatDryRunOutput('a.txt', 'x', 'y', 3, false), /将替换 1 处/);
  // 删除场景（空 newString）
  assert.match(formatDryRunOutput('a.txt', 'x', '', 1, false), /原内容 "x" → 新内容 ""/);
});


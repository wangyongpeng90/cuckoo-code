'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { parseReadArgs, buildWindow, formatReadOutput, READ_LIMIT } from '../../src/tools/impl/read.js';

test('parseReadArgs 默认值', () => {
  const r = parseReadArgs('a.txt', undefined, undefined);
  assert.deepStrictEqual(r, { offset: 1, limit: READ_LIMIT });
});

test('parseReadArgs 自定义正整数', () => {
  assert.deepStrictEqual(parseReadArgs('a.txt', 3, 10), { offset: 3, limit: 10 });
});

test('parseReadArgs 空路径抛错', () => {
  assert.throws(() => parseReadArgs('', 1, 10), /filePath must be a non-empty string/);
  assert.throws(() => parseReadArgs(null, 1, 10), /filePath must be a non-empty string/);
});

test('parseReadArgs offset 非法', () => {
  assert.throws(() => parseReadArgs('a', 0, 10), /offset must be a positive integer/);
  assert.throws(() => parseReadArgs('a', 1.5, 10), /offset must be a positive integer/);
  assert.throws(() => parseReadArgs('a', -1, 10), /offset must be a positive integer/);
});

test('parseReadArgs limit 非法和超上限', () => {
  assert.throws(() => parseReadArgs('a', 1, 0), /limit must be a positive integer/);
  assert.throws(() => parseReadArgs('a', 1, READ_LIMIT + 1), /limit must be less than or equal to/);
});

test('buildWindow 基本窗口', () => {
  const req = { offset: 1, limit: 5, maxLineLength: 100, maxBytes: 10000 };
  const w = buildWindow('line1\nline2\nline3', req, 'f.txt');
  assert.strictEqual(w.totalLines, 3);
  assert.strictEqual(w.lines.length, 3);
  assert.deepStrictEqual(w.lines.map(l => l.text), ['line1', 'line2', 'line3']);
  assert.deepStrictEqual(w.lines.map(l => l.number), [1, 2, 3]);
});

test('buildWindow offset 与 limit 分段', () => {
  const req = { offset: 2, limit: 1, maxLineLength: 100, maxBytes: 10000 };
  const w = buildWindow('a\nb\nc', req, 'f.txt');
  assert.strictEqual(w.totalLines, 3);
  assert.strictEqual(w.lines.length, 1);
  assert.strictEqual(w.lines[0].text, 'b');
  assert.strictEqual(w.lines[0].number, 2);
});

test('buildWindow offset 越界抛错', () => {
  const req = { offset: 5, limit: 5, maxLineLength: 100, maxBytes: 10000 };
  assert.throws(() => buildWindow('a\nb\nc', req, 'f.txt'), /offset 5 is out of range/);
});

test('buildWindow 空文件 offset=1 不抛错', () => {
  const req = { offset: 1, limit: 5, maxLineLength: 100, maxBytes: 10000 };
  const w = buildWindow('', req, 'empty.txt');
  assert.strictEqual(w.totalLines, 1);
  assert.strictEqual(w.lines.length, 1);
  assert.strictEqual(w.lines[0].text, '');
});

test('buildWindow 超长行截断', () => {
  const long = 'x'.repeat(10);
  const req = { offset: 1, limit: 5, maxLineLength: 5, maxBytes: 10000 };
  const w = buildWindow(long, req, 'f.txt');
  assert.strictEqual(w.lines[0].text, 'xxxxx... (line truncated to 5 chars)');
});

test('buildWindow 字节上限截断', () => {
  const req = { offset: 1, limit: 10, maxLineLength: 100, maxBytes: 10 };
  const w = buildWindow('hello\nworld\n!', req, 'f.txt');
  assert.strictEqual(w.truncatedByBytes, true);
  assert.ok(w.lines.length < 3);
});

test('formatReadOutput 完整文件', () => {
  const out = { offset: 1, lines: [{ number: 1, text: 'a' }, { number: 2, text: 'b' }], totalLines: 2, truncatedByBytes: false };
  const s = formatReadOutput('f.txt', out);
  assert.ok(s.indexOf('f.txt') >= 0, '首行应含文件路径');
  assert.ok(s.indexOf('<path>') < 0, '不应再出现 <path> 标签');
  assert.match(s, /1: a/);
  assert.match(s, /2: b/);
  const footer = s.split('\n\n').pop();
  assert.ok(footer && footer.indexOf('2') >= 0, '结尾应含总行数 2：' + footer);
  assert.ok(/^\(/.test(footer), '结尾应以括号开头：' + footer);
});

test('formatReadOutput 部分读取：首行含行号范围', () => {
  const out = { offset: 2, lines: [{ number: 2, text: 'b' }], totalLines: 5, truncatedByBytes: false };
  const s = formatReadOutput('f.txt', out);
  const header = s.split('\n')[0];
  assert.ok(header.indexOf('f.txt') >= 0, '首行应含路径：' + header);
  assert.ok(header.indexOf('2') >= 0, '首行应含起始行号：' + header);
  assert.ok(header.indexOf('5') >= 0 || header.indexOf('3') >= 0, '首行应含总行数或剩余行数：' + header);
  assert.ok(header.indexOf('<path>') < 0, '不应出现 XML 标签');
  const footer = s.split('\n\n').pop();
  assert.ok(footer && footer.indexOf('offset=3') >= 0, '结尾应含 offset=3（下一段起点）：' + footer);
  assert.ok(footer.indexOf('5') >= 0, '结尾应含总行数 5：' + footer);
});

test('formatReadOutput 首行与正文之间有空行分隔', () => {
  const out = { offset: 1, lines: [{ number: 1, text: 'a' }], totalLines: 1, truncatedByBytes: false };
  const s = formatReadOutput('f.txt', out);
  assert.match(s, /\n\n1: a/);
});

test('formatReadOutput 无行仅有 footer', () => {
  const out = { offset: 2, lines: [], totalLines: 1, truncatedByBytes: false };
  const s = formatReadOutput('f.txt', out);
  const footer = s.split('\n\n').pop();
  assert.ok(/^\(/.test(footer), '结尾应以括号开头：' + footer);
});


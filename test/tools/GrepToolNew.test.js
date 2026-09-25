'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { parseGrepArgs, validateInclude, parseGrepMatches, formatGrepOutput, retainGrepMatches, previewLine } from '../../src/tools/impl/grep.js';

test('validateInclude 合法', () => {
  assert.doesNotThrow(() => validateInclude('*.js'));
  assert.doesNotThrow(() => validateInclude('*.{js,ts}'));
  assert.doesNotThrow(() => validateInclude('src/**/*.js'));
});

test('validateInclude 空抛错', () => {
  assert.throws(() => validateInclude(''), /include must be a non-empty glob when given/);
  assert.throws(() => validateInclude('   '), /include must be a non-empty glob when given/);
});

test('validateInclude 否定 glob 抛错', () => {
  assert.throws(() => validateInclude('!*.js'), /negated patterns/);
});

test('validateInclude 逗号列表抛错', () => {
  assert.throws(() => validateInclude('*.js,*.ts'), /not a comma-separated list/);
});

test('validateInclude 花括号内逗号不抛错', () => {
  assert.doesNotThrow(() => validateInclude('*.{js,ts}'));
});

test('parseGrepArgs 正常', () => {
  assert.deepStrictEqual(parseGrepArgs('foo', undefined, undefined), { pattern: 'foo' });
  assert.deepStrictEqual(parseGrepArgs('foo', 'src', '*.js'), { pattern: 'foo', path: 'src', include: '*.js' });
});

test('parseGrepArgs 空 pattern 抛错', () => {
  assert.throws(() => parseGrepArgs('', undefined, undefined), /pattern must be a non-empty string/);
});

test('parseGrepArgs path 空串视为未提供', () => {
  assert.deepStrictEqual(parseGrepArgs('foo', '', undefined), { pattern: 'foo' });
  assert.deepStrictEqual(parseGrepArgs('foo', '   ', undefined), { pattern: 'foo' });
  assert.throws(() => parseGrepArgs('foo', 123, undefined), /path must be a string when given/);
});

test('parseGrepMatches 解析 NDJSON', () => {
  const record = { type: 'match', data: { path: { text: 'a.js' }, line_number: 3, lines: { text: 'hello\n' } } };
  const matches = parseGrepMatches(JSON.stringify(record) + '\n');
  assert.strictEqual(matches.length, 1);
  assert.deepStrictEqual(matches[0], { path: 'a.js', lineNumber: 3, line: 'hello' });
});

test('parseGrepMatches 忽略非 match 记录', () => {
  const begin = { type: 'begin', data: {} };
  const match = { type: 'match', data: { path: { text: 'b.js' }, line_number: 1, lines: { text: 'x' } } };
  const matches = parseGrepMatches(JSON.stringify(begin) + '\n' + JSON.stringify(match) + '\n');
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].path, 'b.js');
});

test('parseGrepMatches 非法 JSON 抛错', () => {
  assert.throws(() => parseGrepMatches('not json\n'), /malformed ripgrep/);
});

test('parseGrepMatches bytes 行返回占位', () => {
  const record = { type: 'match', data: { path: { text: 'c.js' }, line_number: 5, lines: { bytes: 'abc' } } };
  const matches = parseGrepMatches(JSON.stringify(record));
  assert.strictEqual(matches[0].line, '(line is not valid UTF-8)');
});

test('formatGrepOutput 基本与截断', () => {
  const retained = { truncated: false, seen: 2, items: [{ path: 'a.js', lineNumber: 1, line: 'x' }, { path: 'b.js', lineNumber: 2, line: 'y' }] };
  const out = formatGrepOutput(retained);
  assert.match(out, /Found 2 matches/);
  assert.match(out, /a\.js/);
  assert.match(out, /Line 1: x/);
  const trunc = { truncated: true, kept: 1, seen: 5, items: [{ path: 'a.js', lineNumber: 1, line: 'x' }] };
  const out2 = formatGrepOutput(trunc);
  assert.match(out2, /Found 1 of 5 matches/);
  assert.match(out2, /narrow pattern/);
});

test('retainGrepMatches 截断', () => {
  const matches = Array.from({ length: 5 }, (_, i) => ({ path: 'f.js', lineNumber: i + 1, line: 'line' + i }));
  const r = retainGrepMatches(matches, 3, 2000);
  assert.strictEqual(r.seen, 5);
  assert.strictEqual(r.kept, 3);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.items.length, 3);
});

test('previewLine 超长截断', () => {
  const line = 'x'.repeat(10);
  const out = previewLine(line, 5);
  assert.match(out, /\(line truncated\)/);
  assert.strictEqual(previewLine('short', 100), 'short');
});



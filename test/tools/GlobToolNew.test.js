'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { parseGlobArgs, formatGlobOutput, buildGlobArgs, MAX_RESULTS, GLOB_VCS_EXCLUDES } from '../../src/tools/impl/glob.js';

test('parseGlobArgs 正常', () => {
  assert.deepStrictEqual(parseGlobArgs('**/*.js', undefined), { pattern: '**/*.js' });
  assert.deepStrictEqual(parseGlobArgs('*.js', 'src'), { pattern: '*.js', path: 'src' });
});

test('parseGlobArgs 空 pattern 抛错', () => {
  assert.throws(() => parseGlobArgs('', undefined), /pattern must be a non-empty string/);
  assert.throws(() => parseGlobArgs(null, undefined), /pattern must be a non-empty string/);
});

test('parseGlobArgs path 空串视为未提供', () => {
  assert.deepStrictEqual(parseGlobArgs('*', ''), { pattern: '*' });
  assert.deepStrictEqual(parseGlobArgs('*', '   '), { pattern: '*' });
  assert.throws(() => parseGlobArgs('*', 123), /path must be a string when given/);
});

test('buildGlobArgs 无 path', () => {
  const args = buildGlobArgs({ pattern: '*.js' });
  assert.ok(args.includes('--files'));
  assert.ok(args.includes('--glob=*.js'));
  assert.ok(args.includes('--no-ignore'));
  assert.ok(args.includes('--hidden'));
  assert.ok(!args.includes('--'));
});

test('buildGlobArgs 有 path', () => {
  const args = buildGlobArgs({ pattern: '*.js', path: 'src' });
  const idx = args.indexOf('--');
  assert.ok(idx !== -1);
  assert.strictEqual(args[idx + 1], 'src');
});

test('buildGlobArgs 排除 VCS 目录', () => {
  const args = buildGlobArgs({ pattern: '*.js' });
  for (const name of GLOB_VCS_EXCLUDES) {
    assert.ok(args.includes('--glob=!**/' + name));
    assert.ok(args.includes('--glob=!**/' + name + '/**'));
  }
});

test('formatGlobOutput 不截断', () => {
  const out = formatGlobOutput(['a.js', 'b.js'], 2, false);
  assert.strictEqual(out, 'a.js\nb.js\n\n(Found 2 files)');
});

test('formatGlobOutput 截断', () => {
  const out = formatGlobOutput(['a.js'], 101, true);
  assert.match(out, /\(Showing 1 of 101 paths/);
});

test('MAX_RESULTS 为 100', () => {
  assert.strictEqual(MAX_RESULTS, 100);
});


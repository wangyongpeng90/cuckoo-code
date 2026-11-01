'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGlobArgs, formatGlobOutput, buildGlobArgs, MAX_RESULTS, GLOB_VCS_EXCLUDES, GLOB_ARTIFACT_EXCLUDES, buildIgnoreNote } from '../../src/tools/impl/glob.js';

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
  assert.ok(out.startsWith('a.js\nb.js\n\n('), '应为路径列表 + 空行 + 括号结尾');
  assert.ok(out.indexOf('2') >= 0, '结尾应含文件数 2');
});

test('formatGlobOutput 截断', () => {
  const out = formatGlobOutput(['a.js'], 101, true);
  const footer = out.split('\n\n').pop();
  assert.ok(footer.indexOf('101') >= 0, '结尾应含总数 101：' + footer);
  assert.ok(footer.indexOf('1') >= 0, '结尾应含已显示数：' + footer);
});

test('MAX_RESULTS 为 100', () => {
  assert.strictEqual(MAX_RESULTS, 100);
});

// ===== 产物目录排除（P1：默认遍历 node_modules）=====
test('buildGlobArgs 无 path 时排除产物目录', () => {
  const args = buildGlobArgs({ pattern: '*.ts' });
  for (const name of GLOB_ARTIFACT_EXCLUDES) {
    assert.ok(args.includes('--glob=!**/' + name), 'missing !**/' + name);
    assert.ok(args.includes('--glob=!**/' + name + '/**'), 'missing !**/' + name + '/**');
  }
  assert.ok(args.includes('--glob=!**/node_modules'));
  assert.ok(args.includes('--glob=!**/node_modules/**'));
});

test('buildGlobArgs 显式 path 时不排除产物目录', () => {
  const args = buildGlobArgs({ pattern: '*.ts', path: 'src' });
  assert.ok(!args.some(a => a.startsWith('--glob=!**/node_modules')));
});

test('GLOB_ARTIFACT_EXCLUDES 含常见产物目录', () => {
  for (const name of ['node_modules', 'dist', 'out', 'build']) {
    assert.ok(GLOB_ARTIFACT_EXCLUDES.includes(name), 'missing ' + name);
  }
});

// ===== 忽略提示（让 AI 知道哪些目录被忽略了）=====
test('buildIgnoreNote：存在被忽略的目录 → 提示列出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-glob-'));
  try {
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.mkdirSync(path.join(dir, 'src')); // 非忽略目录，不该出现
    const note = buildIgnoreNote(dir);
    assert.ok(note.includes('node_modules'));
    assert.ok(note.includes('dist'));
    assert.ok(!note.includes('src'));
    assert.ok(note.includes('path'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildIgnoreNote：无被忽略的目录 → 空串', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-glob-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    assert.strictEqual(buildIgnoreNote(dir), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



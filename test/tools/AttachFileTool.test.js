'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolveFilePath, guessMimeType, buildInjectCode } = require('../../tools/AttachFileTool');

test('resolveFilePath 空/非字符串抛错', () => {
  assert.throws(() => resolveFilePath('', null), /non-empty string/);
  assert.throws(() => resolveFilePath(null, null), /non-empty string/);
  assert.throws(() => resolveFilePath(123, null), /non-empty string/);
});

test('resolveFilePath 绝对路径原样返回', () => {
  const abs = path.resolve('/tmp/foo.txt');
  assert.strictEqual(resolveFilePath(abs, null), abs);
});

test('resolveFilePath 相对路径基于 projectDir', () => {
  const base = path.resolve('/proj');
  const out = resolveFilePath('src/a.js', base);
  assert.strictEqual(out, path.join(base, 'src', 'a.js'));
});

test('resolveFilePath 正斜杠相对路径基于 projectDir', () => {
  const base = path.resolve('/proj');
  const out = resolveFilePath('src/sub/a.js', base);
  assert.strictEqual(out, path.join(base, 'src', 'sub', 'a.js'));
});

test('guessMimeType 已知扩展名', () => {
  assert.strictEqual(guessMimeType('a.txt'), 'text/plain');
  assert.strictEqual(guessMimeType('a.md'), 'text/markdown');
  assert.strictEqual(guessMimeType('a.PNG'), 'image/png');
  assert.strictEqual(guessMimeType('a.json'), 'application/json');
});

test('guessMimeType 未知扩展名回退 octet-stream', () => {
  assert.strictEqual(guessMimeType('a.xyz'), 'application/octet-stream');
  assert.strictEqual(guessMimeType('noext'), 'application/octet-stream');
});

test('buildInjectCode 包含文件名与 base64', () => {
  const code = buildInjectCode('aGVsbG8=', 'hello.txt', 'text/plain', 5000);
  assert.match(code, /hello\.txt/);
  assert.match(code, /aGVsbG8=/);
  assert.match(code, /text\/plain/);
  assert.match(code, /DataTransfer/);
  assert.match(code, /input\[type=file\]/);
});

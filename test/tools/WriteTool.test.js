'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { parseWriteArgs, formatWriteOutput } from '../../src/tools/impl/write.js';

test('parseWriteArgs 正常', () => {
  assert.deepStrictEqual(parseWriteArgs('a.txt', 'hello'), { filePath: 'a.txt', content: 'hello' });
  assert.deepStrictEqual(parseWriteArgs('a.txt', ''), { filePath: 'a.txt', content: '' });
});

test('parseWriteArgs 非法路径', () => {
  assert.throws(() => parseWriteArgs('', 'x'), /filePath must be a non-empty string/);
  assert.throws(() => parseWriteArgs('   ', 'x'), /filePath must be a non-empty string/);
});

test('parseWriteArgs content 非字符串', () => {
  assert.throws(() => parseWriteArgs('a.txt', 123), /content must be a string/);
  assert.throws(() => parseWriteArgs('a.txt', null), /content must be a string/);
});

test('formatWriteOutput 新建：含路径，无 XML 标签', () => {
  const s = formatWriteOutput('a.txt', 'create');
  assert.ok(s.indexOf('a.txt') >= 0, '应含文件路径：' + s);
  assert.ok(s.indexOf('<path>') < 0, '不应出现 <path>：' + s);
  assert.ok(s.indexOf('<content>') < 0, '不应出现 <content>：' + s);
});

test('formatWriteOutput 更新：含路径，无 XML 标签', () => {
  const s = formatWriteOutput('a.txt', 'update');
  assert.ok(s.indexOf('a.txt') >= 0, '应含文件路径：' + s);
  assert.ok(s.indexOf('<path>') < 0, '不应出现 <path>：' + s);
});

test('formatWriteOutput 新建与更新措辞不同（来自两套池）', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(formatWriteOutput('x.txt', 'create'));
  assert.ok(seen.size >= 3, '新建池应有多条可用，实际 ' + seen.size);
  const seenU = new Set();
  for (let i = 0; i < 200; i++) seenU.add(formatWriteOutput('x.txt', 'update'));
  assert.ok(seenU.size >= 3, '更新池应有多条可用，实际 ' + seenU.size);
});


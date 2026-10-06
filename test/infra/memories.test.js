'use strict';
import { test, beforeEach } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 用 CUCKOO_HOME 隔离
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-mem-'));
process.env.CUCKOO_HOME = TMP;

const { listMemories, saveMemories, addMemory, removeMemory, buildMemorySection } = await import('../../src/infra/memories.js');

beforeEach(() => { try { fs.rmSync(path.join(TMP, 'memories.json'), { force: true }); } catch {} });

test('初始为空', () => {
  assert.deepStrictEqual(listMemories(), []);
});

test('addMemory 新增并持久化', () => {
  const m = addMemory('用户偏好中文');
  assert.ok(m && m.id && m.text === '用户偏好中文');
  assert.strictEqual(listMemories().length, 1);
});

test('addMemory 空文本返回 null', () => {
  assert.strictEqual(addMemory('   '), null);
  assert.strictEqual(listMemories().length, 0);
});

test('removeMemory 删除', () => {
  const m = addMemory('x');
  assert.strictEqual(removeMemory(m.id), true);
  assert.strictEqual(listMemories().length, 0);
  assert.strictEqual(removeMemory('不存在'), false);
});

test('saveMemories 覆盖并过滤非法项', () => {
  saveMemories([{ text: 'a' }, { text: '' }, null, { text: 'b' }]);
  const list = listMemories();
  assert.strictEqual(list.length, 2);
});

test('buildMemorySection 无记忆返回空串', () => {
  assert.strictEqual(buildMemorySection(), '');
});

test('buildMemorySection 有记忆返回章节', () => {
  addMemory('习惯1');
  addMemory('习惯2');
  const s = buildMemorySection();
  assert.ok(s.includes('## 用户记忆'));
  assert.ok(s.includes('习惯1'));
  assert.ok(s.includes('习惯2'));
});

// ===== 去重 / 截断 / 上限（024 加固）=====

test('addMemory 重复内容不重复添加', () => {
  const a = addMemory('同样的话');
  const b = addMemory('同样的话');
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(listMemories().length, 1);
});

test('addMemory 首尾空白不同视为重复', () => {
  const a = addMemory('内容');
  const b = addMemory('  内容  ');
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(listMemories().length, 1);
});

test('addMemory 超长截断到 500 字符', () => {
  const m = addMemory('x'.repeat(800));
  assert.strictEqual(m.text.length, 500);
});

test('addMemory 超过 200 条时丢弃最旧', () => {
  for (let i = 0; i < 205; i++) addMemory('记忆' + i);
  const list = listMemories();
  assert.strictEqual(list.length, 200);
  // 最旧的几条已被丢弃
  assert.ok(!list.some((m) => m.text === '记忆0'));
});

test('buildMemorySection 超长时截断并提示', () => {
  for (let i = 0; i < 100; i++) addMemory('很长的记忆内容' + i + '-' + 'y'.repeat(100));
  const s = buildMemorySection();
  assert.ok(s.includes('更多记忆已省略'));
  assert.ok(s.length < 5000);
});

'use strict';
/**
 * src/app/tool-activity.ts 单测（Node 环境）：按窗口隔离的内存历史。
 * 同 id 更新（running → done）、上限 50、清空、窗口关闭清理。
 */
import { test, beforeEach } from 'vitest';
import assert from 'node:assert';

let store;

beforeEach(async () => {
  store = await import('../../src/app/tool-activity.js');
  store.removeWindowHistory(1);
  store.removeWindowHistory(2);
});

function entry(id, overrides) {
  return {
    id: String(id),
    command: '[JS] echo ' + id,
    success: true,
    canceled: false,
    output: 'out ' + id,
    timestamp: 1000 + Number(id) || 1000,
    status: 'done',
    ...(overrides || {}),
  };
}

test('新条目插入最前（新→旧）', () => {
  store.upsertEntry(1, entry('a'));
  store.upsertEntry(1, entry('b'));
  const list = store.getHistory(1);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, 'b');
  assert.strictEqual(list[1].id, 'a');
});

test('同 id 覆盖更新且位置不变（running → done）', () => {
  store.upsertEntry(1, entry('a'));
  store.upsertEntry(1, entry('b'));
  store.upsertEntry(1, { ...entry('b'), status: 'running', output: '', success: false });
  const list = store.getHistory(1);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, 'b');
  assert.strictEqual(list[0].status, 'running');
  assert.strictEqual(list[0].output, '');
});

test('历史按窗口隔离', () => {
  store.upsertEntry(1, entry('a'));
  store.upsertEntry(2, entry('b'));
  assert.strictEqual(store.getHistory(1).length, 1);
  assert.strictEqual(store.getHistory(1)[0].id, 'a');
  assert.strictEqual(store.getHistory(2)[0].id, 'b');
  assert.strictEqual(store.getHistory(99).length, 0);
});

test('超过 50 条裁掉最旧', () => {
  for (let i = 0; i < 55; i++) store.upsertEntry(1, entry('id' + i));
  const list = store.getHistory(1);
  assert.strictEqual(list.length, 50);
  assert.strictEqual(list[0].id, 'id54');
  assert.strictEqual(list[49].id, 'id5');
});

test('getHistory 返回副本，外部修改不影响内部状态', () => {
  store.upsertEntry(1, entry('a'));
  const list = store.getHistory(1);
  list.length = 0;
  assert.strictEqual(store.getHistory(1).length, 1);
});

test('clearHistory 清空指定窗口', () => {
  store.upsertEntry(1, entry('a'));
  store.upsertEntry(2, entry('b'));
  store.clearHistory(1);
  assert.strictEqual(store.getHistory(1).length, 0);
  assert.strictEqual(store.getHistory(2).length, 1);
});

test('removeWindowHistory 清理关闭窗口的历史', () => {
  store.upsertEntry(1, entry('a'));
  store.removeWindowHistory(1);
  assert.strictEqual(store.getHistory(1).length, 0);
});

test('无 id / 空 id / 空条目的上报被忽略', () => {
  store.upsertEntry(1, null);
  store.upsertEntry(1, {});
  store.upsertEntry(1, { id: '' });
  assert.strictEqual(store.getHistory(1).length, 0);
});

test('非法字段归一化（非字符串 command/output、缺 timestamp）', () => {
  store.upsertEntry(1, { id: 'x', command: 42, output: null, status: 'weird' });
  const list = store.getHistory(1);
  assert.strictEqual(list[0].command, '');
  assert.strictEqual(list[0].output, '');
  assert.strictEqual(list[0].status, 'done');
  assert.strictEqual(typeof list[0].timestamp, 'number');
});

test('upsertEntry 返回归一化副本（供 IPC 层转发壳页面，而非转发原始上报）', () => {
  const copy = store.upsertEntry(1, { id: 'x', command: 42, output: null, status: 'weird' });
  assert.ok(copy);
  assert.strictEqual(copy.command, '');
  assert.strictEqual(copy.output, '');
  assert.strictEqual(copy.status, 'done');
  assert.strictEqual(copy.canceled, false);
  assert.strictEqual(typeof copy.timestamp, 'number');
  assert.deepStrictEqual(store.getHistory(1)[0], copy);
});

test('upsertEntry 对无 id 条目返回 null', () => {
  assert.strictEqual(store.upsertEntry(1, null), null);
  assert.strictEqual(store.upsertEntry(1, {}), null);
});

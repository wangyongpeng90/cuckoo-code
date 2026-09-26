'use strict';
/**
 * compaction 纯函数测试：pickRecentPairedIds（消息链回溯 + 成对裁剪）
 * 这些逻辑不依赖 Electron，可独立测试；涉及 IDB/IPC 的部分靠真机验证。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

let compaction;

function setupGlobals() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  globalThis.window = {
    location: { href: 'https://chat.deepseek.com/a/chat/s/abc' },
    addEventListener() {},
    dispatchEvent() {},
  };
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {} },
  };
}

beforeEach(async () => {
  vi.resetModules();
  setupGlobals();
  compaction = await import('../../src/session/compaction.js');
});

// 构造：根(1,USER) → (2,ASSISTANT) → (3,USER) → (4,ASSISTANT)
function linearMsgs() {
  return [
    { message_id: 1, role: 'USER', parent_id: null },
    { message_id: 2, role: 'ASSISTANT', parent_id: 1 },
    { message_id: 3, role: 'USER', parent_id: 2 },
    { message_id: 4, role: 'ASSISTANT', parent_id: 3 },
  ];
}

test('_pickRecentPairedIds 空数组返回空', () => {
  assert.deepStrictEqual(compaction._pickRecentPairedIds([], null, 0.2), []);
});

test('_pickRecentPairedIds 沿 parent_id 回溯主链（含分支时只取主链）', () => {
  // 分支：3 下有两个回复 4 和 5（5 是另一个分支）
  const msgs = [
    { message_id: 1, role: 'USER', parent_id: null },
    { message_id: 2, role: 'ASSISTANT', parent_id: 1 },
    { message_id: 3, role: 'USER', parent_id: 2 },
    { message_id: 4, role: 'ASSISTANT', parent_id: 3 },
    { message_id: 5, role: 'ASSISTANT', parent_id: 3 },
  ];
  // 指定叶子 4 → 主链为 1,2,3,4，不应包含分支 5
  const picked = compaction._pickRecentPairedIds(msgs, 4, 1);
  assert.ok(picked.includes(4), '包含叶子 4');
  assert.ok(!picked.includes(5), '不包含分支 5');
});

test('_pickRecentPairedIds 结果按 message_id 降序', () => {
  const picked = compaction._pickRecentPairedIds(linearMsgs(), null, 1);
  for (let i = 1; i < picked.length; i++) {
    assert.ok(picked[i - 1] > picked[i], '应降序');
  }
});

test('_pickRecentPairedIds 起点对齐 USER、终点对齐 ASSISTANT（成对）', () => {
  const picked = compaction._pickRecentPairedIds(linearMsgs(), null, 0.5);
  assert.ok(picked.length >= 2, '至少一对');
  const sortedAsc = [...picked].sort((a, b) => a - b);
  // 最小 id 应是 USER 消息（1 或 3）
  assert.ok(sortedAsc[0] === 1 || sortedAsc[0] === 3, '起点是 USER');
});

test('_pickRecentPairedIds 无 parent_id 数据时回退按 id 取尾部', () => {
  // 全部无 parent_id（链长为 1）→ 回退 msgs 原序
  const msgs = [
    { message_id: 1, role: 'USER' },
    { message_id: 2, role: 'ASSISTANT' },
    { message_id: 3, role: 'USER' },
    { message_id: 4, role: 'ASSISTANT' },
  ];
  const picked = compaction._pickRecentPairedIds(msgs, null, 1);
  assert.strictEqual(picked.length, 4);
});

test('_pickRecentPairedIds leafId 不存在时用最大 message_id', () => {
  const picked = compaction._pickRecentPairedIds(linearMsgs(), 999, 1);
  assert.ok(picked.includes(4), '回退到最大 id 作为叶子');
});

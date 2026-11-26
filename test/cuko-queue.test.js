/**
 * [261126-q7mxk2-cuko-message-queue] 主进程消息队列（纯内存）
 * 覆盖：两条通道的顺序、移动 / 编辑 / 删除、暂停与恢复、订阅通知，以及各种失败路径。
 */
import { describe, it, expect, vi } from 'vitest';
import { CukoQueueStore } from '../src/app/cuko-queue.js';

const S = 'session-a';
const texts = (list) => list.map((x) => x.text);

describe('CukoQueueStore 入队', () => {
  it('默认进普通排队，按入队顺序排列', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 'a');
    q.enqueue(S, 'b');
    const snap = q.get(S);
    expect(texts(snap.items)).toEqual(['a', 'b']);
    expect(snap.steerItems).toEqual([]);
    expect(snap.paused).toBe(false);
  });

  it('lane=steer 进插话通道，并记下窗口 id', () => {
    const q = new CukoQueueStore();
    const r = q.enqueue(S, 'x', { lane: 'steer', windowId: 3 });
    expect(r.success).toBe(true);
    expect(r.item.windowId).toBe(3);
    expect(texts(q.get(S).steerItems)).toEqual(['x']);
    expect(q.hasSteer(S)).toBe(true);
  });

  it('空内容 / 只有空白 / 不是字符串 / 缺会话 ID 都拒绝，队列不变', () => {
    const q = new CukoQueueStore();
    expect(q.enqueue(S, '').success).toBe(false);
    expect(q.enqueue(S, '    ').success).toBe(false);
    expect(q.enqueue(S, undefined).success).toBe(false);
    expect(q.enqueue('', 'a').success).toBe(false);
    expect(q.get(S).items).toEqual([]);
    expect(q.get('').items).toEqual([]);
  });
});

describe('取出顺序', () => {
  it('takeSteer 一次取出全部插话并清空，takeNext 只取普通排队第一条', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 'q1');
    q.enqueue(S, 'q2');
    q.enqueue(S, 's1', { lane: 'steer' });
    q.enqueue(S, 's2', { lane: 'steer' });
    expect(texts(q.takeSteer(S))).toEqual(['s1', 's2']);
    expect(q.hasSteer(S)).toBe(false);
    expect(q.takeSteer(S)).toEqual([]);
    expect(q.takeNext(S).text).toBe('q1');
    expect(texts(q.get(S).items)).toEqual(['q2']);
  });

  it('队列为空时 takeNext 返回 null、takeSteer 返回空数组', () => {
    const q = new CukoQueueStore();
    expect(q.takeNext(S)).toBeNull();
    expect(q.takeSteer(S)).toEqual([]);
  });
});

describe('移动', () => {
  it('普通排队移到插话通道最前（insertAfter: null）', () => {
    const q = new CukoQueueStore();
    const a = q.enqueue(S, 'a').item;
    q.enqueue(S, 's', { lane: 'steer' });
    expect(q.move(S, a.id, { lane: 'steer', insertAfter: null }).success).toBe(true);
    const snap = q.get(S);
    expect(texts(snap.steerItems)).toEqual(['a', 's']);
    expect(snap.items).toEqual([]);
  });

  it('不给位置就放到目标通道末尾', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 's', { lane: 'steer' });
    const a = q.enqueue(S, 'a').item;
    q.move(S, a.id, { lane: 'steer' });
    expect(texts(q.get(S).steerItems)).toEqual(['s', 'a']);
  });

  it('同一通道里用 insertBefore / insertAfter 调整顺序', () => {
    const q = new CukoQueueStore();
    const a = q.enqueue(S, 'a').item;
    const b = q.enqueue(S, 'b').item;
    const c = q.enqueue(S, 'c').item;
    q.move(S, c.id, { insertBefore: a.id });
    expect(texts(q.get(S).items)).toEqual(['c', 'a', 'b']);
    q.move(S, c.id, { insertAfter: b.id });
    expect(texts(q.get(S).items)).toEqual(['a', 'b', 'c']);
  });

  it('锚点不存在时放到末尾', () => {
    const q = new CukoQueueStore();
    const a = q.enqueue(S, 'a').item;
    q.enqueue(S, 'b');
    q.move(S, a.id, { insertBefore: 'no-such-id' });
    expect(texts(q.get(S).items)).toEqual(['b', 'a']);
  });

  it('移动不存在的条目 / 不存在的会话返回失败，队列不变', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 'a');
    expect(q.move(S, 'nope', { lane: 'steer' }).success).toBe(false);
    expect(q.move('other', 'nope').success).toBe(false);
    expect(texts(q.get(S).items)).toEqual(['a']);
    expect(q.get(S).steerItems).toEqual([]);
  });
});

describe('编辑与删除', () => {
  it('edit 改文字，id 和位置不变', () => {
    const q = new CukoQueueStore();
    const a = q.enqueue(S, 'a').item;
    q.enqueue(S, 'b');
    const r = q.edit(S, a.id, 'a2');
    expect(r.success).toBe(true);
    expect(r.item.id).toBe(a.id);
    expect(texts(q.get(S).items)).toEqual(['a2', 'b']);
  });

  it('edit 成空内容被拒绝，原文保留', () => {
    const q = new CukoQueueStore();
    const a = q.enqueue(S, 'a').item;
    expect(q.edit(S, a.id, '   ').success).toBe(false);
    expect(q.edit(S, a.id, null).success).toBe(false);
    expect(texts(q.get(S).items)).toEqual(['a']);
  });

  it('edit / remove 不存在的条目返回失败', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 'a');
    expect(q.edit(S, 'nope', 'x').success).toBe(false);
    expect(q.remove(S, 'nope').success).toBe(false);
    expect(q.remove('other', 'nope').success).toBe(false);
    expect(texts(q.get(S).items)).toEqual(['a']);
  });

  it('删光后返回空快照，暂停标记随之清掉', () => {
    const q = new CukoQueueStore();
    const a = q.enqueue(S, 'a').item;
    const s = q.enqueue(S, 's', { lane: 'steer' }).item;
    q.pause(S);
    q.remove(S, a.id);
    expect(q.isPaused(S)).toBe(true);
    q.remove(S, s.id);
    expect(q.get(S)).toEqual({ sessionId: S, items: [], steerItems: [], paused: false });
  });
});

describe('暂停与恢复', () => {
  it('暂停后 takeNext 返回 null，消息保留；resume 后可以取出', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 'a');
    q.pause(S);
    expect(q.isPaused(S)).toBe(true);
    expect(q.get(S).paused).toBe(true);
    expect(q.takeNext(S)).toBeNull();
    expect(texts(q.get(S).items)).toEqual(['a']);
    q.resume(S);
    expect(q.isPaused(S)).toBe(false);
    expect(q.takeNext(S).text).toBe('a');
  });

  it('暂停不影响取出插话', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 's', { lane: 'steer' });
    q.pause(S);
    expect(texts(q.takeSteer(S))).toEqual(['s']);
  });

  it('空队列暂停不记录，之后入队的消息不会一开始就是暂停', () => {
    const q = new CukoQueueStore();
    q.pause(S);
    q.enqueue(S, 'a');
    expect(q.isPaused(S)).toBe(false);
    expect(q.takeNext(S).text).toBe('a');
  });
});

describe('会话隔离与快照', () => {
  it('不同会话互不影响，clear 只清一个', () => {
    const q = new CukoQueueStore();
    q.enqueue('s1', 'a');
    q.enqueue('s2', 'b');
    q.pause('s1');
    expect(q.isPaused('s2')).toBe(false);
    q.clear('s1');
    expect(q.get('s1').items).toEqual([]);
    expect(texts(q.get('s2').items)).toEqual(['b']);
  });

  it('快照是副本，改快照不影响队列', () => {
    const q = new CukoQueueStore();
    q.enqueue(S, 'a');
    const snap = q.get(S);
    snap.items[0].text = 'changed';
    snap.items.push({ id: 'x', text: 'x', windowId: null, createdAt: 0 });
    expect(texts(q.get(S).items)).toEqual(['a']);
  });
});

describe('订阅通知', () => {
  it('每次变化都通知，带当前快照；退订后不再通知', () => {
    const q = new CukoQueueStore();
    const seen = [];
    const off = q.subscribe((s) => seen.push(texts(s.items)));
    q.enqueue(S, 'a');
    q.enqueue(S, 'b');
    q.takeNext(S);
    off();
    q.enqueue(S, 'c');
    expect(seen).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('失败的操作和无变化的操作不通知', () => {
    const q = new CukoQueueStore();
    let calls = 0;
    q.subscribe(() => { calls++; });
    q.enqueue(S, '');
    q.remove(S, 'nope');
    q.move(S, 'nope');
    q.edit(S, 'nope', 'x');
    q.pause(S);
    q.resume(S);
    q.clear(S);
    expect(q.takeNext(S)).toBeNull();
    expect(calls).toBe(0);
  });

  it('一个订阅者抛错，不影响其他订阅者，也不影响操作结果', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const q = new CukoQueueStore();
      let got = 0;
      q.subscribe(() => { throw new Error('boom'); });
      q.subscribe(() => { got++; });
      expect(q.enqueue(S, 'a').success).toBe(true);
      expect(got).toBe(1);
      expect(texts(q.get(S).items)).toEqual(['a']);
    } finally {
      spy.mockRestore();
    }
  });
});

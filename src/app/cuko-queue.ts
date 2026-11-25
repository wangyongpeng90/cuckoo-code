/**
 * [261126-q7mxk2-cuko-message-queue] Cuko 消息发送队列（主进程内存，程序重启后清空）
 *
 * 每个会话一份队列，分两条通道：
 * - steer（插话）：本轮工具执行完后，和工具结果一起发；本轮没调工具就作为下一轮的用户消息
 * - queue（排队）：本次运行正常结束后，取第一条开始新的运行
 * 停止 / 出错时队列暂停（消息保留），下次手动发送时恢复。
 *
 * 本模块只管数据：不依赖 Electron、不碰数据库；什么时候取出由 cuko-runner 决定。
 * 详细设计见 docs/requirements/261126-q7mxk2-cuko-message-queue.md
 */
import { randomUUID } from 'node:crypto';

export type CukoQueueLane = 'queue' | 'steer';

export interface CukoQueueItem {
  id: string;
  text: string;
  /** 发起这条消息的 Cuko 窗口 id（部分工具需要窗口上下文；窗口关了就是失效 id） */
  windowId: number | null;
  createdAt: number;
}

export interface CukoQueueSnapshot {
  sessionId: string;
  /** 普通排队（按顺序） */
  items: CukoQueueItem[];
  /** 插话（先于普通排队） */
  steerItems: CukoQueueItem[];
  /** 是否暂停（停止 / 出错后为 true，普通排队不自动发） */
  paused: boolean;
}

/**
 * 移动位置（与 assistant-ui 的 QueuePlacement 一致）：
 * - lane 不给 = 留在原通道
 * - insertBefore / insertAfter 给条目 id = 放在它前 / 后
 * - insertAfter 为 null = 放到最前
 * - 都不给（或锚点找不到）= 放到末尾
 */
export interface CukoQueuePlacement {
  lane?: CukoQueueLane;
  insertAfter?: string | null;
  insertBefore?: string | null;
}

export interface CukoQueueResult {
  success: boolean;
  error?: string;
  item?: CukoQueueItem;
}

export interface CukoEnqueueOptions {
  lane?: CukoQueueLane;
  windowId?: number | null;
}

export type CukoQueueListener = (snapshot: CukoQueueSnapshot) => void;

interface SessionQueue {
  items: CukoQueueItem[];
  steerItems: CukoQueueItem[];
  paused: boolean;
}

interface FoundItem {
  lane: CukoQueueLane;
  index: number;
  item: CukoQueueItem;
}

const NOT_FOUND = '排队消息不存在';
const EMPTY_TEXT = '消息内容为空';

function copyItem(item: CukoQueueItem): CukoQueueItem {
  return { ...item };
}

export class CukoQueueStore {
  private readonly sessions = new Map<string, SessionQueue>();
  private readonly listeners = new Set<CukoQueueListener>();

  /** 订阅队列变化（返回退订函数） */
  subscribe(listener: CukoQueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 某个会话的队列快照（副本，改它不影响队列） */
  get(sessionId: string): CukoQueueSnapshot {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    return {
      sessionId: sid,
      items: q ? q.items.map(copyItem) : [],
      steerItems: q ? q.steerItems.map(copyItem) : [],
      paused: q ? q.paused : false,
    };
  }

  /** 加入队列（默认普通排队） */
  enqueue(sessionId: string, text: string, options?: CukoEnqueueOptions): CukoQueueResult {
    const sid = String(sessionId || '');
    if (!sid) return { success: false, error: '缺少会话 ID' };
    const value = typeof text === 'string' ? text : '';
    if (!value.trim()) return { success: false, error: EMPTY_TEXT };
    const item: CukoQueueItem = {
      id: randomUUID(),
      text: value,
      windowId: typeof options?.windowId === 'number' ? options.windowId : null,
      createdAt: Date.now(),
    };
    const q = this.ensure(sid);
    if (options?.lane === 'steer') q.steerItems.push(item);
    else q.items.push(item);
    this.notify(sid);
    return { success: true, item: copyItem(item) };
  }

  /** 在通道之间移动，或在同一通道里调整顺序 */
  move(sessionId: string, itemId: string, placement?: CukoQueuePlacement): CukoQueueResult {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    const found = q ? this.find(q, itemId) : null;
    if (!q || !found) return { success: false, error: NOT_FOUND };
    const p = placement || {};
    const lane: CukoQueueLane = p.lane === 'steer' || p.lane === 'queue' ? p.lane : found.lane;
    this.laneOf(q, found.lane).splice(found.index, 1);
    const target = this.laneOf(q, lane);
    let index = target.length;
    if (typeof p.insertBefore === 'string') {
      const i = target.findIndex((x) => x.id === p.insertBefore);
      if (i >= 0) index = i;
    } else if (p.insertAfter === null) {
      index = 0;
    } else if (typeof p.insertAfter === 'string') {
      const i = target.findIndex((x) => x.id === p.insertAfter);
      if (i >= 0) index = i + 1;
    }
    target.splice(index, 0, found.item);
    this.notify(sid);
    return { success: true, item: copyItem(found.item) };
  }

  /** 修改文字（改成空内容会被拒绝，原文不变） */
  edit(sessionId: string, itemId: string, text: string): CukoQueueResult {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    const found = q ? this.find(q, itemId) : null;
    if (!q || !found) return { success: false, error: NOT_FOUND };
    const value = typeof text === 'string' ? text : '';
    if (!value.trim()) return { success: false, error: EMPTY_TEXT };
    found.item.text = value;
    this.notify(sid);
    return { success: true, item: copyItem(found.item) };
  }

  /** 删除一条 */
  remove(sessionId: string, itemId: string): CukoQueueResult {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    const found = q ? this.find(q, itemId) : null;
    if (!q || !found) return { success: false, error: NOT_FOUND };
    this.laneOf(q, found.lane).splice(found.index, 1);
    this.cleanup(sid, q);
    this.notify(sid);
    return { success: true, item: copyItem(found.item) };
  }

  /** 取出全部插话（取出即从队列删除；不受暂停影响） */
  takeSteer(sessionId: string): CukoQueueItem[] {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    if (!q || q.steerItems.length === 0) return [];
    const out = q.steerItems;
    q.steerItems = [];
    this.cleanup(sid, q);
    this.notify(sid);
    return out.map(copyItem);
  }

  /** 取出下一条普通排队；暂停或为空时返回 null（消息保留） */
  takeNext(sessionId: string): CukoQueueItem | null {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    if (!q || q.paused || q.items.length === 0) return null;
    const item = q.items.shift() as CukoQueueItem;
    this.cleanup(sid, q);
    this.notify(sid);
    return copyItem(item);
  }

  hasSteer(sessionId: string): boolean {
    const q = this.sessions.get(String(sessionId || ''));
    return !!q && q.steerItems.length > 0;
  }

  /** 暂停：普通排队不再自动发（消息保留）。队列为空时不记录 */
  pause(sessionId: string): void {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    if (!q || q.paused) return;
    q.paused = true;
    this.notify(sid);
  }

  isPaused(sessionId: string): boolean {
    const q = this.sessions.get(String(sessionId || ''));
    return !!q && q.paused;
  }

  /** 恢复：下次运行正常结束后继续自动发 */
  resume(sessionId: string): void {
    const sid = String(sessionId || '');
    const q = this.sessions.get(sid);
    if (!q || !q.paused) return;
    q.paused = false;
    this.notify(sid);
  }

  /** 清空某个会话的队列（删除会话时用） */
  clear(sessionId: string): void {
    const sid = String(sessionId || '');
    if (this.sessions.delete(sid)) this.notify(sid);
  }

  private ensure(sid: string): SessionQueue {
    let q = this.sessions.get(sid);
    if (!q) {
      q = { items: [], steerItems: [], paused: false };
      this.sessions.set(sid, q);
    }
    return q;
  }

  private laneOf(q: SessionQueue, lane: CukoQueueLane): CukoQueueItem[] {
    return lane === 'steer' ? q.steerItems : q.items;
  }

  private find(q: SessionQueue, itemId: string): FoundItem | null {
    const id = String(itemId || '');
    if (!id) return null;
    for (const lane of ['steer', 'queue'] as const) {
      const list = this.laneOf(q, lane);
      const index = list.findIndex((x) => x.id === id);
      if (index >= 0) return { lane, index, item: list[index] as CukoQueueItem };
    }
    return null;
  }

  /** 两条通道都空了就删掉会话条目（暂停标记随之失效） */
  private cleanup(sid: string, q: SessionQueue): void {
    if (q.items.length === 0 && q.steerItems.length === 0) this.sessions.delete(sid);
  }

  private notify(sid: string): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.get(sid);
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (err: any) {
        console.error('[Cuko] 队列订阅方出错:', err?.message || err);
      }
    }
  }
}

/** 主进程共用的队列实例 */
export const cukoQueue = new CukoQueueStore();

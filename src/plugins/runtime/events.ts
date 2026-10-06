/**
 * Cuckoo 插件系统 - 事件系统
 *
 * 实现 DSH（Cordis）的 5 种事件派发模式：
 *  - emit      : 同步广播，不收集返回值
 *  - parallel  : 所有监听器并发，一起等待
 *  - serial    : 按序运行，返回第一个"非空"返回值
 *  - bail      : serial 的同步版
 *  - waterfall : 环绕中间件，监听器收到 (value, next)，必须调 next()
 *
 * 设计原则：
 *  - 每个 context 持有自己的事件表（插件隔离）
 *  - on() 返回 disposer，卸载时撤销
 *  - 事件名规范：namespace/action（如 session/event、agent/assistant-stream）
 */
import type { EventListener } from './types.js';

/** 一个事件的监听器集合 */
interface ListenerEntry {
  listener: EventListener;
  once: boolean;
}

/**
 * 事件总线（每个插件上下文一个实例）
 */
class EventBus {
  private map = new Map<string, ListenerEntry[]>();

  /** 注册监听器，返回 disposer */
  on(event: string, listener: EventListener): () => void {
    return this.add(event, listener, false);
  }

  /** 注册一次性监听器 */
  once(event: string, listener: EventListener): () => void {
    return this.add(event, listener, true);
  }

  private add(event: string, listener: EventListener, once: boolean): () => void {
    if (!this.map.has(event)) this.map.set(event, []);
    const entry: ListenerEntry = { listener, once };
    this.map.get(event)!.push(entry);
    return () => this.removeEntry(event, entry);
  }

  /** 移除指定监听器 */
  off(event: string, listener: EventListener): void {
    const arr = this.map.get(event);
    if (!arr) return;
    const idx = arr.findIndex((e) => e.listener === listener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  /** 内部：移除条目（含 once 自动移除） */
  private removeEntry(event: string, entry: ListenerEntry): void {
    const arr = this.map.get(event);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) arr.splice(idx, 1);
  }

  /** 取某事件的监听器快照（执行期间注册的不影响本次） */
  private snapshot(event: string): ListenerEntry[] {
    return (this.map.get(event) || []).slice();
  }

  /** 取原始监听器函数列表（内部用） */
  listeners(event: string): EventListener[] {
    return (this.map.get(event) || []).map((e) => e.listener);
  }

  /** emit：同步广播，忽略返回值 */
  emit(event: string, ...args: any[]): void {
    const entries = this.snapshot(event);
    for (const entry of entries) {
      try {
        entry.listener(...args);
      } catch (err) {
        console.error('[plugin] 事件监听器出错 (' + event + '):', err);
      }
      if (entry.once) this.removeEntry(event, entry);
    }
  }

  /** parallel：所有监听器并发，一起等待 */
  async parallel(event: string, ...args: any[]): Promise<any[]> {
    const entries = this.snapshot(event);
    const results = await Promise.all(
      entries.map(async ({ listener }) => {
        try {
          return await listener(...args);
        } catch (err) {
          console.error('[plugin] parallel 监听器出错 (' + event + '):', err);
          return undefined;
        }
      })
    );
    for (const e of entries) if (e.once) this.removeEntry(event, e);
    return results;
  }

  /** serial：按序运行，返回第一个"非空"(!==undefined) 返回值 */
  async serial(event: string, ...args: any[]): Promise<any> {
    const entries = this.snapshot(event);
    for (const { listener } of entries) {
      try {
        const r = await listener(...args);
        if (r !== undefined) {
          for (const e of entries) if (e.once) this.removeEntry(event, e);
          return r;
        }
      } catch (err) {
        console.error('[plugin] serial 监听器出错 (' + event + '):', err);
      }
    }
    for (const e of entries) if (e.once) this.removeEntry(event, e);
    return undefined;
  }

  /** bail：serial 的同步版 */
  bail(event: string, ...args: any[]): any {
    const entries = this.snapshot(event);
    for (const { listener } of entries) {
      try {
        const r = listener(...args);
        if (r !== undefined) {
          for (const e of entries) if (e.once) this.removeEntry(event, e);
          return r;
        }
      } catch (err) {
        console.error('[plugin] bail 监听器出错 (' + event + '):', err);
      }
    }
    for (const e of entries) if (e.once) this.removeEntry(event, e);
    return undefined;
  }

  /**
   * waterfall：环绕中间件
   * 监听器签名 (value, next) => newValue
   * 每个监听器必须调 next(新值) 才能继续；不调则短路。
   */
  async waterfall(event: string, value: any, ...args: any[]): Promise<any> {
    const entries = this.snapshot(event);
    let current = value;
    let stopped = false;

    const chain = async (index: number): Promise<any> => {
      if (index >= entries.length || stopped) return current;
      const { listener } = entries[index];
      const next = async (nextValue?: any): Promise<any> => {
        if (nextValue !== undefined) current = nextValue;
        return chain(index + 1);
      };
      try {
        const r = await listener(current, next, ...args);
        // 若监听器直接返回了值（没调 next），视为短路
        if (r !== undefined && r !== current) return r;
        // 没调 next 也没返回 → 视为短路，返回当前
        return current;
      } catch (err) {
        console.error('[plugin] waterfall 监听器出错 (' + event + '):', err);
        return current;
      }
    };

    return chain(0);
  }

  /** 清空所有监听器（卸载时用） */
  clear(): void {
    this.map.clear();
  }
}

export { EventBus };
export type { ListenerEntry };

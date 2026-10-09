/**
 * 最小 DSH 运行时（C2）：内存会话事件流 + 会话投影注册表。
 *
 * 简化自 DSH 的 dsh-session / dsh-session-projection：
 *  - 内存事件流：append(type, data) → 存 + 驱动所有投影
 *  - 投影注册表：register({key,init,apply,view}) → get(key) 读视图
 *
 * 不做：落盘、checkpoint、watermark、change feed（DSH 的性能优化，Cuckoo 用不着）。
 */

/** 一条会话事件 */
interface SessionEvent {
  type: string;
  data: any;
}

/** 投影定义（简化自 DSH ProjectionDefinition） */
interface ProjectionDefinition {
  key: string;
  init?: (header?: any) => any;
  apply: (state: any, event: SessionEvent) => any;
  view?: (state: any) => any;
  stateVersion?: number;
}

/** 内存会话：事件流 + 投影驱动的载体 */
class MemorySession {
  readonly id: string;
  /** 事件流（append 追加） */
  readonly events: SessionEvent[] = [];
  private readonly registry: ProjectionRegistry;

  /** 可选持久化（C5）：落盘 + 启动重放 */
  private storage: { append(ev: SessionEvent): void; readAll(): SessionEvent[] } | null = null;

  constructor(id: string, registry: ProjectionRegistry) {
    this.id = id;
    this.registry = registry;
  }

  /** 接持久化（C5）：加载时读回历史事件重放；后续 append 同时落盘 */
  attachStorage(storage: { append(ev: SessionEvent): void; readAll(): SessionEvent[] }): void {
    this.storage = storage;
    // 读回历史事件 → 重放（驱动投影，重建状态）
    try {
      for (const ev of storage.readAll()) {
        if (ev && typeof ev.type === 'string') {
          this.events.push(ev);
          this.registry.drive(ev);
        }
      }
    } catch (_) { /* ignore */ }
  }

  /** 追加事件（对应 DSH 的 session.append） */
  append(type: string, data: any): void {
    const ev: SessionEvent = { type, data };
    this.events.push(ev);
    this.registry.drive(ev);
    // C5：落盘（若接了存储）
    if (this.storage) {
      try { this.storage.append(ev); } catch (_) { /* ignore */ }
    }
  }
}

/** 会话投影注册表（对应 DSH 的 ctx.sessionProjections） */
class ProjectionRegistry {
  private readonly defs = new Map<string, ProjectionDefinition>();
  private readonly states = new Map<string, any>();
  /** 历史事件（供"后注册的投影"fold 用——DSH 的 lazily build 机制） */
  private readonly history: SessionEvent[] = [];

  /** 注册一个投影（对应 DSH 的 register） */
  register(def: ProjectionDefinition): () => void {
    if (!def || typeof def.key !== 'string') throw new Error('projection: key 必须是字符串');
    this.defs.set(def.key, def);
    // 初始化状态
    let state = typeof def.init === 'function' ? def.init({}) : null;
    // DSH lazily build：投影后注册时，fold 已有历史事件
    for (const ev of this.history) {
      try { state = def.apply(state, ev); } catch (_) { /* ignore */ }
    }
    this.states.set(def.key, state);
    return () => { this.defs.delete(def.key); this.states.delete(def.key); };
  }

  /** 驱动所有投影（内部：事件到达时调用） */
  drive(event: SessionEvent): void {
    // 记录历史（供后注册投影 fold）
    this.history.push(event);
    for (const [key, def] of this.defs) {
      try {
        const prev = this.states.get(key);
        const next = def.apply(prev, event);
        this.states.set(key, next);
      } catch (err: any) {
        console.error('[DSH投影] ' + key + ' apply 失败:', err && err.message);
      }
    }
  }

  /** 读某投影的视图（对应 DSH 的 snapshot/read） */
  get(key: string): any {
    const def = this.defs.get(key);
    if (!def) return undefined;
    const state = this.states.get(key);
    return typeof def.view === 'function' ? def.view(state) : state;
  }

  /** 是否注册了某投影 */
  has(key: string): boolean {
    return this.defs.has(key);
  }
}

/** DSH 运行时（每个插件加载时创建一份） */
class DshRuntime {
  readonly session: MemorySession;
  readonly projections: ProjectionRegistry;

  constructor(sessionId?: string) {
    this.projections = new ProjectionRegistry();
    this.session = new MemorySession(sessionId || 'cuckoo-session', this.projections);
  }
}

export { DshRuntime, MemorySession, ProjectionRegistry };
export type { SessionEvent, ProjectionDefinition };

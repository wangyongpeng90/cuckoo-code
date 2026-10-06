/**
 * Cuckoo 插件系统 - 上下文对象（ctx）
 *
 * 把 Cuckoo 已有的能力包装成 DSH 风格的服务 + 事件：
 *   ctx.agents   ← chat-input / 会话
 *   ctx.tools    ← 工具注册表
 *   ctx.sessions ← 会话列表
 *   ctx.on('session/event', ...)         ← onInterceptedResponse
 *   ctx.on('agent/assistant-stream', ...) ← onStream（逐字流）
 *
 * 注意：本模块运行在 **渲染进程（overlay 层）**，通过传入的能力对象与宿主交互，
 * 不直接 import 上层模块（遵守 docs/arch 依赖铁律）。
 */
import { EventBus } from './events.js';
import { createThemeProxy } from './theme-proxy.js';
import type {
  PluginContext, AgentsService, AgentHandle, ToolsService, SessionsService, SettingsService,
  ServiceRegistry, PluginScope, PluginToolDefinition,
} from './types.js';

/** 宿主能力（由 bridge/entry 注入，避免本模块反向依赖上层） */
export interface HostCapabilities {
  /** 发消息到当前会话（对应 chat-input.sendToChat） */
  sendToChat(text: string): Promise<boolean>;
  /** 当前会话 id（可空） */
  getCurrentSessionId(): string | null;
  /** 当前项目目录 */
  getProjectDir(): string | null;
  /** 列出会话 */
  listSessions(): Array<{ id: string; title?: string }>;
  /** 列出工具名 */
  listTools(): string[];
  /** 注册插件工具到主进程（返回注销函数） */
  registerPluginTool?(pluginName: string, tool: PluginToolDefinition): () => void;
  /** 注册插件命令 */
  registerPluginCommand?(pluginName: string, cmd: { id: string; title: string; run: () => any }): () => void;
  /** 取 token 统计（上下文/对话/今日/窗口/系统总） */
  getTokenStats?(): { context: number; cumulative: number; today: number; windowCumulative: number; total: number };
  /** 读 localStorage 配置 */
  getSetting(key: string): any;
  setSetting(key: string, value: any): void;
  /** 日志前缀 */
  logPrefix?: string;
}

/** 取宿主 token 统计的某项（安全兜底 0） */
function num(host: HostCapabilities, key: string): number {
  try {
    const s = host.getTokenStats && host.getTokenStats();
    if (s && typeof (s as any)[key] === 'number') return (s as any)[key];
  } catch (_) { /* ignore */ }
  return 0;
}

/**
 * 创建一个 DSH 上下文的工厂
 */
function createContext(name: string, host: HostCapabilities, registry?: ServiceRegistry): PluginContext {
  const bus = new EventBus();
  const disposers: Array<() => void> = [];

  // ===== 服务：agents =====
  const makeAgent = (sid: string | null): AgentHandle => ({
    id: sid || 'current',
    status: 'idle',
    session: { id: sid, projectDir: host.getProjectDir() },
    async followup(msg): Promise<boolean> {
      if (!msg || typeof msg.content !== 'string') return false;
      return host.sendToChat(msg.content);
    },
    async send(msg): Promise<boolean> {
      if (!msg || typeof msg.content !== 'string') return false;
      return host.sendToChat(msg.content);
    },
  });
  const agents: AgentsService = {
    get(_sessionId?: string): AgentHandle | null {
      return makeAgent(host.getCurrentSessionId());
    },
    current(): AgentHandle | null {
      return makeAgent(host.getCurrentSessionId());
    },
    list() {
      return host.listSessions();
    },
  };

  // ===== 服务：tools =====
  const tools: ToolsService = {
    list: () => host.listTools(),
    register(tool: PluginToolDefinition): () => void {
      if (!tool || typeof tool.name !== 'string' || !tool.name) {
        throw new Error('工具必须有 name');
      }
      if (typeof tool.execute !== 'function') {
        throw new Error('工具必须有 execute 函数');
      }
      if (host.registerPluginTool) {
        return host.registerPluginTool(name, tool);
      }
      return () => {};
    },
  };

  // ===== 命令（ctx.command）=====
  const command: { register(cmd: { id: string; title: string; run: () => any }): () => void } = {
    register(cmd) {
      if (!cmd || typeof cmd.id !== 'string' || !cmd.id) throw new Error('命令必须有 id');
      if (typeof cmd.run !== 'function') throw new Error('命令必须有 run 函数');
      if (host.registerPluginCommand) {
        return host.registerPluginCommand(name, cmd);
      }
      return () => {};
    },
  };

  // ===== 服务：sessions =====
  const sessions: SessionsService = {
    current: () => ({ id: host.getCurrentSessionId(), projectDir: host.getProjectDir() }),
    list: () => host.listSessions(),
    get(id: string) {
      if (!id) return null;
      const all = host.listSessions();
      const found = all.find((s) => s.id === id);
      return found || null;
    },
  };

  // ===== 服务：settings =====
  const settings: SettingsService = {
    get: (key: string) => host.getSetting(key),
    set: (key: string, value: any) => host.setSetting(key, value),
  };

  const ctx: PluginContext = {
    name,
    log: (...args: any[]) => console.log('[' + (host.logPrefix || 'plugin') + ':' + name + ']', ...args),

    agents,
    tools,
    command,
    sessions,
    settings,

    // 本地 HTTP 服务（静态资源）
    webServer: {
      serve: (prefix: string, dir: string) => {
        try {
          const api = (window as any).electronAPI;
          if (api && typeof api.webServerServe === 'function') return api.webServerServe(name, prefix, dir);
        } catch (_) {}
        return Promise.resolve({ success: false, error: 'webServer 不可用' });
      },
      info: () => {
        try {
          const api = (window as any).electronAPI;
          if (api && typeof api.webServerInfo === 'function') return api.webServerInfo();
        } catch (_) {}
        return Promise.resolve({ success: false, error: 'webServer 不可用' });
      },
    },

    // token 统计（取宿主能力）
    tokens: {
      context: () => num(host, 'context'),
      cumulative: () => num(host, 'cumulative'),
      today: () => num(host, 'today'),
      windowCumulative: () => num(host, 'windowCumulative'),
      total: () => num(host, 'total'),
    },

    // 主题服务（IPC 代理到主进程权威，对标 DSH ctx.theme）
    theme: createThemeProxy(),

    on(event, listener) {
      const d = bus.on(event, listener);
      disposers.push(d);
      return d;
    },
    once(event, listener) {
      const d = bus.once(event, listener);
      disposers.push(d);
      return d;
    },
    off(event, listener) {
      bus.off(event, listener);
    },

    emit: (event, ...args) => bus.emit(event, ...args),
    parallel: (event, ...args) => bus.parallel(event, ...args),
    serial: (event, ...args) => bus.serial(event, ...args),
    bail: (event, ...args) => bus.bail(event, ...args),
    waterfall: (event, value, ...args) => bus.waterfall(event, value, ...args),

    // ===== 可逆副作用 =====
    effect(fn) {
      try {
        const cleanup = fn();
        if (typeof cleanup === 'function') {
          disposers.push(cleanup);
          return cleanup;
        }
      } catch (err) {
        console.error('[plugin] effect 执行出错 (' + name + '):', err);
      }
      return () => {};
    },

    // ===== 子作用域 =====
    scope() {
      const scopeDisposers: Array<() => void> = [];
      let disposed = false;
      const scope: PluginScope = {
        effect(fn) {
          if (disposed) return () => {};
          try {
            const cleanup = fn();
            if (typeof cleanup === 'function') {
              scopeDisposers.push(cleanup);
              return cleanup;
            }
          } catch (err) {
            console.error('[plugin] scope.effect 出错 (' + name + '):', err);
          }
          return () => {};
        },
        on(event, listener) {
          if (disposed) return () => {};
          const d = bus.on(event, listener);
          scopeDisposers.push(d);
          return d;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const d of scopeDisposers) {
            try { d(); } catch (_) { /* ignore */ }
          }
          scopeDisposers.length = 0;
        },
        get disposed() { return disposed; },
      };
      // 父 dispose 时，子作用域也一起销毁
      disposers.push(() => scope.dispose());
      return scope;
    },

    // ===== 服务提供 / 消费 =====
    provide(svcName, impl) {
      if (!registry) {
        // 无注册表时退化为本上下文私有
        (ctx as any).__local = (ctx as any).__local || {};
        (ctx as any).__local[svcName] = impl;
        const d = () => { delete (ctx as any).__local[svcName]; };
        disposers.push(d);
        return d;
      }
      const d = registry.provide(svcName, impl);
      // 卸载时自动注销服务
      disposers.push(d);
      return d;
    },
    get(svcName) {
      if (registry && registry.has(svcName)) return registry.get(svcName);
      const local = (ctx as any).__local;
      return local ? local[svcName] : undefined;
    },
    inject(names, callback) {
      if (!registry) { callback(); return () => {}; }
      const cleanups: Array<() => void> = [];
      let fired = false;
      for (const n of names) {
        cleanups.push(registry.onReady(n, () => {
          if (fired) return;
          fired = true;
          try { callback(); } catch (err) {
            console.error('[plugin] inject 回调出错 (' + name + '):', err);
          }
        }));
      }
      const d = () => { for (const c of cleanups) { try { c(); } catch (_) {} } };
      disposers.push(d);
      return d;
    },
  };

  // 暴露内部 bus 与清理器（供 loader 使用）
  (ctx as any).__bus = bus;
  (ctx as any).__disposers = disposers;
  (ctx as any).__dispose = () => {
    for (const d of disposers) {
      try { d(); } catch (_) { /* ignore */ }
    }
    disposers.length = 0;
    bus.clear();
  };

  return ctx;
}

export { createContext };


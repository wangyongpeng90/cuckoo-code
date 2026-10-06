/**
 * Cuckoo 插件系统 - 渲染进程接线（用 PluginHost 统一管理）
 *
 * 把 Cuckoo 运行时能力包装成宿主能力，拉取 dsh/ 和 ui/ 插件源码，
 * 交给 PluginHost 统一加载。
 *
 * 依赖方向：bridge 层，可依赖 overlay（发消息）。
 */
import { PluginHost } from '../plugins/runtime/index.js';
import type { HostCapabilities, CuckooEventSource, PendingPluginSource } from '../plugins/runtime/index.js';
import { bindCuckooEvents } from '../plugins/runtime/index.js';
import { sendToChat } from '../overlay/chat-input.js';
import { getProviderByUrl } from '../providers/registry.js';
import { onInterceptedResponse, onStream, onTaskIdle, onToolCall, onAiError } from './intercept/observer.js';

/** 写调试日志（console + 文件） */
function plog(msg: string): void {
  try { console.log(msg); } catch (_) {}
  try {
    const api = (window as any).electronAPI;
    if (api && typeof api.pluginDebugLog === 'function') api.pluginDebugLog(msg);
  } catch (_) {}
}

/** 读 token 统计（和 overlay/events.ts 同源：localStorage） */
function readTokenStats(): { context: number; cumulative: number; today: number; windowCumulative: number; total: number } {
  const out = { context: 0, cumulative: 0, today: 0, windowCumulative: 0, total: 0 };
  try {
    // 当前会话的 context/cumulative
    const sid = currentSessionId();
    const cacheRaw = localStorage.getItem('cuckoo-token-cache');
    let cache: any = {};
    try { cache = cacheRaw ? JSON.parse(cacheRaw) : {}; } catch (_) { cache = {}; }
    if (sid && cache[sid]) {
      const e = cache[sid];
      if (typeof e === 'number') { out.context = e; out.cumulative = e; }
      else if (e && typeof e === 'object') {
        out.context = typeof e.context === 'number' ? e.context : 0;
        out.cumulative = typeof e.cumulative === 'number' ? e.cumulative : 0;
      }
    }
    // 窗口累计 = 所有会话 cumulative 之和
    let win = 0;
    for (const k of Object.keys(cache)) {
      const e = cache[k];
      if (typeof e === 'number') win += e;
      else if (e && typeof e.cumulative === 'number') win += e.cumulative;
    }
    out.windowCumulative = win;
    // 今日 = cuckoo-token-daily 里今天
    const dailyRaw = localStorage.getItem('cuckoo-token-daily');
    try {
      const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
      const now = new Date();
      const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
      const key = y + '-' + m + '-' + d;
      if (typeof daily[key] === 'number') out.today = daily[key];
      else if (daily[key] && typeof daily[key].value === 'number') out.today = daily[key].value;
    } catch (_) {}
    // 系统总累计（主进程，异步——这里先用同步缓存兜底）
    const totRaw = localStorage.getItem('cuckoo-token-total');
    if (totRaw) { const v = Number(totRaw); if (Number.isFinite(v)) out.total = v; }
  } catch (_) {}
  return out;
}

/** 从当前 URL 提取会话 id */
function currentSessionId(): string | null {
  try {
    const provider = getProviderByUrl(window.location.href);
    if (provider && typeof provider.extractSessionId === 'function') {
      return provider.extractSessionId(window.location.href) || null;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** 宿主能力实现 */
function buildHost(): HostCapabilities {
  return {
    sendToChat: (text: string) => sendToChat(text, 'plugin', 300),
    getCurrentSessionId: () => currentSessionId(),
    getProjectDir: () => {
      try {
        const el = document.getElementById('cuckoo-project-dir');
        return el ? (el.textContent || '').trim() || null : null;
      } catch (_) {
        return null;
      }
    },
    listSessions: () => {
      try {
        const raw = localStorage.getItem('cuckoo-token-cache');
        if (!raw) return [];
        return Object.keys(JSON.parse(raw)).map((id) => ({ id }));
      } catch (_) {
        return [];
      }
    },
    listTools: () => ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'webFetch'],
    registerPluginTool: (pluginName: string, tool: any) => {
      return registerPluginTool(pluginName, tool);
    },
    registerPluginCommand: (pluginName: string, cmd: any) => {
      return registerPluginCommand(pluginName, cmd);
    },
    getTokenStats: () => readTokenStats(),
    getSetting: (key: string) => {
      try { const v = localStorage.getItem(key); return v === null ? undefined : v; } catch (_) { return undefined; }
    },
    setSetting: (key: string, value: any) => {
      try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) { /* ignore */ }
    },
    logPrefix: 'plugin',
  };
}

/** 已注册的插件工具（toolId → execute） */
const pluginTools = new Map<string, (args: any) => any>();
let toolListenerBound = false;

/** 已注册的插件命令（commandId → run 函数） */
const pluginCommands = new Map<string, () => any>();
let commandListenerBound = false;

/** 绑定"主进程触发插件命令"的监听（只绑一次） */
function bindCommandInvokeListener(): void {
  if (commandListenerBound) return;
  commandListenerBound = true;
  const api = (window as any).electronAPI;
  if (!api || typeof api.onCommandInvoke !== 'function') return;
  api.onCommandInvoke((payload: any) => {
    const { commandId, runId } = payload || {};
    const fn = pluginCommands.get(commandId);
    if (!fn) {
      api.commandResult(runId, { success: false, error: '命令未注册: ' + commandId });
      return;
    }
    Promise.resolve()
      .then(() => fn())
      .then((result) => api.commandResult(runId, { success: true, result }))
      .catch((err) => api.commandResult(runId, { success: false, error: err && err.message ? err.message : String(err) }));
  });
}

/** 绑定"主进程调用插件工具"的监听（只绑一次） */
function bindToolInvokeListener(): void {
  if (toolListenerBound) return;
  toolListenerBound = true;
  const api = (window as any).electronAPI;
  if (!api || typeof api.onPluginToolInvoke !== 'function') return;
  api.onPluginToolInvoke((payload: any) => {
    const { toolId, args, callId } = payload || {};
    const fn = pluginTools.get(toolId);
    if (!fn) {
      api.pluginToolResult(callId, { success: false, error: '工具未注册: ' + toolId });
      return;
    }
    Promise.resolve()
      .then(() => fn(args))
      .then((result) => api.pluginToolResult(callId, { success: true, result }))
      .catch((err) => api.pluginToolResult(callId, { success: false, error: err && err.message ? err.message : String(err) }));
  });
}

/**
 * 注册一个插件工具（渲染进程侧）：
 *   1. 生成 toolId，记下 execute
 *   2. 通知主进程注册（带 schema）
 *   3. 主进程调用时，通过 plugin-tool-invoke 回调执行
 */
function registerPluginTool(pluginName: string, tool: any): () => void {
  const api = (window as any).electronAPI;
  if (!api || typeof api.registerPluginTool !== 'function') {
    console.warn('[plugin] registerPluginTool 不可用，工具未注册: ' + tool.name);
    return () => {};
  }
  bindToolInvokeListener();
  const toolId = pluginName + '::' + tool.name;
  pluginTools.set(toolId, tool.execute);
  api.registerPluginTool({
    toolId,
    pluginName,
    name: tool.name,
    description: tool.description || '',
    parameters: tool.parameters || { type: 'object', properties: {} },
    jsApi: tool.jsApi || null,
  }).catch(() => {});
  return () => {
    pluginTools.delete(toolId);
    if (typeof api.unregisterPluginTool === 'function') {
      api.unregisterPluginTool(toolId).catch(() => {});
    }
  };
}

/**
 * 注册一个插件命令（渲染进程侧）：主进程触发时，通过 plugin-command-invoke 回调执行 run
 */
function registerPluginCommand(pluginName: string, cmd: any): () => void {
  const api = (window as any).electronAPI;
  if (!api || typeof api.commandRegister !== 'function') {
    console.warn('[plugin] commandRegister 不可用，命令未注册: ' + (cmd && cmd.id));
    return () => {};
  }
  bindCommandInvokeListener();
  const commandId = pluginName + '::' + (cmd.id || '');
  pluginCommands.set(commandId, cmd.run || (() => {}));
  api.commandRegister({ commandId, pluginName, title: cmd.title || cmd.id }).catch(() => {});
  return () => {
    pluginCommands.delete(commandId);
    if (typeof api.commandUnregister === 'function') {
      api.commandUnregister(commandId).catch(() => {});
    }
  };
}

/** 全局插件宿主（整个渲染进程一个） */
let host: PluginHost | null = null;
let eventBound = false;

/** 获取（或创建）插件宿主 */
export function getPluginHost(): PluginHost {
  if (!host) host = new PluginHost(buildHost());
  return host;
}

/** 拉取某类插件源码 */
async function fetchSources(kind: 'dsh' | 'ui'): Promise<PendingPluginSource[]> {
  const api = (window as any).electronAPI;
  const method = kind === 'dsh' ? 'getDshPluginSources' : 'getUiPluginSources';
  if (!api || typeof api[method] !== 'function') {
    plog('[plugin] electronAPI.' + method + ' 不可用');
    return [];
  }
  try {
    const res = await api[method]();
    if (!res || !res.success || !Array.isArray(res.plugins)) {
      plog('[plugin] ' + method + ' 返回异常: ' + JSON.stringify(res && res.error));
      return [];
    }
    return res.plugins.map((p: any) => ({ name: p.name, source: p.source, kind, config: p.config, pluginId: p.pluginId }));
  } catch (err: any) {
    console.error('[plugin] 拉取 ' + kind + ' 插件失败:', err && err.message ? err.message : err);
    return [];
  }
}

let initialized = false;

/** 初始化：加载所有 DSH/UI 插件 */
export async function initPlugins(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const h = getPluginHost();

  // 事件桥只绑一次
  if (!eventBound) {
    const src: CuckooEventSource = { onInterceptedResponse, onStream, onTaskIdle, onToolCall, onAiError };
    bindCuckooEvents(src);
    eventBound = true;
  }

  const dshSources = await fetchSources('dsh');
  const uiSources = await fetchSources('ui');
  const all = [...dshSources, ...uiSources];

  plog('[plugin] 拉到插件源码 ' + all.length + ' 个: ' + all.map((x) => x.kind + ':' + x.name).join(', '));

  if (all.length === 0) {
    plog('[plugin] 没有已启用的 DSH/UI 插件');
    return;
  }

  const result = h.loadAll(all);
  const stats = h.stats();
  plog('[plugin] 已加载: ' + (result.loaded.join(', ') || '(无)'));
  plog('[plugin] 统计: ' + JSON.stringify(stats));
  if (result.failed.length > 0) {
    plog('[plugin] 加载失败: ' + result.failed.map((f) => f.name + ': ' + f.error).join(' | '));
  }

  // 暴露到 window，供控制台调试 / UI 调用
  exposeHostApi(h);
}

/** 把插件宿主能力暴露到 window（开发者调试 + UI 集成） */
function exposeHostApi(h: PluginHost): void {
  try {
    (window as any).CuckooPlugins = {
      /** 列出已加载插件名 */
      list: () => h.list(),
      /** 按类型列出 */
      listByKind: (kind: 'dsh' | 'ui') => h.listByKind(kind),
      /** 统计 */
      stats: () => h.stats(),
      /** 取某插件的上下文 */
      context: (name: string) => h.getContext(name),
      /** 取加载失败记录 */
      failures: () => h.getFailures(),
      /** 卸载全部 */
      unloadAll: () => unloadAllPlugins(),
      /** 广播事件到所有插件 */
      broadcast: (event: string, ...args: any[]) => h.broadcast(event, ...args),
    };
  } catch (err) {
    console.error('[plugin] 暴露宿主 API 失败:', err);
  }
}

/** 卸载全部插件 */
export function unloadAllPlugins(): void {
  if (host) host.unloadAll();
}

/** 重载全部插件（先卸载，再重新拉取加载） */
export async function reloadPlugins(): Promise<void> {
  const h = getPluginHost();
  h.unloadAll();

  const dshSources = await fetchSources('dsh');
  const uiSources = await fetchSources('ui');
  const all = [...dshSources, ...uiSources];
  if (all.length === 0) {
    console.log('[plugin] 重载后无插件');
    return;
  }
  const result = h.loadAll(all);
  console.log('[plugin] 重载完成:', result.loaded.join(', ') || '(无)');
}

/** 绑定"插件重载"通知（主进程推送） */
export function bindPluginReload(): void {
  const api = (window as any).electronAPI;
  if (!api || typeof api.onPluginReloadNeeded !== 'function') return;
  api.onPluginReloadNeeded(() => {
    console.log('[plugin] 收到重载通知，重新加载插件');
    reloadPlugins().catch((err: any) => {
      console.error('[plugin] 重载失败:', err && err.message ? err.message : err);
    });
  });
}

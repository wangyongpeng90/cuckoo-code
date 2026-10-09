/**
 * Cuckoo 插件宿主能力：把 app 层的真能力（工具/设置/会话）包成 CuckooHost，
 * 注入给 DSH 兼容插件（plugins 层不能直接依赖 app/session，靠此桥接）。
 */
import * as windowState from './window.js';
import { registry } from '../tools/index.js';
import { getPluginConfig, setPluginConfig } from '../plugins/plugins-config.js';
import { scanSkills } from '../skills/index.js';
import { getPluginScanRoots } from '../plugins/roots.js';
import { listSnippets } from './snippets.js';
import { getTotal as getTokenTotal } from './token-stats.js';
import type { CuckooHost } from '../plugins/cuckoo-plugins/loader.js';

/** 取"当前会话"（优先最后一个活跃窗口） */
function currentSession(): { id: string | null; projectDir: string | null } {
  const ctxs = windowState.getAllContexts();
  const ctx = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
  const store = ctx ? ctx.sessionStore : null;
  return {
    id: (store && store.state && store.state.currentSessionId) || null,
    projectDir: (store && store.state && store.state.selectedProjectDir) || null,
  };
}

/** 所有会话（合并各窗口的 sessionStore） */
function allSessions(): Array<{ id: string; title?: string }> {
  const out: Array<{ id: string; title?: string }> = [];
  const seen = new Set<string>();
  for (const ctx of windowState.getAllContexts()) {
    const store = ctx && ctx.sessionStore;
    if (!store || typeof store.readSessionStore !== 'function') continue;
    try {
      const all = store.readSessionStore();
      for (const id of Object.keys(all || {})) {
        if (seen.has(id)) continue;
        seen.add(id);
        const meta = typeof store.getSessionMeta === 'function' ? store.getSessionMeta(id) : {};
        out.push({ id, title: (meta && meta.title) || undefined });
      }
    } catch (_) { /* ignore */ }
  }
  return out;
}

/** 构造 CuckooHost（供 DSH 插件 ctx 使用） */
function buildCuckooHost(): CuckooHost {
  return {
    getToolNames: () => (registry && typeof registry.listNames === 'function') ? registry.listNames() : [],
    getPluginConfig: (pluginId: string, defaults?: any) => getPluginConfig(pluginId, defaults),
    setPluginConfig: (pluginId: string, values: Record<string, any>) => setPluginConfig(pluginId, values),
    getCurrentSession: () => currentSession(),
    listSessions: () => allSessions(),
    getSession: (id: string) => {
      const found = allSessions().find((s) => s.id === id);
      return found || null;
    },
    // ===== C6 =====
    listSkills: () => {
      try {
        const dir = currentSession().projectDir;
        let extra: string[] = [];
        try { extra = getPluginScanRoots().skillDirs; } catch (_) { /* ignore */ }
        return scanSkills(dir, extra).map((s: any) => ({ name: s.name, description: s.description, source: s.source }));
      } catch (_) { return []; }
    },
    listCommands: () => {
      try { return listSnippets().map((s: any) => ({ id: s.name || s.id, title: s.name || s.id })); } catch (_) { return []; }
    },
    getSessionTitle: () => {
      const ctxs = windowState.getAllContexts();
      const ctx = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
      const store = ctx ? ctx.sessionStore : null;
      const sid = store ? store.state.currentSessionId : null;
      if (!sid || !store) return null;
      const meta = store.getSessionMeta(sid);
      return (meta && meta.title) || null;
    },
    setSessionTitle: (title: string) => {
      const ctxs = windowState.getAllContexts();
      const ctx = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
      const store = ctx ? ctx.sessionStore : null;
      const sid = store ? store.state.currentSessionId : null;
      if (!store || !sid) return false;
      try { store.updateSessionTitle(sid, title); return true; } catch (_) { return false; }
    },
    getTokens: () => ({
      context: 0, cumulative: 0, today: 0, windowCumulative: 0,
      total: (() => { try { return getTokenTotal(); } catch (_) { return 0; } })(),
    }),
  };
}

export { buildCuckooHost };

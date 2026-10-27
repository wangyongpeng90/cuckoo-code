/**
 * Cuckoo 插件宿主能力：把 app 层的真能力（工具/设置/会话）包成 CuckooHost，
 * 注入给 DSH 兼容插件（plugins 层不能直接依赖 app/session，靠此桥接）。
 */
import { createRequire } from 'node:module';
import * as windowState from './window.js';
import { registry } from '../tools/index.js';
import { getPluginConfig, setPluginConfig } from '../plugins/plugins-config.js';
import { scanSkills } from '../skills/index.js';
import { scanAgents } from '../agents/index.js';
import { getPluginScanRoots } from '../plugins/roots.js';
import { listSnippets } from './snippets.js';
import { getTotal as getTokenTotal } from './token-stats.js';
import type { CuckooHost } from '../plugins/cuckoo-plugins/loader.js';
import { registerPluginSlot, unregisterPluginSlot } from './ipc/plugin.js';
import { registerDynamicRoute } from './ipc/webserver.js';
import { readProfiles } from './profile.js';
import { getProvider } from '../providers/registry.js';
import { createLogicIdMap } from '../session/logic-id-map.js';
import type { WebId, LogicId } from '../session/ids.js';

// [022] ESM 模块里用 require 必须先 createRequire（全项目惯例，见 src/app/ipc/*）
// 漏了这行会导致 buildSystemPrompt 里的 require 抛 ReferenceError，
// 被 catch 静默吞掉 → 插件任务收到空系统提示词（真机验证发现）
const require = createRequire(import.meta.url);

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

/**
 * 所有窗口（从 profile-list.json 读，含"未打开"的窗口）。
 * ⚠️ 不要用 windowState.getAllContexts（只返回已打开的）。
 */
function listWindows(): Array<{ id: string; name: string; providerId: string }> {
  return readProfiles()
    .filter((p: any) => !p.isSubagent)  // 子代理不算独立窗口
    .map((p: any) => ({
      id: String(p.id || ''),
      name: String(p.name || p.id || ''),
      providerId: String(p.providerId || ''),
    }));
}

/**
 * 当前窗口（优先"最后活跃且已打开"的窗口；无则回退 profile-list 第一个）。
 */
function getCurrentWindow(): { id: string; name: string; providerId: string } | null {
  // 1) 优先：已打开的窗口（最后一个）
  const ctxs = windowState.getAllContexts().filter((c: any) => !c.isSubagent);
  const c = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
  if (c) {
    const p = readProfiles().find((x: any) => x.id === c.profileId);
    return { id: String(c.profileId || ''), name: (p && p.name) || String(c.profileId || ''), providerId: String(c.providerId || '') };
  }
  // 2) 回退：profile-list 第一个
  const all = readProfiles().filter((p: any) => !p.isSubagent);
  if (!all.length) return null;
  const p = all[0];
  return { id: String(p.id || ''), name: String(p.name || p.id || ''), providerId: String(p.providerId || '') };
}

/** 所有会话（合并各窗口的 sessionStore；带 projectDir，供 workspaceRegistry 用） */
function allSessions(): Array<{ id: string; title?: string; projectDir?: string | null }> {
  const out: Array<{ id: string; title?: string; projectDir?: string | null }> = [];
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
        out.push({ id, title: (meta && meta.title) || undefined, projectDir: (meta && meta.projectDir) ?? null });
      }
    } catch (_) { /* ignore */ }
  }
  return out;
}

/** 构造 CuckooHost（供 DSH 插件 ctx 使用） */
function buildCuckooHost(opts?: { db?: any; logicIdMap?: any; createWindow?: any; profileManager?: any }): CuckooHost {
  const logicIdMap = opts?.logicIdMap || null;
  return {
    logicIdMap: logicIdMap ? {
      webIdOf: (logicId: LogicId) => logicIdMap.webIdOf(logicId),
      logicIdOf: (webId: WebId) => logicIdMap.logicIdOf(webId),
      bind: (logicId: LogicId, webId: WebId) => logicIdMap.bind(logicId, webId),
      ensureLogicId: (webId: WebId) => logicIdMap.ensureLogicId(webId),
      has: (logicId: LogicId) => logicIdMap.has(logicId),
    } : undefined,
    
    getToolNames: () => (registry && typeof registry.listNames === 'function') ? registry.listNames() : [],
    getPluginConfig: (pluginId: string, defaults?: any) => getPluginConfig(pluginId, defaults),
    setPluginConfig: (pluginId: string, values: Record<string, any>) => setPluginConfig(pluginId, values),
    getCurrentSession: () => currentSession(),
    listSessions: () => allSessions(),
    listWindows: () => listWindows(),
    getCurrentWindow: () => getCurrentWindow(),
    // [022] 决策 9.5：db 注入给插件层，供 workspace-registry 使用
    // [022] 决策 C：删除旧的 attachSessionToWorkspace——入口唯一（Workspace.attachSession）
    db: opts?.db,
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
    // ===== C7 =====
    listSubagents: () => {
      try {
        const dir = currentSession().projectDir;
        return scanAgents(dir).map((a: any) => ({ name: a.name, description: a.description }));
      } catch (_) { return []; }
    },
    runSubagent: async (name: string, task: string) => {
      const tool = registry.get('runAgent');
      if (!tool) throw new Error('runAgent 工具不可用');
      const ctxs = windowState.getAllContexts();
      const ctx = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
      const windowId = ctx && ctx.win && !ctx.win.isDestroyed() ? ctx.win.id : null;
      const res: any = await tool.execute({ name, task, currentWindowId: windowId, projectDir: currentSession().projectDir });
      return res && res.success !== false ? (res.data ?? res.output ?? '') : (res && res.error) || '子代理执行失败';
    },
    runCommand: async (command: string, opts?: any) => {
      const isWin = process.platform === 'win32';
      const tool = registry.get(isWin ? 'bash' : 'bash'); // 统一走 bash（win 下即 cmd）
      if (!tool) return { stdout: '', stderr: '命令工具不可用', exitCode: 1 };
      const res: any = await tool.execute({ command, workdir: opts && opts.cwd, timeoutMs: opts && opts.timeoutMs });
      const out = (res && (res.data ?? res.output)) || '';
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      const exitCode = /\[exit code: (\d+)\]/.exec(text) ? Number(RegExp.$1) : (res && res.success === false ? 1 : 0);
      return { stdout: text, exitCode };
    },
    querySession: (id: string) => {
      for (const ctx of windowState.getAllContexts()) {
        const store = ctx && ctx.sessionStore;
        if (!store) continue;
        try {
          const meta = store.getSessionMeta(id as any);
          if (meta) return { id, title: meta.title, projectDir: meta.projectDir ?? null };
        } catch (_) { /* ignore */ }
      }
      return null;
    },
    // ===== DSH agents.create 用 =====
    navigateWindowToHome: async (logicId: string, profileId: string | null, providerId: string | null): Promise<boolean> => {
      // 按 profileId 找窗口（dsh-tasks 的 model = profileId）
      let ctx: any = null;
      if (profileId) {
        ctx = windowState.getWindowByProfileId(profileId);
      }
      if (!ctx && profileId && opts?.createWindow && opts?.profileManager) {
        // 窗口未打开 → 主动拉起新窗口
        const prof = opts.profileManager.getProfileById(profileId);
        if (prof) {
          const wid = opts.createWindow(prof);
          ctx = windowState.getWindowContext(wid);
          console.log('[Cuckoo Host] 插件指定窗口未打开，已主动拉起: ' + profileId);
        }
      }
      if (!ctx || !ctx.view || ctx.view.webContents.isDestroyed()) return false;
      const pid = providerId || ctx.providerId;
      const provider = pid ? getProvider(pid) : null;
      const homeUrl = provider && provider.homeUrl ? provider.homeUrl : null;
      if (!homeUrl) return false;
      
      const wc = ctx.view.webContents;
      let targetUrl = homeUrl;
      
      // 给插件场景生成带 logicId 的 URL
      if (logicId && logicId !== 'undefined') {
        try {
          const u = new URL(homeUrl);
          u.searchParams.set('cuckoo_logic_id', logicId);
          targetUrl = u.toString();
        } catch (_) {
          targetUrl = homeUrl + (homeUrl.includes('?') ? '&' : '?') + 'cuckoo_logic_id=' + encodeURIComponent(logicId);
        }
      }

      // 如果已经是目标 URL，直接返回
      try {
        const cur = wc.getURL();
        if (cur === targetUrl) return true;
      } catch (_) { /* ignore */ }

      // 导航 + 等 did-finish-load + 等 2 秒（bridge 就绪）
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          try { wc.off('did-finish-load', onLoad); } catch (_) { /* ignore */ }
          resolve(ok);
        };
        const onLoad = () => {
          setTimeout(() => done(true), 2000);
        };
        wc.once('did-finish-load', onLoad);
        wc.loadURL(targetUrl).catch(() => done(false));
        setTimeout(() => done(false), 15000);  // 15 秒兜底
      });
    },
    buildSystemPrompt: (projectDir: string, providerId: string): string => {
      try {
        // 动态导入 buildPrompt（避免循环依赖）
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../session/prompt-builder.js');
        // 若调用方没给 providerId，从"当前窗口"补
        let pid = providerId;
        if (!pid) {
          const ctxs = windowState.getAllContexts();
          const cur = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
          pid = (cur && cur.providerId) || '';
        }
        const built = mod.buildPrompt({ providerId: pid, selectedDir: projectDir });
        if (built && built.error) {
          console.error('[Cuckoo Host] buildSystemPrompt 返回错误:', built.error, '| providerId=' + pid + ', projectDir=' + projectDir);
          return '';
        }
        return built ? built.prompt : '';
      } catch (e: any) {
        // [022] 不静默吞错——系统提示词丢失会让 AI 完全不知道项目上下文，极难排查
        console.error('[Cuckoo Host] buildSystemPrompt 抛错:', e && e.message ? e.message : String(e));
        return '';
      }
    },
    sendUserMessage: (logicId: string, profileId: string | null, text: string): boolean => {
      let ctx: any = null;
      if (profileId) {
        ctx = windowState.getWindowByProfileId(profileId);
      }
      if (!ctx && profileId && opts?.createWindow && opts?.profileManager) {
        const prof = opts.profileManager.getProfileById(profileId);
        if (prof) {
          const wid = opts.createWindow(prof);
          ctx = windowState.getWindowContext(wid);
          console.log('[Cuckoo Host] 发送消息时窗口未打开，已主动拉起: ' + profileId);
        }
      }
      if (!ctx || !ctx.view || ctx.view.webContents.isDestroyed()) return false;
      try {
        ctx.view.webContents.send('harness-user-message', { text });
        return true;
      } catch (_) { return false; }
    },
    getSessionQueue: (logicId: string): any[] => {
      for (const ctx of windowState.getAllContexts()) {
        const store = ctx && ctx.sessionStore;
        if (!store) continue;
        try {
          const all = store.readSessionStore();
          const meta = all && all[logicId];
          if (meta && Array.isArray(meta.pendingMessages)) return meta.pendingMessages;
        } catch (_) { /* ignore */ }
      }
      return [];
    },
    setSessionQueue: (logicId: string, queue: any[]): void => {
      for (const ctx of windowState.getAllContexts()) {
        const store = ctx && ctx.sessionStore;
        if (!store) continue;
        try {
          const all = store.readSessionStore();
          const meta = all && all[logicId];
          if (meta) {
            if (typeof meta === 'string') {
              all[logicId] = { projectDir: meta, title: null, createdAt: null, updatedAt: null, pendingMessages: queue };
            } else {
              meta.pendingMessages = queue;
              all[logicId] = meta;
            }
            store.writeSessionStore(all);
            return;
          }
        } catch (_) { /* ignore */ }
      }
    },
    // [022] 直接写 host.db，不再经过"扫窗口找 store"——后者会用到错误的 profile_id
    // 背景：dsh-tasks 通过 agentOptions.model 指定窗口（profileId），
    //       旧实现"扫所有窗口找 logicId"找不到就用"最后一个窗口"，导致会话写进错误账号。
    // 决策：profileId 由调用方明确传入；INSERT 时用它，UPDATE 时不影响（按 logic_id 定位）。
    // 详见 docs/dsh-compat-decisions.md 9.1 + 真机验证发现（会话写到了 vs*****fr 而不是 ck*****48）。
    saveSessionDirMapping: (logicId: string, projectDir: string, profileId?: string | null): boolean => {
      if (!logicId) return false;
      const db = opts?.db;
      if (!db) {
        console.error('[Cuckoo Host] saveSessionDirMapping 失败：host.db 未注入');
        return false;
      }
      try {
        const now = new Date().toISOString();
        const exist = db.prepare('SELECT logic_id FROM sessions WHERE logic_id = ?').get(logicId) as any;
        if (exist) {
          db.prepare('UPDATE sessions SET project_dir = ?, updated_at = ? WHERE logic_id = ?')
            .run(projectDir, now, logicId);
        } else {
          db.prepare('INSERT INTO sessions (logic_id, profile_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(logicId, profileId || null, projectDir, now, now);
        }
        return true;
      } catch (e: any) {
        console.error('[Cuckoo Host] saveSessionDirMapping 失败:', e && e.message ? e.message : String(e));
        return false;
      }
    },
    broadcastTurnEnd: (logicId: string, reason: 'completed' | 'error' | 'max-tokens' | 'aborted'): void => {
      // 构造 session 对象（dsh-tasks 用 session.id 匹配 trackedRuns）
      const session = {
        id: logicId,
        // DSH Session 的简化视图（dsh-tasks 只用 id）
      };
      const event = { type: 'turn/end', data: { reason } };
      // 动态 import event-bridge（避免循环依赖）
      import('../plugins/cuckoo-plugins/event-bridge.js')
        .then((m: any) => {
          try { m.broadcastDshEvent('session/event', session, event); } catch (_) { /* ignore */ }
        })
        .catch(() => { /* ignore */ });
    },
    setSessionTitleForId: (logicId: string, title: string): void => {
      for (const ctx of windowState.getAllContexts()) {
        const store = ctx && ctx.sessionStore;
        if (!store) continue;
        try {
          const all = store.readSessionStore();
          if (all && all[logicId] !== undefined) {
            store.updateSessionTitle(logicId as any, title);
            return;
          }
        } catch (_) { /* ignore */ }
      }
      // 如果没有找到（说明是刚创建还没落盘的极端情况），直接用当前窗口 store 写
      const ctxs = windowState.getAllContexts();
      const cur = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
      const store = cur && cur.sessionStore;
      if (store) store.updateSessionTitle(logicId as any, title);
    },
    // ===== C8 =====
    mcpCall: async (server: string, tool: string, args?: any) => {
      const t = registry.get('mcpCall');
      if (!t) return '';
      const res: any = await t.execute({ server, tool, args: args || {} });
      return res && res.success !== false ? (res.data ?? res.output ?? '') : (res && res.error) || '';
    },
    mcpListServers: async () => {
      const t = registry.get('mcpListServers');
      if (!t) return '';
      const res: any = await t.execute({});
      return res && res.success !== false ? (res.data ?? res.output ?? '') : '';
    },
    mcpGetTools: async (server: string) => {
      const t = registry.get('mcpGetTools');
      if (!t) return '';
      const res: any = await t.execute({ serverName: server });
      return res && res.success !== false ? (res.data ?? res.output ?? '') : '';
    },
    webFetch: async (url: string) => {
      const t = registry.get('webFetch');
      if (!t) return '';
      const res: any = await t.execute({ url });
      return res && res.success !== false ? (res.data ?? res.output ?? '') : (res && res.error) || '';
    },
    openBrowserWindow: async (url: string, opts?: any) => {
      const t = registry.get('openBrowserWindow');
      if (!t) return null;
      const res: any = await t.execute({ url, ...(opts || {}) });
      return res && res.success !== false ? (res.data ?? res.output ?? null) : null;
    },
    injectJS: async (windowId: string, code: string) => {
      const t = registry.get('injectJS');
      if (!t) return null;
      const res: any = await t.execute({ windowId, code });
      return res && res.success !== false ? (res.data ?? res.output ?? null) : null;
    },
    attachFile: async (filePath: string) => {
      const t = registry.get('attachFile');
      if (!t) return null;
      const ctxs = windowState.getAllContexts();
      const ctx = ctxs.length > 0 ? ctxs[ctxs.length - 1] : null;
      const currentWindowId = ctx && ctx.win && !ctx.win.isDestroyed() ? ctx.win.id : null;
      const res: any = await t.execute({ filePath, currentWindowId, projectDir: currentSession().projectDir });
      return res && res.success !== false ? (res.data ?? res.output ?? null) : null;
    },
    runTerminal: async (command: string, opts?: any) => {
      const t = registry.get('bash');
      if (!t) return { stdout: '', exitCode: 1 };
      const res: any = await t.execute({ command, workdir: opts && opts.cwd, timeoutMs: opts && opts.timeoutMs });
      const out = (res && (res.data ?? res.output)) || '';
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      const exitCode = /\[exit code: (\d+)\]/.exec(text) ? Number(RegExp.$1) : (res && res.success === false ? 1 : 0);
      return { stdout: text, exitCode };
    },
    // ===== 宿主服务：webServer =====
    registerHttpRoute: (s: { pluginId: string; kind?: string; path: string; handler: (req: any, res: any) => any }) => {
      try { return registerDynamicRoute(s.pluginId, { kind: s.kind, path: s.path, handler: s.handler }); }
      catch (e: any) { console.error('[Cuckoo Host] registerHttpRoute 失败:', s.pluginId, s.path, e); return () => {}; }
    },
    // ===== UI 槽位（对标 DSH slots）=====
    registerSlot: (s: { pluginId: string; slot: string; id: string; order?: number; spec?: any }) => {
      const pluginId = (s && s.pluginId) ? String(s.pluginId) : 'plugin';
      registerPluginSlot({ pluginId, slot: s.slot, id: s.id, order: s.order, spec: s.spec });
      return () => { try { unregisterPluginSlot(pluginId, s.slot, s.id); } catch (_) { /* ignore */ } };
    },
  };
}

export { buildCuckooHost };

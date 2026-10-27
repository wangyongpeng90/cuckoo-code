/**
 * 会话-目录映射持久化存储 + URL 会话检测（每 profile 独立实例）
 * 已全部迁移到 SQLite。
 */
import { getProviderByUrl } from '../providers/registry.js';
import type { WebId, LogicId } from './ids.js';
import type { DatabaseSync } from 'node:sqlite';

interface SessionStoreApi {
  readSessionStore(): any;
  writeSessionStore(store: any): void;
  getSessionMeta(logicId: LogicId): any;
  getProjectDirBySessionId(logicId: LogicId): any;
  saveSessionDirMapping(logicId: LogicId, projectDir: any): void;
  updateSessionTitle(logicId: LogicId, title: string): void;
  setSessionTitle(title: string): any;
  setSessionLineage(logicId: LogicId, lineage: { parentId?: string | null; kind?: string | null; agentName?: string | null }): void;
  supersedeSession(logicId: LogicId): void;
  setSessionArchived(logicId: LogicId, archived: boolean): void;
  getArchivedProjects(): string[];
  setProjectArchived(dir: string, archived: boolean): void;
  extractSessionIdFromUrl(url: string): WebId | null;
  handleUrlChange(url: string, targetView?: any): void;
  tryRestoreSessionFromUrl(targetView?: any): void;
  state: any;
}

/**
 * 创建 profile 专属的 session store 实例
 */
function createSessionStore(profileId: string, db: DatabaseSync, windowState: any, opts: { noPersist?: boolean, logicIdMap?: any } = {}): SessionStoreApi {
  const noPersist = opts && opts.noPersist === true;
  let memStore: any = {};

  // ===== 兼容老接口（留给还没迁移完的地方用） =====
  function readSessionStore(): any {
    if (noPersist) return memStore;
    // 从数据库里读出所有记录，构造一个对象返回（尽可能兼容）
    const out: any = {};
    try {
      const rows = db.prepare('SELECT * FROM sessions WHERE profile_id = ?').all(profileId) as any[];
      for (const r of rows) {
        if (r.kind === 'project_archive') continue; // 归档项目不参与会话列表
        out[r.logic_id] = {
          projectDir: r.project_dir,
          title: r.title,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          archived: r.archived === 1,
          superseded: r.superseded === 1,
          parentId: r.parent_id,
          kind: r.kind,
          agentName: r.agent_name,
          pendingMessages: r.pending_messages ? JSON.parse(r.pending_messages) : undefined,
        };
      }
    } catch (_) {}
    return out;
  }

  function writeSessionStore(store: any): void {
    if (noPersist) { memStore = store; return; }
    // 不做全量覆盖了，这个是历史遗留方法，正常情况下不会调
  }

  // ===== 核心 SQL 方法 =====

  function getSessionMeta(logicId: LogicId): any {
    if (!logicId) return null;
    if (noPersist) return memStore[logicId] || null;
    const r = db.prepare('SELECT * FROM sessions WHERE logic_id = ?').get(logicId) as any;
    if (!r) return null;
    return {
      logicId: r.logic_id,
      webId: r.web_id,
      projectDir: r.project_dir || null,
      title: r.title || null,
      createdAt: r.created_at || null,
      updatedAt: r.updated_at || null,
      archived: r.archived === 1,
      parentId: r.parent_id || null,
      kind: r.kind || null,
      agentName: r.agent_name || null,
      superseded: r.superseded === 1,
      pendingMessages: r.pending_messages ? JSON.parse(r.pending_messages) : undefined,
    };
  }

  function getProjectDirBySessionId(logicId: LogicId): any {
    const meta = getSessionMeta(logicId);
    return meta ? meta.projectDir : null;
  }

  function saveSessionDirMapping(logicId: LogicId, projectDir: any): void {
    if (!logicId) return;
    if (noPersist) {
      if (!memStore[logicId]) memStore[logicId] = { createdAt: new Date().toISOString() };
      memStore[logicId].projectDir = projectDir;
      return;
    }
    
    const now = new Date().toISOString();
    const exist = db.prepare('SELECT logic_id FROM sessions WHERE logic_id = ?').get(logicId);
    if (exist) {
      db.prepare('UPDATE sessions SET project_dir = ?, updated_at = ? WHERE logic_id = ?').run(projectDir, now, logicId);
    } else {
      db.prepare(`INSERT INTO sessions (logic_id, profile_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(logicId, profileId, projectDir, now, now);
    }
  }

  /** 取已归档的项目目录列表 */
  function getArchivedProjects(): string[] {
    if (noPersist) return [];
    try {
      const rows = db.prepare("SELECT project_dir FROM sessions WHERE profile_id = ? AND kind = 'project_archive' AND archived = 1").all(profileId) as any[];
      return rows.map(r => r.project_dir).filter(Boolean) as string[];
    } catch (_) { return []; }
  }

  /** 归档/取消归档项目 */
  function setProjectArchived(dir: string, archived: boolean): void {
    if (!dir || noPersist) return;
    const now = new Date().toISOString();
    if (archived) {
      const exist = db.prepare("SELECT logic_id FROM sessions WHERE profile_id = ? AND kind = 'project_archive' AND project_dir = ?").get(profileId, dir);
      if (!exist) {
        db.prepare(`INSERT INTO sessions (logic_id, profile_id, project_dir, kind, archived, created_at, updated_at) VALUES (?, ?, ?, 'project_archive', 1, ?, ?)`)
          .run('project_archive_' + dir, profileId, dir, now, now);
      } else {
        db.prepare("UPDATE sessions SET archived = 1 WHERE profile_id = ? AND kind = 'project_archive' AND project_dir = ?").run(profileId, dir);
      }
    } else {
      db.prepare("UPDATE sessions SET archived = 0 WHERE profile_id = ? AND kind = 'project_archive' AND project_dir = ?").run(profileId, dir);
    }
  }

  /** 归档/取消归档会话 */
  function setSessionArchived(logicId: LogicId, archived: boolean): void {
    if (!logicId || noPersist) return;
    const now = new Date().toISOString();
    db.prepare('UPDATE sessions SET archived = ?, updated_at = ? WHERE logic_id = ?').run(archived ? 1 : 0, now, logicId);
  }

  /** 更新会话标题 */
  function updateSessionTitle(logicId: LogicId, title: string): void {
    if (!logicId || !title) return;
    if (noPersist) {
      if (!memStore[logicId]) memStore[logicId] = { createdAt: new Date().toISOString() };
      memStore[logicId].title = title;
      return;
    }
    
    const now = new Date().toISOString();
    const exist = db.prepare('SELECT logic_id FROM sessions WHERE logic_id = ?').get(logicId);
    if (exist) {
      db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE logic_id = ?').run(title, now, logicId);
    } else {
      db.prepare(`INSERT INTO sessions (logic_id, profile_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(logicId, profileId, title, now, now);
    }
  }

  /** 设置当前会话标题 */
  function setSessionTitle(title: string): any {
    const t = String(title || '').trim();
    if (!t) return { success: false, error: '标题为空' };
    if (state.currentSessionId) {
      updateSessionTitle(state.currentSessionId, t);
      return { success: true };
    }
    return { success: false, error: '无会话ID' };
  }

  /** 设置会话血缘 */
  function setSessionLineage(logicId: LogicId, lineage: { parentId?: string | null; kind?: string | null; agentName?: string | null }): void {
    if (!logicId || noPersist) return;
    const now = new Date().toISOString();
    const exist = db.prepare('SELECT logic_id FROM sessions WHERE logic_id = ?').get(logicId);
    
    // 动态组装 UPDATE 或者 INSERT（因为可能只传部分字段）
    if (exist) {
      const sets: string[] = [];
      const vals: any[] = [];
      if (lineage.parentId !== undefined) { sets.push('parent_id = ?'); vals.push(lineage.parentId); }
      if (lineage.kind !== undefined) { sets.push('kind = ?'); vals.push(lineage.kind); }
      if (lineage.agentName !== undefined) { sets.push('agent_name = ?'); vals.push(lineage.agentName); }
      if (sets.length > 0) {
        sets.push('updated_at = ?'); vals.push(now);
        vals.push(logicId);
        db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE logic_id = ?`).run(...vals);
      }
    } else {
      db.prepare(`INSERT INTO sessions (logic_id, profile_id, parent_id, kind, agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(logicId, profileId, lineage.parentId || null, lineage.kind || null, lineage.agentName || null, now, now);
    }

    // 压缩：旧版（父）标记"被取代"
    if (lineage.kind === 'compaction' && lineage.parentId) {
      db.prepare('UPDATE sessions SET superseded = 1 WHERE logic_id = ?').run(lineage.parentId);
    }
    console.log('[Cuckoo Code][' + profileId + '] 已记血缘: ' + logicId + ' <- ' + (lineage.parentId || '?') + ' (' + (lineage.kind || '?') + ')');
  }

  /** 标记会话"已被取代" */
  function supersedeSession(logicId: LogicId): void {
    if (!logicId || noPersist) return;
    db.prepare('UPDATE sessions SET superseded = 1 WHERE logic_id = ?').run(logicId);
    console.log('[Cuckoo Code][' + profileId + '] 已标记旧版(被取代): ' + logicId);
  }

  function extractSessionIdFromUrl(url: string): WebId | null {
    if (!url) return null;
    try {
      const provider = getProviderByUrl(url);
      if (provider && typeof provider.extractSessionId === 'function') {
        return provider.extractSessionId(url);
      }
    } catch (_) { /* provider 异常时返回 null */ }
    return null;
  }

  const state: any = {
    currentSessionId: null,
    selectedProjectDir: null,
    pendingProjectDir: null,
    pendingLineage: null,
    initialPromptSent: false,
  };

  function resolveView(targetView?: any): any {
    if (targetView) return targetView;
    const ctx = windowState && windowState.getMainContext ? windowState.getMainContext() : null;
    return ctx ? ctx.view : null;
  }

  function emitProjectDir(wc: any, dir: string | null): void {
    if (!wc || wc.isDestroyed()) return;
    wc.send('project-dir-updated', dir);
    try {
      const ctx = windowState && windowState.getContextByWebContents ? windowState.getContextByWebContents(wc) : null;
      if (ctx && ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('shell-project-dir', dir);
      }
    } catch (_) { /* ignore */ }
  }

  function handleUrlChange(url: string, targetView?: any): void {
    const webId = extractSessionIdFromUrl(url);
    console.log('[Cuckoo Store] handleUrlChange 触发! url=' + url + ', webId=' + webId);
    const view = resolveView(targetView);
    const wc = view && view.webContents ? view.webContents : null;
    const canSend = wc && !wc.isDestroyed();

    if (webId) {
      let logicId: LogicId;
      
      if (opts && opts.logicIdMap) {
        // 1. 先查数据库，这个 webId 是不是已经有主了？
        const existInDb = opts.logicIdMap.logicIdOf(webId);
        
        if (existInDb) {
          // 有主了，说明用户点开了历史对话！直接用它的 logicId，绝不覆盖
          logicId = existInDb;
        } else {
          // 无主，说明是当前新对话正在产生第一条消息
          if (state.currentSessionId && (state.currentSessionId.startsWith('local-') || state.currentSessionId.startsWith('session-'))) {
            // 内存有 logicId（新建时的 local-xxx 或插件给的），绑给它
            logicId = state.currentSessionId as LogicId;
            try { opts.logicIdMap.bind(logicId, webId, profileId); } catch (_) { /* ignore */ }
          } else {
            // 内存没有（比如直接刷新了），走老数据兜底
            logicId = opts.logicIdMap.ensureLogicId(webId, profileId);
          }
        }
      } else {
        logicId = webId as unknown as LogicId;
      }
      
      state.currentSessionId = logicId;
      console.log('[Cuckoo Code][' + profileId + '] 当前会话ID(逻辑): ' + logicId);

      // 处理新窗口暂存的项目目录
      if (state.pendingProjectDir) {
        saveSessionDirMapping(logicId!, state.pendingProjectDir);
        state.selectedProjectDir = state.pendingProjectDir;
        state.pendingProjectDir = null;
        if (canSend) {
          emitProjectDir(wc, state.selectedProjectDir);
          wc.send('session-restored', { sessionId: logicId, projectDir: state.selectedProjectDir });
        }
        console.log('[Cuckoo Code] 暂存目录已成功绑定到数据库:', logicId);
        
        // 通知壳页面刷新侧边栏工作区
        const ctx = windowState && windowState.getContextByWebContents ? windowState.getContextByWebContents(wc) : null;
        if (ctx && ctx.win && !ctx.win.isDestroyed()) {
          ctx.win.webContents.send('shell-sessions-changed');
        }
      }

      // 绑定暂存的血缘
      if (state.pendingLineage) {
        setSessionLineage(logicId!, state.pendingLineage);
        state.pendingLineage = null;
      }
      
      const restoredDir = getProjectDirBySessionId(logicId!);
      if (restoredDir) {
        state.selectedProjectDir = restoredDir;
        if (canSend) {
          wc.send('session-restored', { sessionId: logicId, projectDir: restoredDir });
          emitProjectDir(wc, restoredDir);
        }
      } else {
        state.selectedProjectDir = null;
        if (canSend) emitProjectDir(wc, null);
      }
    } else {
      // [022] URL 没有 webId：说明当前不在任何真实会话页。
      // 无论是首页（新建）、分享页（压缩中间态）还是其他页面，都意味着之前的会话已结束。
      // 清空 currentSessionId，后续有 webId 产生时统一通过 ensureLogicId 创建新记录。
      if (state.currentSessionId) {
        state.currentSessionId = null;
        console.log('[Cuckoo Code][' + profileId + '] 无 webId 页面，已清空 currentSessionId');
      }

      // 只有"主页"才走后续逻辑（弹窗等）。
      // 其他页面（settings / 分享页 / pricing 等）直接跳过，避免误弹初始化遮罩。
      const provider = getProviderByUrl(url);
      const isHomeUrl = provider && provider.homeUrlPattern && provider.homeUrlPattern.test(url);
      if (!isHomeUrl) {
        console.log('[Cuckoo Store] 非会话且非主页 URL，跳过: ' + url);
        return;
      }

      // 检查 URL 是否带入了 cuckoo_logic_id（插件入口）
      let urlLogicId: string | null = null;
      try {
        const u = new URL(url);
        urlLogicId = u.searchParams.get('cuckoo_logic_id');
      } catch (_) { /* ignore */ }
      
      if (urlLogicId) {
        // 插件带了 logicId，强行覆盖内存里的空值
        state.currentSessionId = urlLogicId as LogicId;
        console.log('[Cuckoo Code][' + profileId + '] 从 URL 缓存插件 LogicId: ' + urlLogicId);
      }
      
      state.selectedProjectDir = null;
      state.initialPromptSent = false;
      if (canSend) emitProjectDir(wc, null);
      
      // 解析 URL 中是否携带了工作区项目目录
      let urlProjectDir: string | null = null;
      try {
        const u = new URL(url);
        urlProjectDir = u.searchParams.get('cuckoo-project-dir');
        if (urlProjectDir) {
          state.selectedProjectDir = urlProjectDir;
          state.pendingProjectDir = urlProjectDir; // 补上这句，确保后续能落库
          if (canSend) emitProjectDir(wc, urlProjectDir);
        }
      } catch (_) { /* ignore */ }
      
      // 【终极统一】落到首页时通知壳页面弹窗
      // [022] 但插件驱动（URL 带 cuckoo_logic_id）时**不弹窗**——插件自己通过 meta.cwd 指定了目录，
      // 弹窗是给"用户手动新建"的引导，不该强加给插件。对齐 DSH 语义（无 cwd 会话合法存在）。
      // 详见 docs/dsh-compat-decisions.md 9.1 + 本次真机验证发现。
      if (!urlLogicId) {
        const ctx = windowState && windowState.getContextByWebContents ? windowState.getContextByWebContents(wc) : null;
        if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
        // [022] 子代理窗口自己通过 initProject(noDialog=true) 初始化，不弹窗
        // 详见 docs/dsh-compat-decisions.md 9.1 + subagent.ts 的初始化流程
        if (ctx.isSubagent) return;
        ctx.win.webContents.send('shell-show-init-prompt', { projectDir: urlProjectDir });
      }
    }
  }

  function tryRestoreSessionFromUrl(targetView?: any): void {
    const view = resolveView(targetView);
    if (!view || !view.webContents || view.webContents.isDestroyed()) return;
    const url = view.webContents.getURL();
    handleUrlChange(url, view);
  }

  return {
    readSessionStore,
    writeSessionStore,
    getSessionMeta,
    getProjectDirBySessionId,
    saveSessionDirMapping,
    updateSessionTitle,
    setSessionTitle,
    setSessionLineage,
    supersedeSession,
    setSessionArchived,
    getArchivedProjects,
    setProjectArchived,
    extractSessionIdFromUrl,
    handleUrlChange,
    tryRestoreSessionFromUrl,
    state,
  };
}

export { createSessionStore };

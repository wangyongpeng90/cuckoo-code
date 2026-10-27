/**
 * IPC：会话列表与导航
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { getProviderByUrl, getProvider } from '../../providers/registry.js';
import { initProject } from '../../session/project-context.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

// [022] 依赖注入（app 层注入给 IPC 层，用于按 profile_id 拉起窗口）
let injects: { createWindow?: any; profileManager?: any } = {};
function injectSessionDeps(deps: { createWindow?: any; profileManager?: any }): void {
  injects = { ...injects, ...deps };
}

// 文件树：忽略的目录 + 节点上限（防超大项目）
const TREE_IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.cuckooCode', '.playwright-mcp', '.idea', '.vscode', 'wyp', 'release', 'dist-verify']);
const TREE_MAX_NODES = 5000;
const TREE_MAX_DEPTH = 12;

/** 递归构建文件树（目录在前、各自按名排序） */
function buildFileTree(root: string, rel: string, depth: number, counter: { n: number }): any[] {
  if (depth > TREE_MAX_DEPTH || counter.n > TREE_MAX_NODES) return [];
  let entries: any[];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_) { return []; }
  const dirs: any[] = [];
  const files: any[] = [];
  for (const e of entries) {
    if (counter.n > TREE_MAX_NODES) break;
    if (e.isDirectory() && TREE_IGNORE_DIRS.has(e.name)) continue;
    const childRel = rel ? rel + '/' + e.name : e.name;
    counter.n++;
    if (e.isDirectory()) {
      dirs.push({ name: e.name, path: childRel, type: 'dir', children: buildFileTree(root, childRel, depth + 1, counter) });
    } else {
      files.push({ name: e.name, path: childRel, type: 'file' });
    }
  }
  // 自然排序：让 v0.8.10 排在 v0.8.9 之后（而非按字符串排在 v0.8.1 后）
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return dirs.concat(files);
}

function registerSessionIpc(): void {
  // 列出当前项目的文件树（只读浏览；忽略 node_modules/.git 等）
  ipcMain.handle('list-project-tree', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    const dir = (store && store.state && store.state.selectedProjectDir) || null;
    if (!dir) return { success: false, error: '未选择项目目录' };
    try {
      const counter = { n: 0 };
      const tree = buildFileTree(dir, '', 0, counter);
      return { success: true, root: dir, tree, truncated: counter.n > TREE_MAX_NODES };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 读取项目文件内容（只读查看；带大小/二进制保护）
  ipcMain.handle('read-project-file', async (event: any, { relPath }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    const rootDir = (store && store.state && store.state.selectedProjectDir) || null;
    if (!rootDir) return { success: false, error: '未选择项目目录' };
    if (!relPath || typeof relPath !== 'string') return { success: false, error: '缺少文件路径' };
    // 防目录穿越：拼接后必须在 rootDir 内
    const abs = path.resolve(rootDir, relPath);
    const rootAbs = path.resolve(rootDir);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      return { success: false, error: '非法路径' };
    }
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) return { success: false, error: '不是文件' };
      const MAX = 2 * 1024 * 1024; // 2MB 上限
      if (st.size > MAX) return { success: false, error: '文件过大（>' + Math.round(MAX / 1024 / 1024) + 'MB），请用系统程序打开' };
      // 二进制检测：读前 4KB 看是否含 \0
      const fd = fs.openSync(abs, 'r');
      const buf = Buffer.alloc(Math.min(4096, st.size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      if (buf.includes(0)) return { success: false, error: '二进制文件，无法文本预览' };
      const content = fs.readFileSync(abs, 'utf-8');
      return { success: true, content, size: st.size };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 用系统默认程序打开文件
  ipcMain.handle('open-project-file-external', async (event: any, { relPath }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    const rootDir = (store && store.state && store.state.selectedProjectDir) || null;
    if (!rootDir || !relPath) return { success: false, error: '缺少参数' };
    const abs = path.resolve(rootDir, relPath);
    const rootAbs = path.resolve(rootDir);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return { success: false, error: '非法路径' };
    try {
      const { shell } = require('electron');
      await shell.openPath(abs);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 列出会话（返回 { sessionId, projectDir, title, createdAt, updatedAt }）
  ipcMain.handle('list-sessions', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    if (!store || !store.state.selectedProjectDir) {
      return { success: true, sessions: [] };
    }
    const all = store.readSessionStore();
    const sessions = Object.keys(all)
      .map((id) => {
        const meta = store.getSessionMeta(id);
        return { sessionId: id, projectDir: meta.projectDir, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
      })
      .filter((s: any) => s.projectDir === store.state.selectedProjectDir);
    // 兼容旧调用（原本返回 string[]）：附纯 ID 列表
    return { success: true, sessions, sessionIds: sessions.map((s: any) => s.sessionId) };
  });

  // 列出所有会话（供壳页面侧边栏按项目目录分组显示）
  ipcMain.handle('list-all-sessions', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    if (!store) return { success: true, sessions: [] };
    const all = store.readSessionStore();
    const sessions = Object.keys(all).map((id) => {
      const meta = store.getSessionMeta(id);
      return {
        sessionId: id, projectDir: meta.projectDir, title: meta.title,
        createdAt: meta.createdAt, updatedAt: meta.updatedAt, archived: meta.archived === true,
        // 血缘：子代理/压缩来源
        parentId: meta.parentId || null, kind: meta.kind || null,
        agentName: meta.agentName || null, superseded: meta.superseded === true,
      };
    });
    // [022] 不再过滤无 projectDir 的会话——DSH 语义下"无 cwd 会话"合法存在，
    // 前端会把它们归到「未指定工作区」分组。详见 docs/dsh-compat-decisions.md 9.1。
    return { success: true, sessions, currentSessionId: store.state.currentSessionId || null, archivedProjects: store.getArchivedProjects() };
  });

  // 设置会话标题（用户手动重命名）
  ipcMain.handle('set-session-title', async (event: any, { sessionId, title }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    const t = String(title || '').trim();
    if (!store || !sessionId || !t) return { success: false, error: 'no-store-or-args' };
    store.updateSessionTitle(sessionId, t);
    return { success: true };
  });

  // 归档/取消归档项目
  ipcMain.handle('set-project-archived', async (event: any, { dir, archived }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    if (!store || !dir) return { success: false, error: 'no-store-or-dir' };
    store.setProjectArchived(dir, archived === true);
    return { success: true };
  });

  // 归档/取消归档会话
  ipcMain.handle('set-session-archived', async (event: any, { sessionId, archived }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    if (!store || !sessionId) return { success: false, error: 'no-store-or-id' };
    store.setSessionArchived(sessionId, archived === true);
    return { success: true };
  });

  // 取项目目录信息（全路径 + 创建时间），供侧边栏悬停卡片
  ipcMain.handle('get-dir-info', async (_event: any, { dir }: any) => {
    if (!dir) return { success: false, error: 'no-dir' };
    try {
      const st = fs.statSync(dir);
      const bt = st.birthtime && st.birthtime.getTime() > 0 ? st.birthtime.toISOString() : null;
      return { success: true, dir, createdAt: bt };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 用指定项目新建对话：拼参数 + 导航到首页。其余全部交给 handleUrlChange。
  ipcMain.handle('new-conversation-for-project', async (event: any, { projectDir }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.view || ctx.view.webContents.isDestroyed()) return { success: false, error: 'no-view' };
    const provider = ctx.providerId ? getProvider(ctx.providerId) : null;
    const homeUrl = provider && provider.homeUrl ? provider.homeUrl : null;
    if (!homeUrl) return { success: false, error: '当前平台无首页地址' };
    const wc = ctx.view.webContents;
    console.log('[Cuckoo Code] 工作区新建对话 → ' + homeUrl);
    
    // [022] 工作区新建：带项目目录参数导航。不含任何内存状态重置，由 handleUrlChange 消费参数。
    let targetUrl = homeUrl;
    if (projectDir) {
      try {
        const u = new URL(homeUrl);
        u.searchParams.set('cuckoo-project-dir', projectDir);
        targetUrl = u.toString();
      } catch (_) {
        targetUrl = homeUrl + (homeUrl.includes('?') ? '&' : '?') + 'cuckoo-project-dir=' + encodeURIComponent(projectDir);
      }
    }
    
    try { await wc.loadURL(targetUrl); } catch (err: any) { return { success: false, error: err.message }; }
    return { success: true };
  });

  // 上下文耗尽自动续接：从当前窗口 sessionStore 取 projectDir → 导航首页 + 初始化（保留项目目录）
  // pendingText：耗尽瞬间「刚填入、未及发送」的工具结果，带到新会话补发给 AI
  ipcMain.handle('context-exhausted-continue', async (event: any, payload: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.view || ctx.view.webContents.isDestroyed()) return { success: false, error: 'no-view' };
    const store = ctx.sessionStore;
    const projectDir = store && store.state ? store.state.selectedProjectDir : null;
    const provider = ctx.providerId ? getProvider(ctx.providerId) : null;
    const homeUrl = provider && provider.homeUrl ? provider.homeUrl : null;
    if (!homeUrl) return { success: false, error: '当前平台无首页地址' };
    const wc = ctx.view.webContents;
    const pendingText = String((payload && payload.pendingText) || '');
    console.log('[Cuckoo Code] 上下文耗尽 → 自动新会话续接，项目目录=' + (projectDir || '(无)') + '，待补发=' + pendingText.length + ' 字符');
    // 续接说明 + 最近的工具结果（作为 extraPrompt 追加到系统提示词末尾）
    let extraPrompt = '';
    if (pendingText) {
      extraPrompt =
        '【续接说明】上一会话因上下文耗尽中断。中断前最后一个工具调用的执行结果如下，' +
        '请据此继续工作（不要重复执行同一工具；如需更多上下文，请用工具读取项目文件）：\n\n' + pendingText;
    }
    const onLoad = () => {
      try { wc.off('did-finish-load', onLoad); } catch (_) { /* ignore */ }
      setTimeout(async () => {
        try {
          await initProject(false, ctx, projectDir, false, extraPrompt, false);
        } catch (err: any) {
          console.log('[Cuckoo Code] 续接初始化项目失败: ' + (err && err.message));
        }
      }, 2000);
    };
    try { wc.on('did-finish-load', onLoad); } catch (_) { /* ignore */ }
    try { await wc.loadURL(homeUrl); } catch (err: any) { return { success: false, error: err.message }; }
    return { success: true, projectDir: projectDir || null, pendingTextLen: pendingText.length };
  });

  /**
   * [022] 判断两个 URL 是否指向同一会话（用于 navigate-session 的同 URL 跳过）。
   * 规范化：去 hash、去尾斜杠、忽略大小写（Windows 路径 / 域名不敏感）。
   */
  function sameSessionUrl(a: string, b: string): boolean {
    const norm = (u: string) => {
      try {
        const p = new URL(u);
        return (p.origin + p.pathname.replace(/\/+$/, '') + p.search).toLowerCase();
      } catch {
        return u.toLowerCase();
      }
    };
    return norm(a) === norm(b);
  }

  // 导航到会话（支持跨窗口：按 profile_id 找/拉起目标窗口）
  ipcMain.handle('navigate-session', async (event: any, { sessionId }: any) => {
    if (!sessionId) return { success: false, error: '缺少会话ID' };

    // 1. 查数据库拿 webId + profileId
    let targetWebId = sessionId;
    let profileId: string | null = null;
    const db = (globalThis as any).__globalDb;
    if (db) {
      try {
        const row = db.prepare('SELECT web_id, profile_id FROM sessions WHERE logic_id = ?').get(sessionId) as any;
        if (row) {
          if (row.web_id) targetWebId = row.web_id;
          if (row.profile_id) profileId = row.profile_id;
        }
      } catch (_) { /* ignore */ }
    }

    // 2. 按 profileId 找窗口，找不到则主动拉起
    let ctx: any = null;
    if (profileId) {
      ctx = windowState.getWindowByProfileId(profileId);
      if (!ctx && injects.createWindow && injects.profileManager) {
        const prof = injects.profileManager.getProfileById(profileId);
        if (prof) {
          const wid = injects.createWindow(prof);
          ctx = windowState.getWindowContext(wid);
          console.log('[Cuckoo Code] navigate-session: 目标窗口未打开，已主动拉起 ' + profileId);
        }
      }
    }
    // 兜底：当前窗口
    if (!ctx) ctx = windowState.getContextByWebContents(event.sender);

    const view = ctx ? ctx.view : null;
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { success: false, error: '窗口已关闭' };
    }

    // 3. 按当前 provider 拼会话 URL
    let url = null;
    try {
      const provider = getProviderByUrl(view.webContents.getURL());
      if (provider && typeof provider.sessionUrlBase === 'string' && provider.sessionUrlBase) {
        url = provider.sessionUrlBase + targetWebId;
      }
    } catch (_) { /* provider 未识别 */ }
    if (!url) return { success: false, error: '无法确定会话 URL（当前平台未提供 sessionUrlBase）' };

    // 4. 同 URL 不刷新
    try {
      const cur = view.webContents.getURL();
      if (cur && sameSessionUrl(cur, url)) {
        console.log('[Cuckoo Code] navigate-session: 已在目标会话，跳过刷新 | url=' + url);
        return { success: true, skipped: true };
      }
    } catch { /* ignore */ }

    // 5. 导航
    try {
      await view.webContents.loadURL(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerSessionIpc, injectSessionDeps };

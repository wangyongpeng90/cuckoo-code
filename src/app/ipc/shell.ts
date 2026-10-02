/**
 * IPC：地址栏壳页面（shell）的导航控制
 * 壳页面通过 window.shellAPI 调用这些通道操作下方 WebContentsView 中的 AI 页面。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as windowState from '../window.js';
import { getProvider } from '../../providers/registry.js';
import { setWindowCumulative, getTotal, cleanupSubagentKeys } from '../token-stats.js';
import { resolveAsset, resolveSrc } from '../../infra/paths.js';
import * as updater from '../../updater/index.js';
// 新对话要让 harness 视图一起重置 —— 两个入口共用同一段逻辑，避免行为分叉
import { prepareNewConversation } from './harness.js';

const require = createRequire(import.meta.url);
const { ipcMain, app, shell, BrowserWindow } = require('electron');

/** 取事件来源对应的 AI 页面 view */
function viewOf(event: any): any {
  return windowState.getViewByWebContents(event.sender);
}

/**
 * 默认的网页会话列表抓取：扫 a[href]，按 sessionUrlBase 的 pathname 前缀过滤。
 * 必须自包含（会被 toString 序列化后注入 AI 页面主世界执行），
 * 只使用 doc / win / base 三个入参与浏览器全局。
 */
function defaultSessionListFn(doc: any, win: any, base: any) {
  try {
    var basePath = '';
    try { basePath = new win.URL(base).pathname; } catch (e) { basePath = ''; }
    var anchors = doc.querySelectorAll('a[href]');
    var seen: any = {}, out: any[] = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.href || '';
      if (!href) continue;
      if (basePath && href.indexOf(basePath) === -1) continue;
      var title = String(a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!title) continue;
      if (seen[href]) continue;
      seen[href] = 1;
      var cls = (typeof a.className === 'string') ? a.className : '';
      out.push({ title: title, href: href, active: cls.indexOf('active') !== -1 || a.getAttribute('aria-current') === 'page' });
    }
    return out.slice(0, 100);
  } catch (e) { return []; }
}

/** 把当前 URL 与前进/后退可用状态推送给壳页面 */
function pushUrlState(view: any): void {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  const ctx = windowState.getContextByWebContents(wc);
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const history = wc.navigationHistory;
  ctx.win.webContents.send('shell-url-updated', {
    url: wc.getURL(),
    canGoBack: history ? history.canGoBack() : false,
    canGoForward: history ? history.canGoForward() : false,
  });
}

/** 把系统总累计广播给所有窗口的壳页面 */
function broadcastSystemTotal(): void {
  const total = getTotal();
  for (const ctx of windowState.getAllContexts()) {
    try {
      if (ctx && ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('shell-total-updated', { systemTotal: total });
      }
    } catch (_) {}
  }
}

/** 把项目目录推送给壳页面（地址栏最左） */
function pushProjectDir(view: any, dir: string | null): void {
  const ctx = view ? windowState.getContextByWebContents(view.webContents) : null;
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  ctx.win.webContents.send('shell-project-dir', dir || null);
}

/** 把 token 数据推送给壳页面的状态条 */
function pushTokenUsage(view: any, context: number, cumulative: number, windowCumulative = 0, todayCumulative = 0, daily: any = null): void {
  const ctx = view ? windowState.getContextByWebContents(view.webContents) : null;
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  ctx.win.webContents.send('shell-token-updated', { context, cumulative, windowCumulative, todayCumulative, daily });
}

function registerShellIpc(): void {
  // 启动时清理子代理遗留的 token 统计键（历史 bug：子代理上报污染系统总累计）
  try { cleanupSubagentKeys(); } catch (_) { /* ignore */ }
  // AI 页面报告 token（上下文 + 对话累计 + 窗口累计 + 今日累计）→ 转发给壳页面状态条
  ipcMain.handle('update-token-usage', async (event: any, { context, cumulative, windowCumulative, todayCumulative, daily }: any) => {
    const view = viewOf(event);
    if (view && typeof context === 'number') {
      pushTokenUsage(
        view,
        context,
        typeof cumulative === 'number' ? cumulative : 0,
        typeof windowCumulative === 'number' ? windowCumulative : 0,
        typeof todayCumulative === 'number' ? todayCumulative : 0,
        Array.isArray(daily) ? daily : null
      );
    }
    // 更新系统总累计并广播给所有窗口
    try {
      const ctx = view ? windowState.getContextByWebContents(view.webContents) : null;
      // 子代理窗口跳过：它与父窗口共享 partition/localStorage，
      // windowCumulative 等于父窗口的值，上报会重复计入系统总累计。
      const isSubagent = ctx && ctx.profileId && String(ctx.profileId).startsWith('subagent-');
      if (ctx && ctx.profileId && !isSubagent && typeof windowCumulative === 'number') {
        setWindowCumulative(ctx.profileId, windowCumulative);
        broadcastSystemTotal();
      }
    } catch (_) {}
    return { success: true };
  });

  // 查询当前系统总累计（壳页面加载时拉取一次）
  ipcMain.handle('get-system-total', async () => {
    return { success: true, systemTotal: getTotal() };
  });


  // ===== 侧栏「对话」分页：读网页端会话列表（DOM 实时读取，天然同步）+ 导航 =====
  ipcMain.handle('web-list-sessions', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const view = ctx ? ctx.view : null;
    if (!view || !view.webContents || view.webContents.isDestroyed()) return { success: false, sessions: [] };
    const provider = (ctx && ctx.providerId) ? getProvider(ctx.providerId) : null;
    const base = (provider && provider.sessionUrlBase) || '';
    try {
      // 平台可提供自定义抓取实现（侧栏非 a[href] 结构时必需），否则用默认实现
      const fn = (provider && typeof provider.getSessionListFn === 'function')
        ? provider.getSessionListFn()
        : defaultSessionListFn;
      if (typeof fn !== 'function') return { success: false, error: 'getSessionListFn 未返回函数', sessions: [] };
      const list = await view.webContents.executeJavaScript('(' + fn.toString() + ')(document, window, ' + JSON.stringify(base) + ')');
      return { success: true, sessions: list || [], currentUrl: view.webContents.getURL() };
    } catch (err: any) {
      return { success: false, error: err.message, sessions: [] };
    }
  });
  ipcMain.handle('web-navigate-session', async (event: any, { url }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const view = ctx ? ctx.view : null;
    if (!view || !url) return { success: false };
    try { await view.webContents.loadURL(url); return { success: true }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });
  // 新对话：导航到平台首页（开新会话）
  ipcMain.handle('web-new-conversation', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const view = ctx ? ctx.view : null;
    if (!view) return { success: false };
    const provider = (ctx && ctx.providerId) ? getProvider(ctx.providerId) : null;
    const url = provider && provider.homeUrl ? provider.homeUrl : '';
    if (!url) return { success: false, error: 'no-home-url' };
    try {
      // 这里曾只做 loadURL —— AI 网页换了新会话，但 harness 视图完全不知道，
      // 于是消息流/计划/目标/附件全留在屏幕上（"新对话"后满屏残留）。
      prepareNewConversation(ctx);
      await view.webContents.loadURL(url);
      return { success: true };
    }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('shell-navigate', async (event: any, { url }: any) => {
    const view = viewOf(event);
    if (!view || !url) return { success: false };
    try {
      await view.webContents.loadURL(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('shell-back', async (event: any) => {
    const view = viewOf(event);
    if (view && view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
    }
    return { success: true };
  });

  ipcMain.handle('shell-forward', async (event: any) => {
    const view = viewOf(event);
    if (view && view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
    }
    return { success: true };
  });

  ipcMain.handle('shell-reload', async (event: any) => {
    const view = viewOf(event);
    if (view) view.webContents.reload();
    return { success: true };
  });

  ipcMain.handle('shell-home', async (event: any) => {
    const view = viewOf(event);
    if (!view) return { success: false };
    const ctx = windowState.getContextByWebContents(view.webContents);
    if (!ctx || !ctx.providerId) return { success: false };
    const provider = getProvider(ctx.providerId);
    if (!provider) return { success: false };
    try {
      await view.webContents.loadURL(provider.homeUrl);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 应用信息（关于页：版本号）
  ipcMain.handle('get-app-info', async () => {
    let version = '';
    try { version = app.getVersion(); } catch (_) {}
    return { success: true, version };
  });

  // 打开外部链接（关于页：GitHub 源码地址）
  ipcMain.handle('open-external', async (_event: any, { url }: any) => {
    try {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { success: false };
      await shell.openExternal(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 打开「飞书配置教程」应用内新窗口（自包含 HTML，离线可用）
  ipcMain.handle('open-feishu-setup', async () => {
    try {
      const htmlPath = resolveSrc('ui/feishu-setup.html');
      const win = new BrowserWindow({
        width: 900,
        height: 820,
        title: '飞书同步配置教程',
        backgroundColor: '#16181d',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      win.loadFile(htmlPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 检查更新（关于页按钮）
  ipcMain.handle('check-update', async () => {
    try {
      await updater.checkForUpdates();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 取 assets 图片的 file:// URL（关于页 QQ 群图片）
  ipcMain.handle('get-asset-url', async (_event: any, { rel }: any) => {
    try {
      if (typeof rel !== 'string' || !rel) return { success: false };
      const abs = resolveAsset(rel);
      return { success: true, url: pathToFileURL(abs).href };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 查询当前项目目录（壳页面加载时拉取一次）
  ipcMain.handle('get-project-dir', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const dir = (ctx && ctx.sessionStore && ctx.sessionStore.state && ctx.sessionStore.state.selectedProjectDir) || null;
    return { success: true, dir };
  });

  // 壳页面上报真实可视尺寸 → 记录并重新布局（修正 Windows 菜单栏导致的高度误差）
  ipcMain.on('shell-report-size', (event: any, { w, h }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
    const win = ctx.win;
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
      win.__ckShellWidth = w;
      win.__ckShellHeight = h;
      try { if (typeof win.__ckLayout === 'function') win.__ckLayout(); } catch (_) {}
    }
  });

  // 切换纯净对话模式（Harness）：壳页面「纯净模式/原版模式」按钮调用
  ipcMain.handle('shell-toggle-harness', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return { success: false };
    const win = ctx.win;
    try { win.__ckToggleHarness?.(); } catch (_) { /* ignore */ }
    return { success: true, harness: !!win.__ckHarnessVisible };
  });

  // 设置左侧 Cuckoo 侧边栏宽度（收起=46，展开=320）→ 重新布局 AI 页面
  ipcMain.handle('shell-toggle-sidebar', async (event: any, { width }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return { success: false };
    const win = ctx.win;
    win.__ckSidebarWidth = typeof width === 'number' ? width : 320;
    try { if (typeof win.__ckLayout === 'function') win.__ckLayout(); } catch (_) {}
    return { success: true };
  });
}

export { registerShellIpc, pushUrlState, pushTokenUsage, pushProjectDir };

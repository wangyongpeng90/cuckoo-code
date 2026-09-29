/**
 * IPC：地址栏壳页面（shell）的导航控制
 * 壳页面通过 window.shellAPI 调用这些通道操作下方 WebContentsView 中的 AI 页面。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { isShellPanelId } from '../layout.js';
import { getProvider } from '../../providers/registry.js';
import { resolveSrc } from '../../infra/paths.js';
import { setWindowCumulative, getTotal, cleanupSubagentKeys } from '../token-stats.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

/** 视图缩放步进 / 上下限（与标题栏缩放菜单、Ctrl/Cmd +/-/0 共用同一状态机） */
export const ZOOM_STEP = 0.1;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

export type ZoomAction = 'in' | 'out' | 'reset';

// ===== 缩放 mini 菜单（原生子窗口） =====
// 壳页面 DOM 无法覆盖 WebContentsView（原生层级高于壳 DOM），瞬态弹出菜单
// 改为独立无边框子窗口：层级天然高于 view，且不移动/遮挡 AI 页面。
// 菜单卡片尺寸即窗口尺寸（非 transparent 窗口：系统绘制圆角与阴影，无合成 artifact）
const ZOOM_MENU_W = 208;
const ZOOM_MENU_H = 96;
// windowId -> 菜单窗（同一主窗口同时只存在一个菜单）
const zoomMenus = new Map<number, any>();

/** 关闭指定主窗口的缩放菜单（已销毁/不存在时幂等） */
function closeZoomMenuOf(windowId: number): void {
  const win = zoomMenus.get(windowId);
  if (win && !win.isDestroyed()) {
    try { win.close(); } catch (_) {}
  }
  zoomMenus.delete(windowId);
}

/** 在缩放按钮下方弹出 mini 菜单窗；rect 为按钮相对壳页面视口的位置（DIP） */
function openZoomMenu(ctx: any, rect: any): void {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  closeZoomMenuOf(ctx.win.id);

  const { BrowserWindow, screen } = require('electron');
  const winBounds = ctx.win.getBounds();
  const workArea = screen.getDisplayMatching(winBounds).workArea;
  let x = winBounds.x + (rect && typeof rect.right === 'number' ? rect.right : winBounds.width - 120) - ZOOM_MENU_W;
  let y = winBounds.y + (rect && typeof rect.bottom === 'number' ? rect.bottom : 40) + 6;
  // 下方放不下时向上翻（按钮上方），并夹在所在显示器工作区内
  if (y + ZOOM_MENU_H > workArea.y + workArea.height) {
    y = winBounds.y + (rect && typeof rect.top === 'number' ? rect.top : 12) - ZOOM_MENU_H - 6;
  }
  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - ZOOM_MENU_W - 8));
  y = Math.max(workArea.y + 8, y);
  x = Math.round(x); y = Math.round(y);

  const menuWin = new BrowserWindow({
    parent: ctx.win,
    width: ZOOM_MENU_W, height: ZOOM_MENU_H,
    // 非 transparent：由系统绘制窗口圆角与阴影（macOS 原生观感），
    // 规避 transparent + backdrop-filter + CSS 变换的合成器重影 artifact
    frame: false,
    backgroundColor: '#ffffff',
    resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, '..', 'zoom-menu-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  zoomMenus.set(ctx.win.id, menuWin);
  menuWin.loadFile(resolveSrc('ui/zoom-menu.html'));

  menuWin.once('ready-to-show', () => {
    if (menuWin.isDestroyed()) return;
    // 显式定位：frameless 子窗口构造参数中的 x/y 在部分平台/时机下不可靠
    menuWin.setPosition(x, y, false);
    menuWin.show();
    menuWin.focus();
  });
  // 点击外部（含主窗口/其他窗口）→ 失焦即关
  menuWin.on('blur', () => closeZoomMenuOf(ctx.win.id));
  menuWin.once('closed', () => {
    if (zoomMenus.get(ctx.win.id) === menuWin) zoomMenus.delete(ctx.win.id);
  });
  menuWin.webContents.on('did-finish-load', () => {
    try { menuWin.webContents.send('zoom-menu-init', { zoomFactor: ctx.zoomFactor || 1 }); } catch (_) {}
  });

  // 主窗口移动/缩放/关闭时菜单位置失真，一并收起
  ctx.win.once('move', () => closeZoomMenuOf(ctx.win.id));
  ctx.win.once('resize', () => closeZoomMenuOf(ctx.win.id));
  ctx.win.once('closed', () => closeZoomMenuOf(ctx.win.id));
}

/** 把缩放动作应用到窗口的 AI 页面 view，并把最新倍率广播给壳页面标题栏 */
function applyZoomToContext(ctx: any, action: ZoomAction): number {
  const current = typeof ctx.zoomFactor === 'number' && ctx.zoomFactor > 0 ? ctx.zoomFactor : 1;
  let next = current;
  if (action === 'in') {
    next = Math.min(ZOOM_MAX, Math.round((current + ZOOM_STEP) * 10) / 10);
  } else if (action === 'out') {
    next = Math.max(ZOOM_MIN, Math.round((current - ZOOM_STEP) * 10) / 10);
  } else {
    next = 1;
  }
  ctx.zoomFactor = next;
  if (ctx.view && ctx.view.webContents && !ctx.view.webContents.isDestroyed()) {
    try { ctx.view.webContents.setZoomFactor(next); } catch (_) {}
  }
  if (ctx.win && !ctx.win.isDestroyed()) {
    try { ctx.win.webContents.send('shell-zoom-updated', { zoomFactor: next }); } catch (_) {}
  }
  // 菜单窗打开时（快捷键触发的缩放）同步其倍率显示
  const menuWin = zoomMenus.get(ctx.win ? ctx.win.id : -1);
  if (menuWin && !menuWin.isDestroyed()) {
    try { menuWin.webContents.send('zoom-menu-zoom', { zoomFactor: next }); } catch (_) {}
  }
  return next;
}

/** 主进程直接应用缩放（菜单 / AI 页面聚焦时的快捷键 relay 入口） */
function applyZoom(viewWebContentsOrCtx: any, action: ZoomAction): number | null {
  const ctx = viewWebContentsOrCtx && viewWebContentsOrCtx.view
    ? viewWebContentsOrCtx
    : windowState.getContextByWebContents(viewWebContentsOrCtx);
  if (!ctx || !ctx.view || !ctx.view.webContents || ctx.view.webContents.isDestroyed()) return null;
  return applyZoomToContext(ctx, action);
}

/** 取事件来源对应的 AI 页面 view */
function viewOf(event: any): any {
  return windowState.getViewByWebContents(event.sender);
}

/** 把当前 URL 与前进/后退可用状态推送给壳页面（附 provider 名供标题栏显示） */
function pushUrlState(view: any): void {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  const ctx = windowState.getContextByWebContents(wc);
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const history = wc.navigationHistory;
  const provider = ctx.providerId ? getProvider(ctx.providerId) : null;
  ctx.win.webContents.send('shell-url-updated', {
    url: wc.getURL(),
    canGoBack: history ? history.canGoBack() : false,
    canGoForward: history ? history.canGoForward() : false,
    providerName: provider ? provider.name : '',
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

/** 把 token 数据推送给壳页面的状态条 */
function pushTokenUsage(view: any, context: number, cumulative: number, windowCumulative = 0, todayCumulative = 0): void {
  const ctx = view ? windowState.getContextByWebContents(view.webContents) : null;
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  ctx.win.webContents.send('shell-token-updated', { context, cumulative, windowCumulative, todayCumulative });
}

function registerShellIpc(): void {
  // 启动时清理子代理遗留的 token 统计键（历史 bug：子代理上报污染系统总累计）
  try { cleanupSubagentKeys(); } catch (_) { /* ignore */ }
  // AI 页面报告 token（上下文 + 对话累计 + 窗口累计 + 今日累计）→ 转发给壳页面状态条
  ipcMain.handle('update-token-usage', async (event: any, { context, cumulative, windowCumulative, todayCumulative }: any) => {
    const view = viewOf(event);
    if (view && typeof context === 'number') {
      pushTokenUsage(
        view,
        context,
        typeof cumulative === 'number' ? cumulative : 0,
        typeof windowCumulative === 'number' ? windowCumulative : 0,
        typeof todayCumulative === 'number' ? todayCumulative : 0
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

  // 壳页面 → AI 页面消息 relay（MCP 面板「通知 AI」）：
  // 页面 DOM 操作只能在该窗口 view 的 preload 里做，这里转发给 bridge 的 chat-input 执行 sendToChat
  ipcMain.handle('shell-send-to-chat', async (event: any, { msg, tag, delayMs }: any = {}) => {
    const view = viewOf(event);
    if (!view || typeof msg !== 'string' || !msg) {
      return { success: false, error: 'view 不存在或消息为空' };
    }
    try {
      view.webContents.send('shell-send-to-chat', { msg, tag, delayMs });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 壳页面「压缩上下文」→ relay 到 AI 页面 view：清 IDB + 刷新等流程只能在页面侧执行
  // （bridge preload 监听 'shell-compact' 后调用 session/compaction.ts 的 runCompaction）
  ipcMain.handle('shell-compact', async (event: any) => {
    const view = viewOf(event);
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { success: false, error: 'view 不存在' };
    }
    try {
      view.webContents.send('shell-compact');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 壳页面图标栏点击：记录该窗口的面板开关状态并重算 view bounds
  // panelId 必须在已知面板集合内，非法值拒绝（null/空 = 收起，放行）
  ipcMain.handle('shell-panel-state', async (event: any, { panelId }: any = {}) => {
    if (panelId !== null && panelId !== undefined && panelId !== '' && !isShellPanelId(panelId)) {
      return { success: false, error: '未知面板 id' };
    }
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx) return { success: false, error: '窗口上下文不存在' };
    ctx.panelId = typeof panelId === 'string' && panelId ? panelId : null;
    try { if (ctx.relayout) ctx.relayout(); } catch (_) {}
    return { success: true, panelId: ctx.panelId };
  });

  // 导航条浮层滑出/收起：WebContentsView 原生层级高于壳页面 DOM，浮层会被 view 遮挡，
  // 故滑出时临时把 view 下移一个导航条高度（computeViewBounds 第 4 参），收起后回到常驻标题栏下沿。
  ipcMain.handle('shell-topbar-visible', async (event: any, { visible }: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx) return { success: false, error: '窗口上下文不存在' };
    ctx.topbarVisible = !!visible;
    try { if (ctx.relayout) ctx.relayout(); } catch (_) {}
    return { success: true, topbarVisible: ctx.topbarVisible };
  });

  // ===== 无边框窗口自绘窗口控制（win32；macOS 用系统红绿灯） =====
  ipcMain.handle('shell-window-minimize', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (ctx && ctx.win && !ctx.win.isDestroyed()) ctx.win.minimize();
    return { success: true };
  });

  ipcMain.handle('shell-window-maximize', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (ctx && ctx.win && !ctx.win.isDestroyed()) {
      if (ctx.win.isMaximized()) ctx.win.unmaximize();
      else ctx.win.maximize();
    }
    return { success: true };
  });

  ipcMain.handle('shell-window-close', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (ctx && ctx.win && !ctx.win.isDestroyed()) ctx.win.close();
    return { success: true };
  });

  // ===== 视图缩放（标题栏按钮 / 壳页面快捷键 / AI 页面快捷键 relay 共用） =====
  ipcMain.handle('shell-zoom', async (event: any, { action }: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx) return { success: false, error: '窗口上下文不存在' };
    if (action !== 'in' && action !== 'out' && action !== 'reset') {
      return { success: false, error: '未知缩放动作' };
    }
    const zoomFactor = applyZoomToContext(ctx, action);
    return { success: true, zoomFactor };
  });

  // 壳页面重载后回读当前倍率（主进程 ctx.zoomFactor 不落盘，默认 1）
  ipcMain.handle('shell-zoom-get', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const zoomFactor = ctx && typeof ctx.zoomFactor === 'number' && ctx.zoomFactor > 0 ? ctx.zoomFactor : 1;
    return { success: true, zoomFactor };
  });

  // 标题栏缩放按钮 → 弹出 mini 菜单窗（原生子窗口，层级高于 AI 页面 view）
  ipcMain.handle('shell-zoom-menu-open', async (event: any, { rect }: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx) return { success: false, error: '窗口上下文不存在' };
    openZoomMenu(ctx, rect);
    return { success: true };
  });

  // mini 菜单窗点击项：应用缩放；+/- 保持窗口打开（支持连续缩放，失焦/外部点击关闭），
  // reset 后关闭（操作已完成，与 macOS 分段控件的交互惯例一致）
  ipcMain.handle('zoom-menu-action', async (event: any, { action }: any = {}) => {
    if (action !== 'in' && action !== 'out' && action !== 'reset') {
      return { success: false, error: '未知缩放动作' };
    }
    const { BrowserWindow } = require('electron');
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    let windowId: number | null = null;
    for (const [id, menuWin] of zoomMenus) {
      if (menuWin === senderWin) { windowId = id; break; }
    }
    if (windowId === null) return { success: false, error: '菜单窗不存在' };
    const ctx = windowState.getWindowContext(windowId);
    if (!ctx) return { success: false, error: '窗口上下文不存在' };
    applyZoomToContext(ctx, action);
    if (action === 'reset') closeZoomMenuOf(windowId);
    return { success: true };
  });
}

export { registerShellIpc, pushUrlState, pushTokenUsage, applyZoom };

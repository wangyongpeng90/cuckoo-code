/**
 * 窗口管理（多窗口 + 每窗口 profile 上下文）
 * 每个窗口关联一个 profileId，拥有独立的 sessionStore 实例。
 */
import { removeWindowHistory } from './tool-activity.js';

interface WindowContext {
  win: any;
  /** AI 网页所在的 WebContentsView（壳窗口的 win.webContents 是地址栏壳页面） */
  view: any;
  profileId: any;
  providerId: any;
  sessionStore: any;
  /** 当前展开的侧面板 id（null = 收起），由 shell-panel-state IPC 维护 */
  panelId?: string | null;
  /** 导航条浮层是否滑出（默认隐藏不占布局），由 shell-topbar-visible IPC 维护 */
  topbarVisible?: boolean;
  /**
   * AI 页面 view 的缩放倍率（1 = 100%）。由 shell-zoom-* IPC 维护，
   * 窗口内共享；不落盘，重启回到 1。
   */
  zoomFactor?: number;
  /** 面板开关变化后重算 view bounds（由 entry.ts 注入） */
  relayout?: () => void;
}

const windows = new Map<number, WindowContext>(); // windowId -> { win, profileId, providerId, sessionStore }
let lastActiveWindowId: number | null = null;

function addWindow(win: any, profileId: any, providerId: any, sessionStore: any, view: any): void {
  windows.set(win.id, { win, view, profileId, providerId, sessionStore });
  lastActiveWindowId = win.id;
  win.on('closed', () => {
    windows.delete(win.id);
    removeWindowHistory(win.id);
    if (lastActiveWindowId === win.id) {
      const remaining = Array.from(windows.keys());
      lastActiveWindowId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  });
}

function removeWindow(windowId: number): void {
  windows.delete(windowId);
  if (lastActiveWindowId === windowId) {
    const remaining = Array.from(windows.keys());
    lastActiveWindowId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
}

function getWindowContext(windowId: number): WindowContext | null {
  return windows.get(windowId) || null;
}

function getContextByWebContents(webContents: any): WindowContext | null {
  for (const ctx of windows.values()) {
    if (ctx.win.webContents === webContents) return ctx;
    if (ctx.view && ctx.view.webContents === webContents) return ctx;
  }
  return null;
}

/** 取窗口的 AI 页面 view（若已销毁返回 null） */
function getViewOf(windowId: number): any {
  const ctx = windows.get(windowId);
  return ctx ? ctx.view : null;
}

/** 按 webContents 取 AI 页面 view（IPC 中从 event.sender 反查用） */
function getViewByWebContents(webContents: any): any {
  const ctx = getContextByWebContents(webContents);
  return ctx ? ctx.view : null;
}

function getMainWindow(): any {
  if (!lastActiveWindowId) return null;
  const ctx = windows.get(lastActiveWindowId);
  return ctx ? ctx.win : null;
}

function getMainContext(): WindowContext | null {
  if (!lastActiveWindowId) return null;
  return windows.get(lastActiveWindowId) || null;
}

function setMainWindow(win: any): void {
  if (win) {
    lastActiveWindowId = win.id;
  } else {
    lastActiveWindowId = null;
  }
}

function getAllWindows(): any[] {
  return Array.from(windows.values()).map(ctx => ctx.win);
}

function getAllContexts(): WindowContext[] {
  return Array.from(windows.values());
}

function getWindowByProfileId(profileId: any): WindowContext | null {
  for (const ctx of windows.values()) {
    if (ctx.profileId === profileId) return ctx;
  }
  return null;
}

export {
  addWindow,
  removeWindow,
  getWindowContext,
  getContextByWebContents,
  getViewOf,
  getViewByWebContents,
  getMainWindow,
  getMainContext,
  setMainWindow,
  getAllWindows,
  getAllContexts,
  getWindowByProfileId,
};

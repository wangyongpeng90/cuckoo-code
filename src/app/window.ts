/**
 * 窗口管理（多窗口 + 每窗口 profile 上下文）
 * 每个窗口关联一个 profileId，拥有独立的 sessionStore 实例。
 */
interface WindowContext {
  win: any;
  /** AI 网页所在的 WebContentsView（壳窗口的 win.webContents 是地址栏壳页面） */
  view: any;
  profileId: any;
  providerId: any;
  sessionStore: any;
  /** 是否子代理窗口（子代理与父窗口共用 profileId，靠此标志区分） */
  isSubagent?: boolean;
  /** 插件覆盖层视图（透明置顶，插件 UI 住这里） */
  overlayView?: any;
  /** 确保覆盖层创建（懒加载） */
  __ckEnsureOverlay?: () => any;
}

const windows = new Map<number, WindowContext>(); // windowId -> { win, profileId, providerId, sessionStore }
let lastActiveWindowId: number | null = null;

function addWindow(win: any, profileId: any, providerId: any, sessionStore: any, view: any, isSubagent?: boolean): void {
  windows.set(win.id, { win, view, profileId, providerId, sessionStore, isSubagent: !!isSubagent });
  lastActiveWindowId = win.id;
  win.on('closed', () => {
    windows.delete(win.id);
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
    if ((ctx as any).harnessView && (ctx as any).harnessView.webContents === webContents) return ctx;
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

/**
 * 按 profileId 取窗口。
 * 子代理与父窗口共用 profileId，故此方法**只返回主窗口**（跳过子代理），
 * 避免"已开就聚焦""删除窗口""飞书转发"等场景误命中子代理窗口。
 */
function getWindowByProfileId(profileId: any): WindowContext | null {
  for (const ctx of windows.values()) {
    if (ctx.profileId === profileId && !ctx.isSubagent) return ctx;
  }
  return null;
}

/** 按 profileId 取**全部**窗口（含子代理）。用于"删除窗口"时把分身一并关掉。 */
function getAllWindowsByProfileId(profileId: any): WindowContext[] {
  const out: WindowContext[] = [];
  for (const ctx of windows.values()) {
    if (ctx.profileId === profileId) out.push(ctx);
  }
  return out;
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
  getAllWindowsByProfileId,
};

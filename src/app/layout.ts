/**
 * 壳窗口布局纯函数（浅色改版骨架）。
 *
 * 布局结构：
 *   常驻标题栏 42px（全宽，无边框窗口的拖拽区）；
 *   左图标栏 52px + 可展开面板 280px；
 *   导航条为默认隐藏的浮层（shell DOM，不占布局高度）；
 *   AI 页面 view 以圆角卡片呈现，四周留 10px 边距。
 * bounds = f(窗口尺寸, panelOpen, navOpen)，无 Electron 依赖，便于单测。
 */

export const SHELL_LAYOUT = {
  /** 常驻标题栏高度（CherryStudio 式细长栏，macOS 红绿灯内嵌其中） */
  TITLEBAR_HEIGHT: 42,
  /**
   * 导航条浮层高度。默认隐藏、不占布局；滑出时因 WebContentsView 原生层级
   * 高于壳页面 DOM（CSS z-index 无法覆盖），主进程会临时把 view 下移该高度，
   * 使浮层可见可点；隐藏后 view 回到 y = TITLEBAR_HEIGHT + CARD_MARGIN。
   */
  NAVBAR_HEIGHT: 44,
  /** 左侧图标栏宽度 */
  RAIL_WIDTH: 52,
  /** 侧面板宽度（展开时） */
  PANEL_WIDTH: 280,
  /** AI 页面卡片四周间距（0 = 内容容器紧贴 chrome，无留白） */
  CARD_MARGIN: 0,
  /** AI 页面卡片圆角（view.setBorderRadius；紧贴 chrome 时仅上方两角可见） */
  CARD_RADIUS: 12,
} as const;

/**
 * shell 侧栏已知面板 id 集合（与 src/ui/shell.html 图标栏 data-panel 值一一对应）。
 * shell-panel-state IPC 据此拒绝非法 panelId。
 */
export const SHELL_PANEL_IDS = ['chat', 'window', 'mcp', 'task', 'settings', 'project'] as const;

/** 判断是否为合法的 shell 面板 id */
export function isShellPanelId(v: unknown): v is string {
  return typeof v === 'string' && (SHELL_PANEL_IDS as readonly string[]).includes(v);
}

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 由窗口尺寸与面板/导航条状态计算 AI 页面 view 的 bounds */
export function computeViewBounds(
  winWidth: number,
  winHeight: number,
  panelOpen: boolean,
  navOpen: boolean = false
): ViewBounds {
  const m = SHELL_LAYOUT.CARD_MARGIN;
  const x = SHELL_LAYOUT.RAIL_WIDTH + (panelOpen ? SHELL_LAYOUT.PANEL_WIDTH : 0) + m;
  const y = SHELL_LAYOUT.TITLEBAR_HEIGHT + (navOpen ? SHELL_LAYOUT.NAVBAR_HEIGHT : 0) + m;
  return {
    x,
    y,
    width: Math.max(0, winWidth - x - m),
    height: Math.max(0, winHeight - y - m),
  };
}

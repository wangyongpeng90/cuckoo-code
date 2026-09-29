/**
 * AI 页面 view 按键 → 壳面板动作 的纯判定（before-input-event 用）。
 * 输入按键信息与面板状态，输出动作；调用方据此决定是否 preventDefault。
 * 无 Electron 依赖，便于单测。
 */

/** 按键信息（Electron before-input-event 的 input 子集） */
export interface ViewKeyInput {
  key?: string;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type ViewKeyAction =
  | 'toggle-panel'
  | 'close-panel'
  | 'focus-url'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | null;

/**
 * 判定 view 内按键应触发的壳动作：
 * - Ctrl+Shift+C → 切换面板（展开/收起），始终拦截
 * - Ctrl+L / Cmd+L → 唤出导航条并聚焦 URL 输入框（浏览器惯例键，AI 页面自身不用，relay 时 preventDefault）
 * - Ctrl/Cmd + = / + → 放大 AI 页面；+ - → 缩小；+ 0 → 重置（浏览器惯例键，与标题栏缩放按钮同一状态机）
 * - Esc 且面板打开 → 收起面板，拦截（否则菜单「停止加载」会与收起叠加触发）
 * - 其余（含面板关闭时的 Esc）→ null，放行页面自身行为
 */
export function decideViewKeyAction(input: ViewKeyInput, panelId: string | null): ViewKeyAction {
  if (input.control && input.shift && (input.key === 'C' || input.key === 'c')) {
    return 'toggle-panel';
  }
  if ((input.control || input.meta) && !input.shift && (input.key === 'L' || input.key === 'l')) {
    return 'focus-url';
  }
  if (input.control || input.meta) {
    // '+' 与 '=' 同键（Shift 加号）：两者都算放大；小键盘 +/- 的 key 也是 '+'/'-'
    if (input.key === '=' || input.key === '+') return 'zoom-in';
    if (input.key === '-' || input.key === '_') return 'zoom-out';
    if (input.key === '0') return 'zoom-reset';
  }
  if (input.key === 'Escape' && panelId) {
    return 'close-panel';
  }
  return null;
}

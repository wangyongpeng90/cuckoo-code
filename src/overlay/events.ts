/**
 * 覆盖层事件编排层
 * Task 8 起页面内只剩瞬态 UI（toast / 工具遮罩 / 重试倒计时），
 * 面板/悬浮球/快捷键/首页模式等已迁往 shell 或删除。
 * 本文件负责：token 统计、自动压缩、压缩流程（shell 按钮 relay + 刷新后续段）。
 */
import { state } from './state.js';
import { showToast } from './panel.js';
import { runCompaction, checkPendingCompact, checkPendingInit } from '../session/compaction.js';
import { getProviderByUrl } from '../providers/registry.js';
import { initTokenCounter, setIsSubagentWindow } from './token-counter.js';
import type { TokenCounter } from './token-counter.js';
import { initAutoCompact } from './auto-compact.js';
import { getCachedSettings } from './settings.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

// 回调注入（P4.2-A：overlay 不依赖 bridge）
let hooks: { onInterceptedResponse?: (cb: (text: string, meta: any) => void) => void } = {};
/** 由 bridge/entry 在初始化时注入 bridge 能力 */
function wireEvents(h: typeof hooks): void {
  hooks = h;
}

let eventsBound = false;
let tokenCounter: TokenCounter | null = null;

/** 取当前页面对应的会话 ID（无则 null） */
function getCurrentSessionId(): string | null {
  try {
    const provider = getProviderByUrl(window.location.href);
    if (provider && typeof provider.extractSessionId === 'function') {
      return provider.extractSessionId(window.location.href) || null;
    }
  } catch (_) {}
  return null;
}

/** 供 bridge 在 URL 变化时调用：刷新当前会话的 token 显示 */
function refreshTokenForCurrentSession(): void {
  void tokenCounter?.refresh();
}

/** 从设置缓存恢复发送延迟配置（发送延迟的运行态读 state，设置 UI 在 shell） */
function restoreSendDelayConfig(): void {
  try {
    const s = getCachedSettings();
    if (Number.isFinite(s.sendDelayMin) && s.sendDelayMin >= 0) state.sendDelayMin = s.sendDelayMin;
    if (Number.isFinite(s.sendDelayMax) && s.sendDelayMax >= 0) state.sendDelayMax = s.sendDelayMax;
  } catch (e) {}
}

/** 启动 token 统计 + 自动压缩（事件驱动，deps 注入组装） */
function startTokenCounter(): void {
  tokenCounter = initTokenCounter({
    getCurrentSessionId,
    onResponse: (cb) => hooks.onInterceptedResponse?.(cb),
    updateShellTokenUsage: (context, cumulative, windowCumulative, todayCumulative) => {
      try {
        window.electronAPI.updateTokenUsage(context, cumulative, windowCumulative, todayCumulative).catch(() => {});
      } catch (_) {}
    },
  });
  initAutoCompact({
    onResponse: (cb) => hooks.onInterceptedResponse?.(cb),
    triggerCompaction: () => runCompaction(state.currentProjectDir || undefined),
    notify: showToast,
  });
  void tokenCounter.refresh();
}

/**
 * 绑定覆盖层事件：设置恢复、shell 压缩 relay、token 统计、压缩流程续段检测。
 * 防止重复绑定（SPA 导航或 preload 重载时可能导致多次执行）。
 */
function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  restoreSendDelayConfig();

  // 壳页面「压缩上下文」按钮经主进程 relay 到本页面：压缩流程（清 IDB + 刷新）只能在页面侧执行
  try {
    ipcRenderer.on('shell-compact', () => {
      void runCompaction(state.currentProjectDir || undefined);
    });
  } catch (_) {}

  // 启动输入框 token 估算 + 自动压缩检查
  startTokenCounter();

  // 压缩流程：先检查是否处于"段2"（刷新后等 IDB 重建），否则检查"段3"（分享页初始化）
  checkPendingCompact().then((handled) => {
    if (!handled) checkPendingInit();
  });
}

export { bindEvents, wireEvents, refreshTokenForCurrentSession, setIsSubagentWindow };

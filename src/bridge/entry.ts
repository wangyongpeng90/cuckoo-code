/**
 * Cuckoo Code preload 入口
 * 原 preload.js 的全部逻辑拆分为本目录下的模块，此处负责组装与初始化，
 * 初始化时序与原文件保持一致。
 */
console.log('[Cuckoo Code] Preload script 开始执行');

// 暴露 electronAPI 到渲染进程（contextBridge + window 兜底）
import './api.js';

import { createRequire } from 'node:module';
import * as ui from '../overlay/panel.js';
import * as projectDir from '../overlay/project-dir.js';
import { bindEvents, refreshTokenForCurrentSession } from '../overlay/events.js';
import * as chatInput from '../overlay/chat-input.js';
import { wireEvents } from '../overlay/events.js';
import { getProviderByUrl } from '../providers/registry.js';
import { startInterceptObserver, onInterceptedResponse } from './intercept/observer.js';
import { startRetryEngine } from './loop/retry.js';
import { startSessionWatcher, startWatchdog, checkSessionChange } from './loop/watchdog.js';
import { initSubagentIfNeeded } from './subagent.js';

const require = createRequire(import.meta.url);
const { webFrame, ipcRenderer } = require('electron');

// ========== 平台识别 ==========
// 在 init 之前先判断当前平台，决定走"网络拦截"还是"DOM 抓取"模式
const currentProvider = getProviderByUrl(window.location.href);
const useIntercept = !!(currentProvider && currentProvider.useIntercept);
console.log('[Cuckoo Code] 平台=' + (currentProvider ? currentProvider.id : 'unknown') +
  ', 模式=' + (useIntercept ? '网络拦截' : 'DOM 抓取'));

// ========== 主世界注入（拦截模式）==========
// 必须在页面脚本执行前把 hook 注入到主世界，才能覆盖到 window.fetch / XHR。
// preload 早于页面脚本执行，此处的 executeJavaScript 落在主世界。
if (useIntercept) {
  try {
    if (typeof currentProvider.getHookSource === 'function') {
      webFrame.executeJavaScript(currentProvider.getHookSource()).then(
        () => console.log('[Cuckoo Code] 主世界拦截器注入成功 (' + currentProvider.id + ')'),
        (err: any) => console.error('[Cuckoo Code] 主世界拦截器注入失败:', err && err.message)
      );
    } else {
      console.warn('[Cuckoo Code] 平台 ' + currentProvider.id + ' 未提供 getHookSource()');
    }
  } catch (err) {
    console.error('[Cuckoo Code] 加载拦截器失败:', err);
  }
}

// 注册主进程消息监听（与原 preload.js 顶层注册时机一致）
chatInput.registerIpcListeners();

// ========== P4.2-A：回调注入（overlay 不依赖 bridge）==========
wireEvents({ onInterceptedResponse });

// ========== 初始化 ==========

// 用户名/会话相关状态（供 handleUrlChanged 使用）
let lastSentUserName = '';
let lastUserNameKey = '';

/**
 * URL 变化统一处理（由主进程 cuckoo-url-changed 事件 / popstate / hashchange 触发）：
 * 刷新首页模式、检测会话切换、更新窗口名。
 */
function handleUrlChanged(): void {
  try { ui.updateHomeMode(); } catch (_) {}
  try { checkSessionChange(); } catch (_) {}
  try { refreshTokenForCurrentSession(); } catch (_) {}
  try {
    const url = window.location.href;
    const m = url.match(/\/chat\/s\/([a-f0-9-]+)/i);
    const key = m ? m[1] : '(home)';
    if (key === lastUserNameKey && lastSentUserName) return;
    lastUserNameKey = key;
    const provider = getProviderByUrl(url);
    if (!provider || typeof provider.extractUserInfo !== 'function') return;
    const text = provider.extractUserInfo();
    if (text && text !== lastSentUserName) {
      lastSentUserName = text;
      (window as any).electronAPI.updateWindowName(text).catch(() => {});
    }
  } catch (_) {}
}

/**
 * 初始化 Cuckoo Code 扩展
 * 注入样式、覆盖层 HTML，绑定事件，启动回复监听（拦截或 DOM 观察）
 */
function init(): void {
  // 子代理窗口：注册完成判定（onInterceptedResponse 计数），但 overlay 照常初始化
  const isSubagent = initSubagentIfNeeded();
  if (isSubagent) {
    console.log('[Cuckoo Code] 子代理窗口：overlay + 拦截监听器照常初始化，额外挂完成判定');
  }
  try {
    ui.injectCSS();
    ui.injectOverlay();
    projectDir.initProjectDirSection();
    bindEvents();
    ui.updateHomeMode();

    // URL 变化：主进程 did-navigate/-in-page 会推 'cuckoo-url-changed'
    ipcRenderer.on('cuckoo-url-changed', handleUrlChanged);
    window.addEventListener('popstate', handleUrlChanged);
    window.addEventListener('hashchange', handleUrlChanged);
    // 首次延迟执行，确保 overlay 已注入
    setTimeout(ui.updateHomeMode, 500);

    // 默认显示覆盖层 - 兜底强制显示
    ui.forceShowOverlay();

    // 拦截模式：监听主世界注入器派发的 'cuckoo-ai-response' 事件
    startInterceptObserver();

    // 启动自动重试引擎（订阅失败事件）
    startRetryEngine();

    // 启动看门狗（订阅 SSE 流静默事件）+ 会话切换监视
    startWatchdog();
    startSessionWatcher();
  } catch (err) {
    console.error('[Cuckoo Code] init() 出错:', err);
    // 兜底：即使出错也强制显示面板
    ui.forceShowOverlay();
  }

  // 定期巡检：防止面板被意外隐藏
  ui.startOverlayWatcher();

  // 15 秒低频兜底：主进程 URL 事件若漏发（罕见路由方式），这里补一次
  setInterval(() => {
    try {
      ui.updateHomeMode();
      checkSessionChange();
    } catch (_) {}
  }, 15000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

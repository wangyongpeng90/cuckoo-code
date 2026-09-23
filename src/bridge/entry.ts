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
import { bindEvents } from '../overlay/events.js';
import * as chatInput from '../overlay/chat-input.js';
import { wireEvents } from '../overlay/events.js';
import { getProviderByUrl } from '../providers/registry.js';
import { startInterceptObserver, onInterceptedResponse } from './intercept/observer.js';
import { startRetryEngine } from './loop/retry.js';
import { startSessionWatcher, startWatchdog } from './loop/watchdog.js';

const require = createRequire(import.meta.url);
const { webFrame } = require('electron');

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

/**
 * 初始化 Cuckoo Code 扩展
 * 注入样式、覆盖层 HTML，绑定事件，启动回复监听（拦截或 DOM 观察）
 */
function init(): void {
  try {
    ui.injectCSS();
    ui.injectOverlay();
    projectDir.initProjectDirSection();
    bindEvents();
    ui.updateHomeMode();

    // 监听 URL 变化（SPA 路由）
    window.addEventListener('popstate', ui.updateHomeMode);
    window.addEventListener('hashchange', ui.updateHomeMode);
    // SPA 路由（pushState）不触发 popstate/hashchange，用低频轮询兜底：
    // 仅当 URL 变化时才执行，避免每 1.5s 都做正则+DOM 查询
    let lastHomeUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastHomeUrl) {
        lastHomeUrl = window.location.href;
        ui.updateHomeMode();
      }
    }, 1500);
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

  // 定期提取当前平台用户信息并更新窗口名
  // 优化：先做零成本的 sessionId 变化检测，未变则跳过 DOM 查询；
  // 且只在用户名变化时才发 IPC。
  let lastSentUserName = '';
  let lastUserNameKey = '';
  setInterval(() => {
    try {
      const url = window.location.href;
      const m = url.match(/\/chat\/s\/([a-f0-9-]+)/i);
      const key = m ? m[1] : '(home)';
      if (key === lastUserNameKey && lastSentUserName) return; // 会话未变且已发送过，跳过
      lastUserNameKey = key;
      const provider = getProviderByUrl(url);
      if (!provider || typeof provider.extractUserInfo !== 'function') return;
      const text = provider.extractUserInfo();
      if (text && text !== lastSentUserName) {
        lastSentUserName = text;
        (window as any).electronAPI.updateWindowName(text).catch(() => {});
      }
    } catch (e: any) {
      console.error('[Cuckoo Code] 轮询用户名异常:', e.message);
    }
  }, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

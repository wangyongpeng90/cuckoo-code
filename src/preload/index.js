/**
 * Cuckoo Code preload 入口
 * 原 preload.js 的全部逻辑拆分为本目录下的模块，此处负责组装与初始化，
 * 初始化时序与原文件保持一致。
 */
console.log('[Cuckoo Code] Preload script 开始执行');

// 暴露 electronAPI 到渲染进程（contextBridge + window 兜底）
require('./api');

const ui = require('./overlay/ui');
const projectDir = require('./overlay/project-dir');
const bindEvents = require('./overlay/events');
const observer = require('./dom/observer');
const chatInput = require('./dom/chat-input');
const state = require('./dom/state');
const { getProviderByUrl } = require('../providers');

// 检测子 Agent 窗口标识（main 通过 additionalArguments 注入）
// sandbox: false 下 preload 可访问 process.argv
try {
  const subagentArg = process.argv.find((a) => a.startsWith('--cuckoo-subagent-id='));
  if (subagentArg) {
    state.subagentId = subagentArg.split('=')[1];
    console.log('[Cuckoo Code] 检测到子 Agent 窗口标识:', state.subagentId);
  }
} catch (_) { /* 非 Electron 环境忽略 */ }

// 注册主进程消息监听（与原 preload.js 顶层注册时机一致）
chatInput.registerIpcListeners();

// ========== 初始化 ==========

/**
 * 初始化 Cuckoo Code 扩展
 * 注入样式、覆盖层 HTML，绑定事件，启动 MutationObserver 和目录监听
 */
function init() {
  try {
    ui.injectCSS();
    ui.injectOverlay();
    projectDir.initProjectDirSection();
    bindEvents();
    ui.updateHomeMode();

    // 监听 URL 变化（SPA 路由）
    window.addEventListener('popstate', ui.updateHomeMode);
    window.addEventListener('hashchange', ui.updateHomeMode);
    setInterval(ui.updateHomeMode, 1500);
    // 首次延迟执行，确保 overlay 已注入
    setTimeout(ui.updateHomeMode, 500);

    // 默认显示覆盖层 - 兜底强制显示
    ui.forceShowOverlay();

    // 延迟启动观察器，等待页面框架渲染
    setTimeout(observer.startObserver, 2000);
  } catch (err) {
    console.error('[Cuckoo Code] init() 出错:', err);
    // 兜底：即使出错也强制显示面板
    ui.forceShowOverlay();
  }

  // 定期巡检：防止面板被意外隐藏
  ui.startOverlayWatcher();

  // 定期提取当前平台用户信息并更新窗口名
  let lastSentUserName = '';
  setInterval(() => {
    try {
      const provider = getProviderByUrl(window.location.href);
      if (!provider || typeof provider.extractUserInfo !== 'function') return;
      const text = provider.extractUserInfo();
      if (text && text !== lastSentUserName) {
        lastSentUserName = text;
        window.electronAPI.updateWindowName(text).catch(() => {});
      }
    } catch (_) {}
  }, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

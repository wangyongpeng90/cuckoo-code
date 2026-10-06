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
import { bindEvents, refreshTokenForCurrentSession, setIsSubagentWindow, getAutoCompactConfig, applyAutoCompactConfig, triggerCompaction } from '../overlay/events.js';
import * as chatInput from '../overlay/chat-input.js';
import * as settingsPanel from '../overlay/panels/settings.js';
import { wireEvents } from '../overlay/events.js';
import { getProviderByUrl } from '../providers/registry.js';
import { startInterceptObserver, onInterceptedResponse, onTaskIdle, onStream, onToolCall } from './intercept/observer.js';
import { shareAllForSwitch } from '../session/compaction.js';
import { startRetryEngine } from './loop/retry.js';
import { startSessionWatcher, startWatchdog, checkSessionChange } from './loop/watchdog.js';
import { initSubagentIfNeeded } from './subagent.js';
import { initHarnessBridge } from './harness-bridge.js';
import { initProbeIfNeeded } from './probe.js';
import { initFeishuBridge } from './feishu-bridge.js';
import { initMessageFold } from '../overlay/message-fold.js';
import { initPlugins, bindPluginReload } from './plugin-system.js';

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

// ========== 插件"网页注入脚本"（scripts/*.js，按 URL 匹配注入主世界）==========
// 与平台 provider 的 hook 相互独立：这里注入的是"页面增强/优化"脚本，
// 因此可作用于内置平台（如 DeepSeek），不受"内置 provider 优先"限制。
async function injectPluginWebScripts(): Promise<void> {
  try {
    const api = (window as any).electronAPI;
    if (!api || typeof api.getPluginWebScripts !== 'function') return;
    const r = await api.getPluginWebScripts();
    const list = (r && r.success && r.scripts) || [];
    if (!list.length) return;
    const href = window.location.href;
    for (const s of list) {
      // match 支持：空(全部) / 正则字符串 / 子串
      let matched = true;
      if (s.match) {
        try { matched = new RegExp(s.match).test(href); }
        catch (_) { matched = href.indexOf(s.match) >= 0; }
      }
      if (!matched) continue;
      try {
        await webFrame.executeJavaScript(s.script);
        console.log('[Cuckoo Code][插件脚本] 已注入: ' + s.name);
      } catch (err: any) {
        console.error('[Cuckoo Code][插件脚本] 注入失败 (' + s.name + '):', err && err.message);
      }
    }
  } catch (err: any) {
    console.error('[Cuckoo Code][插件脚本] 获取失败:', err && err.message);
  }
}

// ========== P4.2-A：回调注入（overlay 不依赖 bridge）==========
wireEvents({ onInterceptedResponse, onTaskIdle, onStream });

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
  const subCfg = initSubagentIfNeeded();
  if (subCfg) {
    // 子代理窗口在新对话页，但需要完整面板 → 抑制首页模式
    try { ui.setSuppressHomeMode(true); } catch (_) { /* ignore */ }
    // 子代理共享父窗口 localStorage，不参与 token 统计（否则污染"今日窗口"）
    try { setIsSubagentWindow(true); } catch (_) { /* ignore */ }
  }
  try {
    ui.injectCSS();
    ui.injectOverlay();
    projectDir.initProjectDirSection();
    // 子代理窗口：显示继承的项目目录（它没有 project-dir-updated 事件）
    if (subCfg && subCfg.projectDir) {
      try { projectDir.updateProjectDirDisplay(subCfg.projectDir); } catch (_) { /* ignore */ }
    }
    bindEvents();
    ui.updateHomeMode();

    // URL 变化：主进程 did-navigate/-in-page 会推 'cuckoo-url-changed'
    ipcRenderer.on('cuckoo-url-changed', handleUrlChanged);
    // 设置读写（壳页面设置页 → 主进程转发 → 这里读写 localStorage，再回执）
    ipcRenderer.on('cuckoo-get-settings', (_e: any, { reqId }: any) => {
      try {
        const data = settingsPanel.getSettingsData();
        ipcRenderer.send('cuckoo-settings-result', { reqId, ok: true, data });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-settings-result', { reqId, ok: false, error: err.message });
      }
    });
    ipcRenderer.on('cuckoo-save-settings', (_e: any, { reqId, data }: any) => {
      try {
        const res = settingsPanel.applySettingsData(data);
        ipcRenderer.send('cuckoo-settings-result', { reqId, ok: res.success, data: res.success ? settingsPanel.getSettingsData() : null, error: res.error });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-settings-result', { reqId, ok: false, error: err.message });
      }
    });
    ipcRenderer.on('cuckoo-reset-settings', (_e: any, { reqId }: any) => {
      try {
        const data = settingsPanel.resetSettingsData();
        ipcRenderer.send('cuckoo-settings-result', { reqId, ok: true, data });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-settings-result', { reqId, ok: false, error: err.message });
      }
    });
    // 自动压缩配置读写（壳页面 Token 页 → 主进程转发 → 这里读写）
    ipcRenderer.on('cuckoo-get-autocompact', (_e: any, { reqId }: any) => {
      try {
        ipcRenderer.send('cuckoo-autocompact-result', { reqId, ok: true, data: getAutoCompactConfig() });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-autocompact-result', { reqId, ok: false, error: err.message });
      }
    });
    ipcRenderer.on('cuckoo-save-autocompact', (_e: any, { reqId, data }: any) => {
      try {
        const res = applyAutoCompactConfig(data);
        ipcRenderer.send('cuckoo-autocompact-result', { reqId, ok: res.success, data: res.data, error: res.error });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-autocompact-result', { reqId, ok: false, error: err.message });
      }
    });
    ipcRenderer.on('cuckoo-trigger-compact', (_e: any, { reqId }: any) => {
      try {
        triggerCompaction();
        ipcRenderer.send('cuckoo-autocompact-result', { reqId, ok: true });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-autocompact-result', { reqId, ok: false, error: err.message });
      }
    });
    // 窗口组切换：主进程请求"全量分享当前会话"，回执 shareId
    ipcRenderer.on('cuckoo-switch-share', async (_e: any, { reqId }: any) => {
      try {
        const r = await shareAllForSwitch();
        ipcRenderer.send('cuckoo-switch-share-result', { reqId, ok: true, shareId: r.shareId, sessionId: r.sessionId });
      } catch (err: any) {
        ipcRenderer.send('cuckoo-switch-share-result', { reqId, ok: false, error: err.message });
      }
    });
    // 追加文本到输入框末尾（MCP 名等，不发送）
    ipcRenderer.on('cuckoo-append-input', (_e: any, data: any) => {
      try {
        const text = data && data.text;
        if (typeof text === 'string' && text) {
          chatInput.appendTextToInput(text);
        }
      } catch (err: any) {
        console.error('[Cuckoo Code] 追加文本失败:', err.message);
      }
    });
    // 快捷提示词：主进程（由壳页面触发）→ 填入输入框（+ 可选发送）
    ipcRenderer.on('cuckoo-trigger-snippet', (_e: any, data: any) => {
      try {
        const content = data && data.content;
        const autoSend = !!(data && data.autoSend);
        if (typeof content === 'string' && content) {
          chatInput.insertSnippet(content, autoSend);
        }
      } catch (err: any) {
        console.error('[Cuckoo Code] 处理快捷提示词失败:', err.message);
      }
    });
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

    // 纯净对话模式：把回复/工具调用上报主进程，并接收用户消息
    initHarnessBridge();

    // 飞书同步：上报用户消息/AI回复/工具状态，并接收飞书来消息
    initFeishuBridge();

    // Cuckoo 插件系统：加载 dsh/*.js 风格插件（异步，不阻塞）
    initPlugins().catch((err: any) => {
      console.error('[Cuckoo Code] 加载 DSH 插件失败:', err && err.message ? err.message : err);
    });
    // 监听插件热重载通知（启用/禁用插件时主进程推送）
    bindPluginReload();

    // 窗口组探测：若本次导航带 cuckoo-probe 标记，发测试消息判限流
    initProbeIfNeeded();

    // 插件网页注入脚本（按 URL 匹配注入主世界）
    injectPluginWebScripts();
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

  // 消息折叠：把「【JS 执行结果汇总】」等渲染成工具卡片
  try { initMessageFold(); } catch (err) { console.error('[Cuckoo Code] initMessageFold 失败:', err); }

  // 实时工具状态：订阅工具开始/结束 → 更新小窗
  try {
    onToolCall((ev: any) => {
      if (ev.phase === 'start') ui.showToolMask(undefined, ev.code || '');
      else if (ev.phase === 'end') ui.setToolMaskDone(!!ev.success);
    });
  } catch (err) { console.error('[Cuckoo Code] onToolCall 订阅失败:', err); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

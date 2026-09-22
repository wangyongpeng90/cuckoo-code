/**
 * 覆盖层按钮事件绑定（编排层）
 * P4.5 拆分：窗口面板 → panels/window-manager、MCP 面板 → panels/mcp-manager、
 * 设置弹窗 → panels/settings、悬浮球拖动 → fab.js。
 */
import { state } from './state.js';
import { hideOverlay, showOverlay, renderHistory, commandHistory, showToast, hideFirstTimeDialog } from './panel.js';
import { handleInitProject, renderSessions } from './session-list.js';
import { sendToChat } from './chat-input.js';
import { runCompaction, checkPendingCompact, checkPendingInit } from '../session/compaction.js';
import { renderWindowList, openWindowManager, closeWindowManager, handleGenerateDoc } from './panels/window-manager.js';
import { loadMcpConfigToJson, renderMcpList, openMcpManager, closeMcpManager, handleMcpSave } from './panels/mcp-manager.js';
import { openSettings, closeSettings, resetSettings, saveSettings } from './panels/settings.js';
import { makeFabDraggable } from './fab.js';

// 回调注入（P4.2-A：overlay 不依赖 bridge）
let hooks: { onInterceptedResponse?: (cb: (text: string, meta: any) => void) => void } = {};
// 服务端权威 token 统计（由 bridge 经回调推送，不共享状态）
let serverTokenUsage: any = null;
/** 由 bridge/entry 在初始化时注入 bridge 能力 */
function wireEvents(h: typeof hooks): void {
  hooks = h;
}

let eventsBound = false;

/**
 * 「卡住了?点我」按钮：向 AI 发一句继续，催促其接着之前的工作
 */
function handleManualParseDispatch() {
  if (!sendToChat('刚才卡住了请继续 爱你哦', '继续', 300)) {
    showToast('发送失败：未找到输入框', 3000);
    return;
  }
  showToast('已发送：继续', 2500);
}

/**
 * 格式化 token 数：过万显示为「xxx万」，否则原样显示
 */
function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 10000) {
    return (n / 10000).toFixed(2) + '万';
  }
  return String(Math.round(n));
}

/**
 * 刷新面板里的「对话 Token」显示
 * 数据来源：服务端 accumulated_token_usage（含 prompt+输出）；未收到时显示 0。
 */
function updateConversationTokenDisplay() {
  const countEl = document.getElementById('cuckoo-conv-token-count');
  if (!countEl) return;

  const server = serverTokenUsage;
  if (server && typeof server.accumulatedTokens === 'number') {
    countEl.textContent = formatTokenCount(server.accumulatedTokens);
  } else {
    countEl.textContent = '0';
  }
}

// ========== 自动压缩上下文 ==========
// 配置：是否启用 + 阈值（单位：万 token）
let autoCompactEnabled = false;
let autoCompactThresholdWan = 80;
// 防止压缩过程中重复触发
let autoCompactTriggering = false;

/** 从 localStorage 读取自动压缩配置并同步到 UI */
function loadAutoCompactConfig() {
  try {
    const en = localStorage.getItem('cuckoo-auto-compact-enabled');
    const th = localStorage.getItem('cuckoo-auto-compact-threshold');
    autoCompactEnabled = en === '1';
    autoCompactThresholdWan = th ? (parseFloat(th) || 80) : 80;
  } catch (_) {}
  const enEl = document.getElementById('cuckoo-auto-compact-enabled');
  const thEl = document.getElementById('cuckoo-auto-compact-threshold');
  if (enEl) (enEl as any).checked = autoCompactEnabled;
  if (thEl) (thEl as any).value = autoCompactThresholdWan;
}

/** 保存自动压缩配置 */
function saveAutoCompactConfig() {
  const enEl = document.getElementById('cuckoo-auto-compact-enabled');
  const thEl = document.getElementById('cuckoo-auto-compact-threshold');
  const enabled = !!(enEl && (enEl as any).checked);
  let th = thEl ? parseFloat((thEl as any).value) : 80;
  if (!Number.isFinite(th) || th <= 0) {
    showToast('阈值需为正数（万）', 3000);
    return;
  }
  autoCompactEnabled = enabled;
  autoCompactThresholdWan = th;
  try {
    localStorage.setItem('cuckoo-auto-compact-enabled', enabled ? '1' : '0');
    localStorage.setItem('cuckoo-auto-compact-threshold', String(th));
  } catch (_) {}
  showToast('自动压缩设置已保存：' + (enabled ? '开启，阈值 ' + th + ' 万' : '关闭'), 2500);
}

/**
 * 检查是否触发自动压缩
 * 数据源：state.serverTokenUsage.accumulatedTokens
 */
function checkAutoCompact() {
  if (!autoCompactEnabled || autoCompactTriggering) return;
  const server = serverTokenUsage;
  if (!server || typeof server.accumulatedTokens !== 'number') return;
  const thresholdTokens = autoCompactThresholdWan * 10000;
  if (server.accumulatedTokens < thresholdTokens) return;
  // 触发
  autoCompactTriggering = true;
  console.log('[Cuckoo Compact] 自动触发：当前 ' + server.accumulatedTokens + ' >= 阈值 ' + thresholdTokens);
  showToast('Token 超阈值（' + autoCompactThresholdWan + '万），自动压缩中...', 4000);
  runCompaction(state.currentProjectDir || undefined).finally(() => {
    // 压缩会跳转页面；若未跳转（失败），重置标志允许下次重试
    autoCompactTriggering = false;
  });
}

/**
 * 启动对话 token 显示 + 自动压缩检查（事件驱动）
 * 仅在收到成功回复事件时刷新 token 显示并检查自动压缩，
 * 避免失败/停止时因旧 token 值反复触发压缩。
 */
function startTokenCounter() {
  hooks.onInterceptedResponse?.((_text: string, meta: any) => {
    serverTokenUsage = (meta && meta.tokenUsage) || null;
    updateConversationTokenDisplay();
    checkAutoCompact();
  });
  updateConversationTokenDisplay();
}

/**
 * 绑定覆盖层所有 UI 事件
 * 包括按钮点击、键盘快捷键、状态徽章点击等
 */
function bindEvents() {
  // 防止重复绑定（SPA 导航或 preload 重载时可能导致多次执行）
  if (eventsBound) return;
  eventsBound = true;

  // 从 localStorage 恢复延迟配置
  try {
    const savedMin = localStorage.getItem('cuckoo-send-delay-min');
    const savedMax = localStorage.getItem('cuckoo-send-delay-max');
    if (savedMin) state.sendDelayMin = parseInt(savedMin, 10) || 2000;
    if (savedMax) state.sendDelayMax = parseInt(savedMax, 10) || 4000;
    // 同步到输入框
    const minInput = document.getElementById('cuckoo-delay-min');
    const maxInput = document.getElementById('cuckoo-delay-max');
    if (minInput) (minInput as any).value = state.sendDelayMin;
    if (maxInput) (maxInput as any).value = state.sendDelayMax;
  } catch (e) {}

  const minimizeBtn = document.getElementById('cuckoo-btn-minimize');
  const initBtn = document.getElementById('cuckoo-btn-init');
  const clearBtn = document.getElementById('cuckoo-btn-clear');

  minimizeBtn?.addEventListener('click', hideOverlay);
  initBtn?.addEventListener('click', handleInitProject);

  // 压缩上下文按钮
  const compactBtn = document.getElementById('cuckoo-btn-compact');
  compactBtn?.addEventListener('click', () => runCompaction(state.currentProjectDir || undefined));

  // 首次使用提示浮窗：初始化按钮（与右侧初始化项目逻辑一致）
  const firstInitBtn = document.getElementById('cuckoo-btn-first-init');
  firstInitBtn?.addEventListener('click', handleInitProject);

  // 首次使用提示浮窗：关闭按钮
  const firstCloseBtn = document.getElementById('cuckoo-btn-first-close');
  firstCloseBtn?.addEventListener('click', hideFirstTimeDialog);
  clearBtn?.addEventListener('click', () => {
    commandHistory.length = 0;
    renderHistory();
  });

  // 手动解析按钮
  const manualParseBtn = document.getElementById('cuckoo-btn-manual-parse');
  manualParseBtn?.addEventListener('click', handleManualParseDispatch);

  // 窗口管理按钮：打开浮动管理面板
  const windowManagerBtn = document.getElementById('cuckoo-btn-window-manager');
  windowManagerBtn?.addEventListener('click', () => {
    openWindowManager();
  });

  // MCP 按钮：打开 MCP 管理面板
  const mcpBtn = document.getElementById('cuckoo-btn-mcp');
  mcpBtn?.addEventListener('click', openMcpManager);

  // MCP 面板：关闭
  const mcpCloseBtn = document.getElementById('cuckoo-mcp-close');
  mcpCloseBtn?.addEventListener('click', closeMcpManager);

  // MCP 面板：刷新
  const mcpRefreshBtn = document.getElementById('cuckoo-mcp-refresh');
  mcpRefreshBtn?.addEventListener('click', renderMcpList);

  // MCP 面板：保存配置
  const mcpSaveBtn = document.getElementById('cuckoo-mcp-save');
  mcpSaveBtn?.addEventListener('click', () => handleMcpSave(sendToChat));

  // 浮动面板：新建窗口（不指定平台，让窗口显示平台选择页）
  const wmNewWindowBtn = document.getElementById('cuckoo-wm-new-window');
  wmNewWindowBtn?.addEventListener('click', async () => {
    try {
      await (window as any).electronAPI.createProfileWindow();
      showToast('已打开平台选择', 2200);
      await renderWindowList();
    } catch (err: any) {
      showToast('创建新窗口失败: ' + (err.message || err), 3000);
    }
  });

  // 浮动面板：关闭
  const wmCloseBtn = document.getElementById('cuckoo-wm-close');
  wmCloseBtn?.addEventListener('click', closeWindowManager);

  // 浮动面板：刷新列表
  const wmRefreshBtn = document.getElementById('cuckoo-wm-refresh');
  wmRefreshBtn?.addEventListener('click', renderWindowList);

  // 生成项目说明文档按钮
  const genDocBtn = document.getElementById('cuckoo-btn-gen-doc');
  genDocBtn?.addEventListener('click', () => handleGenerateDoc(sendToChat));

  // 沉浸式交流按钮
  const immersiveBtn = document.getElementById('cuckoo-btn-immersive');
  immersiveBtn?.addEventListener('click', () => {
    const message = '现在你的任何疑问,或没有疑问的选择都需要和我确认 , 确认的方式是 你问一个问题我回答一个问题,然后你再问下一个问题, 最好给我选项, 也要给我个其他的选项, 谢谢 爱你哦';
    if (!sendToChat(message, '沉浸式交流', 300)) {
      showToast('未找到输入框，请确保已打开聊天界面', 3000);
    } else {
      showToast('已发送沉浸式交流提示', 2200);
    }
  });

  // 刷新会话列表按钮
  const refreshSessionsBtn = document.getElementById('cuckoo-btn-refresh-sessions');
  refreshSessionsBtn?.addEventListener('click', renderSessions);

  // 设置弹窗：打开
  const settingsBtn = document.getElementById('cuckoo-btn-settings');
  settingsBtn?.addEventListener('click', openSettings);

  // 设置弹窗：关闭
  const settingsCloseBtn = document.getElementById('cuckoo-settings-close');
  settingsCloseBtn?.addEventListener('click', closeSettings);

  // 设置弹窗：保存
  const settingsSaveBtn = document.getElementById('cuckoo-settings-save');
  settingsSaveBtn?.addEventListener('click', saveSettings);

  // 设置弹窗：恢复默认
  const settingsResetBtn = document.getElementById('cuckoo-settings-reset');
  settingsResetBtn?.addEventListener('click', resetSettings);

  // 悬浮球：可拖动 + 点击切换面板显隐
  const statusBadge = document.getElementById('cuckoo-status-badge');
  if (statusBadge) makeFabDraggable(statusBadge);
  statusBadge?.addEventListener('click', () => {
    const overlay = document.getElementById('cuckoo-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('cuckoo-hidden')) {
      showOverlay();
    } else {
      hideOverlay();
    }
  });

  // 自动压缩：加载配置 + 绑定保存按钮
  loadAutoCompactConfig();
  const autoSaveBtn = document.getElementById('cuckoo-auto-compact-save');
  autoSaveBtn?.addEventListener('click', saveAutoCompactConfig);

  // 启动输入框 token 估算 + 自动压缩检查
  startTokenCounter();

  // 压缩流程：先检查是否处于"段2"（刷新后等 IDB 重建），否则检查"段3"（分享页初始化）
  checkPendingCompact().then((handled) => {
    if (!handled) checkPendingInit();
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+C 切换覆盖层显示
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      const overlay = document.getElementById('cuckoo-overlay');
      if (overlay) {
        if (overlay.classList.contains('cuckoo-hidden')) {
          showOverlay();
        } else {
          hideOverlay();
        }
      }
    }
    // Esc 隐藏覆盖层和窗口管理面板
    if (e.key === 'Escape') {
      hideOverlay();
      closeWindowManager();
      closeMcpManager();
      closeSettings();
      hideFirstTimeDialog();
    }
  });
}

export { bindEvents, wireEvents };

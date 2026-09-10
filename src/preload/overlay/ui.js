/**
 * 覆盖层 UI 基础能力：注入、提示、历史记录、徽章、面板显隐与巡检
 * 由原 preload.js 拆分而来，逻辑保持不变。
 */
const { OVERLAY_HTML, OVERLAY_CSS } = require('./template');
const { getProviderByUrl } = require('../../../src/providers');
const state = require('../dom/state');

// ========== 注入样式 ==========
/**
 * 注入覆盖层 CSS 样式到页面头部
 */
function injectCSS() {
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
}

// ========== 注入覆盖层 HTML ==========
/**
 * 注入覆盖层 HTML 到页面 body
 * 创建 cuckoo-root 容器并填充 OVERLAY_HTML 内容
 */
function injectOverlay() {
  const container = document.createElement('div');
  container.id = 'cuckoo-root';
  container.innerHTML = OVERLAY_HTML;
  document.body.appendChild(container);
}

// ========== 覆盖层逻辑 ==========

let currentCommand = null;
let isExecuting = false;
let commandIdCounter = 0;
const commandHistory = [];

/**
 * 生成唯一命令 ID
 * @returns {string} 格式为 cmd_时间戳_序号 的唯一标识
 */
function generateId() {
  return `cmd_${Date.now()}_${++commandIdCounter}`;
}

/**
 * 格式化时间戳为 HH:mm:ss 格式
 * @param {number} ts - 时间戳（毫秒）
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 截断文本到指定长度，超出部分以 ... 结尾
 * @param {string} text - 要截断的文本
 * @param {number} maxLen - 最大长度，默认 50
 * @returns {string} 截断后的文本
 */
function truncate(text, maxLen = 50) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen) + '...';
}

/**
 * HTML 转义，防止 XSS 攻击
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的 HTML 字符串
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 显示浮动提示弹窗
 * @param {string} text - 提示文本
 * @param {number} duration - 显示时长（毫秒），默认 2200
 */
function showToast(text, duration = 2200) {
  let toast = document.getElementById('cuckoo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cuckoo-toast';
    toast.className = 'cuckoo-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * 显示带确认/取消按钮的持久提示框（不点击就一直存在）
 * @param {string} text - 提示文本
 * @param {object} [options] - 可选配置
 * @param {string} [options.okText] - 确定按钮文字，默认「确定」
 * @param {boolean} [options.showCancel] - 是否显示取消按钮，默认 false
 * @param {string} [options.cancelText] - 取消按钮文字，默认「取消」
 * @returns {Promise<boolean>} 用户点确定 resolve(true)，点取消 resolve(false)
 */
function showConfirmDialog(text, options) {
  const opts = options || {};
  const okText = opts.okText || '确定';
  const showCancel = !!opts.showCancel;
  const cancelText = opts.cancelText || '取消';

  // 移除旧弹窗
  const old = document.getElementById('cuckoo-confirm-dialog');
  if (old) old.remove();

  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.id = 'cuckoo-confirm-dialog';
    dialog.style.cssText = `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2147483648;
      min-width: 280px; max-width: 380px;
      background: rgba(22, 24, 44, 0.96);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(139, 147, 255, 0.35);
      border-radius: 14px;
      padding: 20px 18px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      color: #dde1ff; font-size: 13px; line-height: 1.6;
      box-shadow: 0 16px 50px rgba(0, 0, 0, 0.55);
      text-align: center;
    `;
    const cancelBtnHtml = showCancel
      ? `<button id="cuckoo-confirm-cancel" style="
          padding: 9px 24px; border: 1px solid rgba(139,147,255,0.4); border-radius: 10px;
          background: transparent; color: #aab0ff;
          font-size: 13px; font-weight: 600; cursor: pointer;
          margin-right: 10px; transition: all 0.2s;
        ">${cancelText}</button>`
      : '';
    dialog.innerHTML = `
      <div style="margin-bottom:16px;white-space:pre-wrap;word-break:break-word;">${text}</div>
      <div>${cancelBtnHtml}
        <button id="cuckoo-confirm-ok" style="
          padding: 9px 28px; border: none; border-radius: 10px;
          background: linear-gradient(135deg, #8b93ff, #6d76ff); color: #fff;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        ">${okText}</button>
      </div>
    `;
    document.body.appendChild(dialog);

    const cleanup = () => dialog.remove();
    dialog.querySelector('#cuckoo-confirm-ok').addEventListener('click', () => {
      cleanup();
      resolve(true);
    });
    if (showCancel) {
      dialog.querySelector('#cuckoo-confirm-cancel').addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
    }
  });
}

/**
 * 设置任务状态（检测到任务：后面的执行中提示）
 * @param {boolean} running - 是否执行中
 */
function setTaskStatus(running) {
  const status = document.getElementById('cuckoo-task-status');
  if (status) {
    status.classList.toggle('cuckoo-hidden', !running);
  }
}

/**
 * 显示覆盖层（移除 hidden 类）
 */
function showOverlay() {
  const el = document.getElementById('cuckoo-overlay');
  if (el) el.classList.remove('cuckoo-hidden');
}

/**
 * 隐藏覆盖层（添加 hidden 类）
 */
function hideOverlay() {
  const el = document.getElementById('cuckoo-overlay');
  if (el) el.classList.add('cuckoo-hidden');
}

/**
 * 显示命令预览并展开覆盖层
 * @param {Object} cmdData - 命令数据对象，包含 command、timestamp、id 等字段
 */
function displayCommand(cmdData) {
  currentCommand = cmdData;
  const preview = document.getElementById('cuckoo-cmd-preview');
  const resultSection = document.getElementById('cuckoo-result-section');
  if (preview) preview.textContent = cmdData.command;
  if (resultSection) resultSection.classList.add('cuckoo-hidden');
  showToast('发现可执行的命令');
}

/**
 * 确认执行当前显示的命令
 * 已移除：确认执行按钮及相关交互。保留空函数以防其他引用。
 */
async function handleExecute() {
}

/**
 * 忽略当前命令
 * 已移除：忽略按钮及相关交互。保留空函数以防其他引用。
 */
function handleIgnore() {
}

/**
 * 添加一条历史记录
 * @param {Object} entry - 历史记录对象，包含 id、command、success、canceled、output、timestamp 等字段
 */
function addHistory(entry) {
  commandHistory.unshift(entry);
  if (commandHistory.length > 50) commandHistory.pop();
  renderHistory();
}

/**
 * 渲染历史记录列表
 * 将 commandHistory 中的记录渲染到界面，并为每条记录绑定点击事件以查看详情
 */
function renderHistory() {
  const list = document.getElementById('cuckoo-history-list');
  if (!list) return;

  if (commandHistory.length === 0) {
    list.innerHTML = '<div style="color:#666;font-size:12px;font-style:italic;padding:8px 0;">暂无记录</div>';
    return;
  }

  const items = commandHistory.slice(0, 20);
  list.innerHTML = items.map((item) => `
    <div class="cuckoo-history-item" data-id="${escapeHtml(item.id)}">
      <span class="cuckoo-cmd-text">${escapeHtml(truncate(item.command, 60))}</span>
      <span class="cuckoo-cmd-status ${item.canceled ? '' : item.success ? 'success' : 'error'}">
        ${item.canceled ? '⏹ 已忽略' : item.success ? '✅ 成功' : '❌ 失败'}
      </span>
      <span class="cuckoo-cmd-time">${formatTime(item.timestamp)}</span>
    </div>
  `).join('');

  list.querySelectorAll('.cuckoo-history-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const entry = commandHistory.find((h) => h.id === id);
      if (entry) {
        const preview = document.getElementById('cuckoo-cmd-preview');
        const resultSection = document.getElementById('cuckoo-result-section');
        const resultStatus = document.getElementById('cuckoo-result-status');
        const resultOutput = document.getElementById('cuckoo-result-output');
        if (preview) preview.textContent = entry.command;
        if (entry.output && resultSection) {
          resultSection.classList.remove('cuckoo-hidden');
          if (resultStatus) {
            resultStatus.textContent = entry.canceled ? '⏹ 已忽略' : entry.success ? '✅ 执行成功' : '❌ 执行失败';
            resultStatus.className = `cuckoo-result-status ${entry.success ? 'success' : 'error'}`;
          }
          if (resultOutput) resultOutput.textContent = entry.output || '(无输出)';
        }
        showOverlay();
      }
    });
  });
}

/**
 * 闪烁状态徽章提示
 */
function flashBadge() {
  const badge = document.getElementById('cuckoo-status-badge');
  const dot = document.getElementById('cuckoo-status-dot');
  if (badge) {
    badge.style.background = 'rgba(124,255,178,0.25)';
    badge.style.borderColor = 'rgba(124,255,178,0.6)';
    setTimeout(() => {
      badge.style.background = 'rgba(139, 147, 255, 0.22)';
      badge.style.borderColor = 'rgba(139, 147, 255, 0.4)';
    }, 3000);
  }
  if (dot) {
    dot.style.background = '#ffc107';
    dot.style.animation = 'none';
    setTimeout(() => {
      dot.style.background = '#7cffb2';
      dot.style.animation = 'cuckoo-pulse 2s infinite';
    }, 3000);
  }
}

/**
 * 根据当前 URL 切换覆盖层首页模式
 * 首页 https://chat.deepseek.com/ 时，只保留「初始化项目」按钮，隐藏其他内容
 * 同时展示首次使用提示浮窗（居中）
 */
function updateHomeMode() {
  const url = window.location.href;
  const provider = getProviderByUrl(url);
  const isHome = provider && provider.homeUrlPattern ? provider.homeUrlPattern.test(url) : false;
  const overlay = document.getElementById('cuckoo-overlay');
  if (overlay) {
    if (isHome) {
      overlay.classList.add('cuckoo-home-mode');
      showFirstTimeDialog();
    } else {
      overlay.classList.remove('cuckoo-home-mode');
      hideFirstTimeDialog();
    }
  }
}

/**
 * 显示首次使用提示浮窗（居中）
 */
function showFirstTimeDialog() {
  // 子 Agent 窗口不显示首次使用提示（projectDir 由主进程 pendingProjectDir 注入，无需用户操作）
  if (state.subagentId) {
    hideFirstTimeDialog();
    return;
  }
  if (state.currentProjectDir) {
    hideFirstTimeDialog();
    return;
  }
  const dialog = document.getElementById('cuckoo-first-time-dialog');
  if (dialog) dialog.classList.remove('cuckoo-hidden');
}

/**
 * 隐藏首次使用提示浮窗
 */
function hideFirstTimeDialog() {
  const dialog = document.getElementById('cuckoo-first-time-dialog');
  if (dialog) dialog.classList.add('cuckoo-hidden');
}

/**
 * 强制显示覆盖层（移除所有隐藏状态）
 * 用于兜底恢复因异常被隐藏的面板
 */
function forceShowOverlay() {
  const overlay = document.getElementById('cuckoo-overlay');
  if (overlay) {
    overlay.classList.remove('cuckoo-hidden');
    overlay.style.transform = 'translateX(0)';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
  }
}

/**
 * 启动定期巡检，防止面板被意外隐藏（最小化、ESC、脚本错误等）
 * 每 5 秒检查一次，如果被隐藏则自动恢复
 */
function startOverlayWatcher() {
  // 方向 C：不再定期强制弹出面板，避免遮挡主界面。
}

module.exports = {
  injectCSS,
  injectOverlay,
  generateId,
  formatTime,
  truncate,
  escapeHtml,
  showToast,
  showConfirmDialog,
  setTaskStatus,
  showOverlay,
  hideOverlay,
  displayCommand,
  handleExecute,
  handleIgnore,
  addHistory,
  renderHistory,
  commandHistory,
  flashBadge,
  updateHomeMode,
  showFirstTimeDialog,
  hideFirstTimeDialog,
  forceShowOverlay,
  startOverlayWatcher,
};

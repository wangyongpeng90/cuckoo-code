/**
 * 重试倒计时浮层（overlay 侧 UI 组件）
 * 由 bridge/loop/retry.ts 调用，bridge 不再直接操作本组件 DOM。
 * DOM 结构对应 template/overlay.css 中的 .cuckoo-retry-countdown 样式，
 * 通过 dom.ts 的 h() 构建（字符串一律走 textNode，无 HTML 注入面）。
 */
import { h } from './dom.js';

let box: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let cancelHandler: (() => void) | null = null;

function ensureBox(): HTMLElement {
  if (box && box.isConnected) return box;
  textEl = h('span', null, '等待重试...');
  textEl.id = 'cuckoo-retry-countdown-text';
  const cancelBtn = h('button', {
    class: 'cuckoo-btn-text',
    onClick: () => { if (cancelHandler) cancelHandler(); },
  }, '取消');
  cancelBtn.id = 'cuckoo-retry-cancel';
  box = h('div', { class: 'cuckoo-retry-countdown cuckoo-hidden' },
    h('div', { class: 'cuckoo-retry-countdown-inner' }, textEl, cancelBtn));
  box.id = 'cuckoo-retry-countdown';
  document.body.appendChild(box);
  return box;
}

/**
 * 显示（或更新）重试倒计时浮层
 * @param sec 剩余秒数
 * @param onCancel 点击「取消」按钮时触发
 */
function showRetryCountdown(sec: number, onCancel?: () => void): void {
  ensureBox();
  cancelHandler = onCancel || null;
  if (textEl) textEl.textContent = '请求失败，' + sec + ' 秒后自动重试...';
  box!.classList.remove('cuckoo-hidden');
}

/**
 * 隐藏重试倒计时浮层，并清除取消回调
 */
function hideRetryCountdown(): void {
  if (box) box.classList.add('cuckoo-hidden');
  cancelHandler = null;
}

export { showRetryCountdown, hideRetryCountdown };

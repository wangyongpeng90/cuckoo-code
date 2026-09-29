/**
 * 覆盖层瞬态 UI：注入样式/模板、轻提示（toast）、工具执行遮罩。
 * Task 8 起主面板/悬浮球/弹窗/历史等已迁往 shell 侧栏，页面内只保留瞬态元素。
 */
import { OVERLAY_HTML, OVERLAY_CSS } from './template.generated.js';

// ========== 注入样式 ==========
/**
 * 注入覆盖层 CSS 样式到页面头部
 */
function injectCSS(): void {
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
}

// ========== 注入覆盖层 HTML ==========
/**
 * 注入覆盖层 HTML 到页面 body
 * 创建 cuckoo-root 容器并填充 OVERLAY_HTML 内容
 */
function injectOverlay(): void {
  const container = document.createElement('div');
  container.id = 'cuckoo-root';
  container.innerHTML = OVERLAY_HTML;
  document.body.appendChild(container);
}

/**
 * 显示浮动提示弹窗
 * @param text - 提示文本
 * @param duration - 显示时长（毫秒），默认 2200
 */
function showToast(text: string, duration: number = 2200): void {
  let toast = document.getElementById('cuckoo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cuckoo-toast';
    toast.className = 'cuckoo-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  requestAnimationFrame(() => toast!.classList.add('show'));
  clearTimeout((showToast as any)._timer);
  (showToast as any)._timer = setTimeout(() => {
    toast!.classList.remove('show');
  }, duration);
}

/**
 * 显示工具调用遮罩（执行工具期间阻止用户操作）
 * @param onCancel 传入时显示「停止」按钮（等待发送阶段用），点击触发该回调
 */
function showToolMask(onCancel?: () => void): void {
  const el = document.getElementById('cuckoo-tool-mask');
  if (el) el.classList.remove('cuckoo-hidden');
  const btn = document.getElementById('cuckoo-tool-mask-cancel') as any;
  if (btn) {
    if (onCancel) {
      btn.classList.remove('cuckoo-hidden');
      btn.onclick = () => {
        try { onCancel(); } catch (_) { /* ignore */ }
      };
    } else {
      btn.classList.add('cuckoo-hidden');
      btn.onclick = null;
    }
  }
}

/**
 * 隐藏工具调用遮罩
 */
function hideToolMask(): void {
  const el = document.getElementById('cuckoo-tool-mask');
  if (el) el.classList.add('cuckoo-hidden');
  const btn = document.getElementById('cuckoo-tool-mask-cancel') as any;
  if (btn) { btn.classList.add('cuckoo-hidden'); btn.onclick = null; }
}

export {
  injectCSS,
  injectOverlay,
  showToast,
  showToolMask,
  hideToolMask,
};

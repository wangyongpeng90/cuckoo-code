/**
 * 网关 Provider（OpenAI 兼容 /chat/completions）
 *
 * 与 chatgpt.com / deepseek 等"网页 Provider"的区别：
 * - 页面是内置的本地聊天页（file:// 协议加载，asar 内可用），
 *   不抓取任何外部站点；请求由主进程发出，API Key 永不进入渲染进程。
 * - 回复获取方式仍是"拦截模式"的事件约定：本地页在收到主进程
 *   gateway-done 广播后，自行派发 'cuckoo-ai-response' 事件，
 *   与主世界 hook 派发的事件完全同构，工具解析/回传链路零改动。
 */
const path = require('path');
const { pathToFileURL } = require('url');

// 本地聊天页地址（require 时解析一次；asar 内 file:// 由 Electron 支持）
const GATEWAY_PAGE = path.join(__dirname, '..', 'ui', 'gateway.html');
const GATEWAY_URL = pathToFileURL(GATEWAY_PAGE).href;

module.exports = {
  id: 'gateway',
  name: '网关 (OpenAI 兼容)',
  // 拦截模式：本页自行派发 cuckoo-ai-response，无需注入网络 hook
  useIntercept: true,
  // 本地页自行派发事件，preload 跳过网络 hook 注入
  selfDispatches: true,
  homeUrl: GATEWAY_URL,
  // 会话 URL：?session=xxx 追加在无查询参数的页面地址之后
  sessionUrlBase: GATEWAY_URL + '?session=',

  // 本地聊天页即工作页，不进入"首页模式"（覆盖层始终完整显示）

  isElementVisible(el) {
    if (!el) return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  },

  findInput() {
    try {
      const el = document.querySelector('#gateway-input');
      return this.isElementVisible(el) ? el : null;
    } catch (_) { return null; }
  },

  findSendButton() {
    try {
      const btn = document.querySelector('#gateway-send');
      return this.isElementVisible(btn) && !btn.disabled ? btn : null;
    } catch (_) { return null; }
  },

  /**
   * 站点原生发送：把输入框文本经 CustomEvent 跨世界交给本地页（主世界），
   * 由页面经 electronAPI 让主进程发起补全。
   * 隔离世界与主世界通过 window 上的 CustomEvent 互通（与 cuckoo-ai-response 同一机制）。
   */
  triggerSend(input) {
    const text = (input && typeof input.value === 'string') ? input.value : '';
    if (!text.trim()) return Promise.resolve(false);
    try {
      window.dispatchEvent(new CustomEvent('cuckoo-gateway-send', { detail: { text: text } }));
      return Promise.resolve(true);
    } catch (_) {
      return Promise.resolve(false);
    }
  },

  extractUserInfo() {
    // 本地页展示的是用户自己的网关配置：返回模型名作为窗口标识
    try {
      const el = document.querySelector('#gateway-model-label');
      return el ? el.textContent.trim() : '';
    } catch (_) { return ''; }
  },

  // 从 URL 提取会话 ID（?session=xxx 或 #session=xxx，file:// 下用 hash 触发 SPA 导航）
  extractSessionId(url) {
    if (!url) return null;
    const m = url.match(/[#?&]session=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  },

  matchesUrl(url) {
    if (!url) return false;
    // 仅匹配本地网关页，避免误吞其它 file:// 页面；
    // 会话绑定后 URL 形如 gateway.html#session=xxx，必须仍能命中
    return /(^|[\/\\])gateway\.html([?#]|$)/.test(url) && url.startsWith('file:');
  },

  // ---------- 兜底 DOM 方法（拦截模式下仅"手动解析"按钮会用） ----------

  async isResponseComplete() { return true; },

  getMessageCandidates() {
    return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
  },

  getMessageMarkdown(messageEl) { return messageEl; },

  isUserMessage(node) {
    const role = node && node.getAttribute && node.getAttribute('data-message-author-role');
    return role === 'user';
  },

  getCodeBlockLanguage() { return ''; },
};

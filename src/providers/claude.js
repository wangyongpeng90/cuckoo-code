/**
 * Claude Provider 定义
 * 基于 claude.ai 页面结构，输入框为 ProseMirror（contenteditable）。
 */
let stopBtnVisible = false;

module.exports = {
  id: 'claude',
  name: 'Claude',
  // 使用网络请求拦截方式获取 AI 回复（替代 DOM 抓取）
  useIntercept: true,
  homeUrl: 'https://claude.ai/new',
  sessionUrlBase: 'https://claude.ai/chat/',

  // 判断元素是否可见（offsetWidth/offsetHeight > 0）
  isElementVisible(el) {
    if (!el) return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  },

  // 查找可见的聊天输入框（Claude 用 ProseMirror contenteditable）
  findInput() {
    const selectors = [
      'div[role="textbox"].tiptap',
      'div[role="textbox"]',
      'div.ProseMirror',
      'div[contenteditable="true"]',
      'textarea',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (this.isElementVisible(el)) return el;
      } catch (_) {}
    }
    return null;
  },

  // 查找可见且未禁用的发送按钮
  findSendButton() {
    const selectors = [
      'button[aria-label="Send message"]',
      '[data-testid="chat-input-send"]',
      'button[aria-label*="send"]',
      'button[aria-label*="Send"]',
    ];
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (this.isElementVisible(btn) && !btn.disabled) return btn;
      } catch (_) {}
    }
    return null;
  },

  // 提取当前用户信息文本（左下角账号名）
  extractUserInfo() {
    const el = document.querySelector('.df-user-menu-btn span.whitespace-nowrap.text-secondary');
    return el ? el.textContent.trim() : '';
  },

  // 首页判断正则（https://claude.ai/new 或 https://claude.ai/）
  homeUrlPattern: /^https:\/\/claude\.ai(\/new)?\/?(\?.*)?$/,

  // 从 URL 提取会话 ID（Claude 是 /chat/xxx 格式）
  extractSessionId(url) {
    if (!url) return null;
    const match = url.match(/\/chat\/([a-zA-Z0-9_-]+)/i);
    if (match) return match[1];
    return null;
  },

  // 判断 URL 是否属于本平台
  matchesUrl(url) {
    return url.includes('claude.ai');
  },

  // ========== 自动解析相关方法 ==========

  // 判断 AI 是否已完成回复（基于停止按钮的边沿触发）
  // 回答中：button[aria-label="Stop response"] 存在
  // 回答完成：该按钮消失；从存在到消失的边沿才返回 true，避免持续触发
  async isResponseComplete() {
    const stopBtn = document.querySelector('button[aria-label="Stop response"]');
    const visible = !!stopBtn;

    if (visible) {
      stopBtnVisible = true;
      return false;
    }

    // 上一次可见、本次不可见 → 回答刚结束
    if (stopBtnVisible) {
      stopBtnVisible = false;
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] Claude 回复完成，等待 500ms 后解析');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] Claude 500ms 等待结束');
      return true;
    }

    return false;
  },

  // 获取当前页面所有 AI 消息容器（排除用户消息）
  getMessageCandidates() {
    return Array.from(document.querySelectorAll('[class*="message-row"]')).filter(el => !this.isUserMessage(el));
  },

  // 从消息容器中取回复内容根节点
  getMessageMarkdown(messageEl) {
    return messageEl.querySelector('[class*="standard-markdown"]') ||
      messageEl.querySelector('div[class*="prose"]') ||
      messageEl;
  },

  // 判断节点是否位于用户消息区域内
  isUserMessage(node) {
    let current = node;
    while (current) {
      const testid = current.getAttribute?.('data-testid') || '';
      if (testid === 'user-message') return true;
      const role = current.getAttribute?.('data-role') || current.getAttribute?.('data-author') || '';
      if (role === 'user' || role === 'human') return true;
      current = current.parentElement;
    }
    const rowEl = node && node.closest ? node.closest('[class*="message-row"]') : null;
    if (rowEl && rowEl.querySelector('[data-testid="user-message"]')) return true;
    const text = (node.textContent || node.innerText || '').substring(0, 200);
    return text.includes('我已选择目录：') || text.includes('系统提示词：') || text.includes('工具使用规则：');
  },

  // 提取代码块的语言标记（Claude 使用 code[class*="language-"]）
  getCodeBlockLanguage(pre) {
    if (!pre) return '';
    const codeEl = pre.querySelector('code');
    const els = [codeEl, pre].filter(Boolean);
    for (const el of els) {
      const cls = el.className || '';
      if (typeof cls === 'string') {
        const langMatch = cls.match(/language-([\w-]+)/);
        if (langMatch) return langMatch[1].toLowerCase();
      }
    }
    return '';
  },
};

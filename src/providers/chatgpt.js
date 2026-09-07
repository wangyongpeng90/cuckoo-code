/**
 * ChatGPT Provider 定义
 * 基于 chatgpt.com 页面结构，输入框为 ProseMirror（contenteditable）。
 */
let stopBtnVisible = false;

module.exports = {
  id: 'chatgpt',
  name: 'ChatGPT',
  homeUrl: 'https://chatgpt.com/',
  sessionUrlBase: 'https://chatgpt.com/c/',

  // 判断元素是否可见（offsetWidth/offsetHeight > 0）
  isElementVisible(el) {
    if (!el) return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  },

  // 查找可见的聊天输入框（ChatGPT 用 ProseMirror contenteditable）
  findInput() {
    const selectors = [
      'div[contenteditable="true"].ProseMirror',
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
      'button[data-testid="send-button"]',
      'button[aria-label="发送提示词"]',
      'button[aria-label*="发送"]',
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

  // 提取当前用户信息文本
  extractUserInfo() {
    const el = document.querySelector('[data-testid="profile-button"]') ||
      document.querySelector('button[aria-label*="profile"]') ||
      document.querySelector('button[aria-label*="account"]');
    if (!el) return '';
    const aria = el.getAttribute('aria-label') || '';
    return aria || el.textContent.trim();
  },

  // 首页判断正则（https://chatgpt.com/ 或 https://chatgpt.com）
  homeUrlPattern: /^https:\/\/chatgpt\.com\/?$/,

  // 从 URL 提取会话 ID（ChatGPT 是 /c/xxx 格式）
  extractSessionId(url) {
    if (!url) return null;
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/i);
    if (match) return match[1];
    return null;
  },

  // 判断 URL 是否属于本平台
  matchesUrl(url) {
    return url.includes('chatgpt.com') || url.includes('chat.openai.com');
  },

  // ========== 自动解析相关方法 ==========

  // 判断 AI 是否已完成回复（基于停止按钮的边沿触发）
  // 回答中：button[data-testid="stop-button"] 存在
  // 回答完成：该按钮消失；从存在到消失的边沿才返回 true，避免持续触发
  async isResponseComplete() {
    const stopBtn = document.querySelector('button[data-testid="stop-button"]');
    const visible = !!stopBtn;

    if (visible) {
      stopBtnVisible = true;
      return false;
    }

    // 上一次可见、本次不可见 → 回答刚结束
    if (stopBtnVisible) {
      stopBtnVisible = false;
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] ChatGPT 回复完成，等待 500ms 后解析');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] ChatGPT 500ms 等待结束');
      return true;
    }

    return false;
  },

  // 获取当前页面所有 AI 消息容器（排除用户消息）
  getMessageCandidates() {
    return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).filter(el => !this.isUserMessage(el));
  },

  // 从消息容器中取回复内容根节点
  getMessageMarkdown(messageEl) {
    return messageEl.querySelector('[class*="markdown"]') ||
      messageEl.querySelector('div[class*="prose"]') ||
      messageEl;
  },

  // 判断节点是否位于用户消息区域内
  isUserMessage(node) {
    let current = node;
    while (current) {
      const role = current.getAttribute?.('data-message-author-role') || '';
      if (role === 'user') return true;
      current = current.parentElement;
    }
    const userEl = node && node.closest ? node.closest('[data-message-author-role="user"]') : null;
    if (userEl) return true;
    const text = (node.textContent || node.innerText || '').substring(0, 200);
    return text.includes('我已选择目录：') || text.includes('系统提示词：') || text.includes('工具使用规则：');
  },

  // 提取代码块的语言标记（ChatGPT 使用 code[class*="language-"]）
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

/**
 * ChatGPT Provider 定义
 * 基于 chatgpt.com 页面结构，输入框为 ProseMirror（contenteditable）。
 */
let stopBtnVisible = false;
// 停止按钮首次出现的时间戳
let stopBtnFirstSeen = 0;
// 停止按钮需持续存在超过此阈值，才视为真正进入生成态。
// 过滤发送瞬间发送按钮↔停止按钮的短暂切换，避免误判为"回复完成"。
const MIN_GENERATING_MS = 1500;

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
  // 优先从 localStorage 的 accountSwitchSessions 读取（稳定，不受 DOM 渲染影响）；
  // 失败再回退到侧边栏 DOM 提取。
  extractUserInfo() {
    // 1. localStorage: oai/apps/accountSwitchSessions -> [0].name
    try {
      const raw = localStorage.getItem('oai/apps/accountSwitchSessions');
      if (raw) {
        const sessions = JSON.parse(raw);
        if (Array.isArray(sessions) && sessions.length > 0 && sessions[0].name) {
          return String(sessions[0].name).trim();
        }
      }
    } catch (_) {}

    // 2. 优先用常见按钮选择器
    const btn = document.querySelector('[data-testid="profile-button"]') ||
      document.querySelector('button[aria-label*="profile" i]') ||
      document.querySelector('button[aria-label*="account" i]');
    if (btn) {
      const aria = btn.getAttribute('aria-label') || '';
      if (aria) return aria.trim();
    }

    // 3. 侧边栏底部用户区：class 含 z-30 的底部固定容器
    const containers = document.querySelectorAll('nav div[class*="z-30"]');
    for (const el of containers) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('button').forEach(b => b.remove());
      const text = (clone.textContent || '').trim();
      if (text && text !== 'ChatGPT' && text.length <= 40) {
        return text;
      }
    }
    return '';
  },

  // 首页判断正则（https://chatgpt.com/ 或 https://chatgpt.com）
  homeUrlPattern: /^https:\/\/chatgpt\.com\/?$/,

  // 从 URL 提取会话 ID（ChatGPT 是 /c/xxx 格式）
  // 从 URL 提取会话 ID（ChatGPT 是 /c/{uuid} 格式）
  // 注意：创建会话过程中 URL 有中间态 /c/WEB:xxx，不能把 WEB 当会话 ID。
  // session-store 会优先使用本方法的返回值，故此处必须自行排除 WEB。
  extractSessionId(url) {
    if (!url) return null;
    // 优先匹配完整 UUID（正式会话 ID）
    const uuidMatch = url.match(/\/c\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuidMatch) return uuidMatch[1];
    // 回退通用匹配，排除中间态 WEB
    const genericMatch = url.match(/\/c\/([a-zA-Z0-9_-]+)/i);
    if (genericMatch && genericMatch[1] !== 'WEB') return genericMatch[1];
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
    const now = Date.now();

    if (visible) {
      if (!stopBtnVisible) {
        // 停止按钮首次出现，记录时间，避免发送瞬间的短暂切换被误判
        stopBtnFirstSeen = now;
      }
      stopBtnVisible = true;
      return false;
    }

    // 上一次可见、本次不可见 → 需确认生成态持续足够久，才认定为回复结束
    if (stopBtnVisible) {
      stopBtnVisible = false;
      const generatingMs = now - stopBtnFirstSeen;
      if (generatingMs < MIN_GENERATING_MS) {
        // 生成态过短：发送按钮↔停止按钮的短暂切换，忽略，避免误判完成
        console.log('[' + new Date().toISOString() + '] [Cuckoo Code] ChatGPT 停止按钮仅存在 ' + generatingMs + 'ms（<' + MIN_GENERATING_MS + 'ms），忽略本次完成信号');
        return false;
      }
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

  // 提取代码块的语言标记
  // ChatGPT 代码块的语言标签在 header 里（如 <svg/>cuckoo），不在 class 中。
  getCodeBlockLanguage(pre) {
    if (!pre) return '';
    // 1. 先尝试 class（兼容其他渲染方式）
    const codeEl = pre.querySelector('code');
    const els = [codeEl, pre].filter(Boolean);
    for (const el of els) {
      const cls = el.className || '';
      if (typeof cls === 'string') {
        const langMatch = cls.match(/language-([\w-]+)/);
        if (langMatch) return langMatch[1].toLowerCase();
      }
    }
    // 2. 从代码块 header 提取语言标签
    const header = pre.querySelector('[class*="items-center"][class*="text-sm"]');
    if (header) {
      const clone = header.cloneNode(true);
      clone.querySelectorAll('svg, button').forEach(el => el.remove());
      const langText = (clone.textContent || '').trim();
      if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(langText)) {
        return langText.toLowerCase();
      }
    }
    return '';
  },
};

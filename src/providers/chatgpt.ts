/**
 * ChatGPT Provider 定义
 * 基于 chatgpt.com 页面结构，输入框为 ProseMirror（contenteditable）。
 */
import { CHATGPT_HOOK } from './generated/hook-sources.js';

const chatgpt = {
  id: 'chatgpt',
  name: 'ChatGPT',
  // 使用网络请求拦截方式获取 AI 回复（替代 DOM 抓取）
  useIntercept: true,
  homeUrl: 'https://chatgpt.com/',
  sessionUrlBase: 'https://chatgpt.com/c/',

  // 判断元素是否可见（offsetWidth/offsetHeight > 0）
  isElementVisible(el: any) {
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
        const btn = document.querySelector(sel) as any;
        if (this.isElementVisible(btn) && !btn.disabled) return btn;
      } catch (_) {}
    }
    return null;
  },

  // 填入输入框：ChatGPT 的 ProseMirror 会把 ClipboardEvent('paste') 识别为
  // "粘贴的文件"附件（出现 .txt 卡片），文本区却为空 → 发送空内容。
  // 改用 execCommand('insertText') 直接写文本节点，与真实打字等价。
  fillInput(input: any, text: string) {
    try {
      input.focus();
      // 清空现有内容
      try {
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(input);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('delete', false, undefined);
        }
      } catch (_) {}
      // 分段插入（长文本 execCommand 可能失败）
      const CHUNK = 5000;
      for (let i = 0; i < text.length; i += CHUNK) {
        const chunk = text.slice(i, i + CHUNK);
        const ok = document.execCommand('insertText', false, chunk);
        if (!ok && i === 0) return false; // 首次就失败 → 回退 paste 逻辑
      }
      // 触发一次 input 让框架感知
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  },

  // 触发发送：ChatGPT 的 ProseMirror 输入框只认**真实键盘事件**（合成 KeyboardEvent
  // 无效，站点免疫），且发送按钮在输入框为空时不存在（选择器不稳定）。
  // 故走主进程 sendInputEvent 派发真实级 Enter（isTrusted=true），与人工按键等价。
  async triggerSend(input: any) {
    try {
      if (input && typeof input.focus === 'function') {
        try { input.focus(); } catch (_) {}
      }
      const api = (window as any).electronAPI;
      if (api && typeof api.sendEnterToChat === 'function') {
        const ok = await api.sendEnterToChat();
        if (ok) return true;
      }
    } catch (_) { /* 回退到按钮点击 */ }
    // 回退：发送按钮（有内容时才出现）
    const btn = this.findSendButton ? this.findSendButton() : null;
    if (btn) { (btn as any).click(); return true; }
    return false;
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
      const clone = el.cloneNode(true) as any;
      clone.querySelectorAll('button').forEach((b: any) => b.remove());
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
  extractSessionId(url: string): string | null {
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
  matchesUrl(url: string) {
    return url.includes('chatgpt.com') || url.includes('chat.openai.com');
  },

  // 返回注入主世界的网络拦截器源码（拦截模式使用）
  // 源码由 scripts/build-hooks.mjs 从 hooks/chatgpt.ts 打包生成（自包含 IIFE）
  getHookSource() {
    return CHATGPT_HOOK;
  },
};

export { chatgpt };


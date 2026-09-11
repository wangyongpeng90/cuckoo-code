/**
 * DeepSeek Provider 定义
 * 包含主进程和 preload 都需要的信息：
 * - 主进程：homeUrl（打开窗口）、sessionUrlBase（导航到会话）
 * - preload：输入框/发送按钮选择器、用户信息选择器、首页判断正则
 * - preload：自动解析相关方法（完成检测/消息定位/语言提取等）
 */
const STOP_BTN_SELECTOR =
  '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle.ds-button--m' +
  '.ds-button--icon-relative-m.ds-button--disabled';

const ACTION_BTN_SELECTOR =
  '[role="button"].ds-button--iconLabelTertiary';

module.exports = {
  id: 'deepseek',
  name: 'DeepSeek',
  // 使用网络请求拦截方式获取 AI 回复（替代 DOM 抓取）
  useIntercept: true,
  homeUrl: 'https://chat.deepseek.com/',
  sessionUrlBase: 'https://chat.deepseek.com/a/chat/s/',

  // 查找可见的聊天输入框
  findInput() {
    const selectors = [
      'textarea[placeholder*="message"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="输入消息"]',
      'textarea[placeholder*="ask"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="提问"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="send"]',
      'textarea[placeholder*="deepseek"]',
      'textarea[placeholder*="DeepSeek"]',
      'textarea.chat-input',
      'textarea',
      'div[contenteditable="true"]',
      '[role="textbox"]',
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
      'button[type="submit"]',
      'button[aria-label*="send"]',
      'button[aria-label*="发送"]',
      'button[title*="send"]',
      'button[title*="发送"]',
      'button[data-action="send"]',
      'button[data-type="send"]',
      '.send-btn',
      '.submit-btn',
      'button svg[data-icon="send"]',
      '[data-testid="send"]',
      '[data-testid="send-button"]',
      'button:has(svg[data-icon="arrow"])',
      'button:has(> svg)',
      'button:has(svg[data-icon="send"])',
    ];
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (this.isElementVisible(btn) && !btn.disabled) return btn;
      } catch (_) {}
    }
    return null;
  },

  // 提取当前用户信息文本（脱敏手机号/微信昵称）
  extractUserInfo() {
    const el = document.querySelector('._9d8da05');
    return el ? el.textContent.trim() : '';
  },

  // 首页判断正则（用于覆盖层首页模式）
  homeUrlPattern: /^https:\/\/chat\.deepseek\.com\/?(\?.*)?$/,

  // 从 URL 提取会话 ID
  extractSessionId(url) {
    if (!url) return null;
    const match = url.match(/\/chat\/s\/([a-f0-9-]+)/i);
    if (match) return match[1];
    const altMatch = url.match(/\/s\/([a-f0-9-]+)/i);
    return altMatch ? altMatch[1] : null;
  },

  // 判断 URL 是否属于本平台
  matchesUrl(url) {
    return url.includes('chat.deepseek.com');
  },

  // 判断元素是否可见（offsetWidth/offsetHeight > 0）
  isElementVisible(el) {
    if (!el) return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  },

  // ========== 自动解析相关方法 ==========

  // 判断 AI 是否已完成回复
  isResponseComplete() {
    try {
      let btnCount = 0;
      const messages = document.querySelectorAll('.ds-message');
      if (messages.length === 0) return false;
      const lastMessage = messages[messages.length - 1];
      const scope = lastMessage.parentElement || lastMessage;
      const actionButtons = scope.querySelectorAll(ACTION_BTN_SELECTOR);
      btnCount = actionButtons.length;
      const stopBtn = document.querySelector(STOP_BTN_SELECTOR);
      return btnCount >= 2 && !!stopBtn;
    } catch (err) {
      console.error('[Cuckoo Code] ❌ 检测 AI 完成状态出错:', err);
      return false;
    }
  },

  // 获取当前页面所有 AI 消息容器（排除用户消息）
  getMessageCandidates() {
    return Array.from(document.querySelectorAll('.ds-message')).filter(el => !this.isUserMessage(el));
  },

  // 从消息容器中取回复内容根节点
  getMessageMarkdown(messageEl) {
    return messageEl.querySelector(':scope > .ds-markdown');
  },

  // 判断节点是否位于用户消息区域内
  isUserMessage(node) {
    let current = node;
    while (current) {
      const role = current.getAttribute?.('data-role') || current.getAttribute?.('data-author') || '';
      if (role === 'user' || role === 'human') return true;
      const cls = current.className || '';
      if (typeof cls === 'string' && (cls.includes('user-message') || cls.includes('message-user') || cls.includes('human'))) {
        return true;
      }
      current = current.parentElement;
    }
    const text = (node.textContent || node.innerText || '').substring(0, 200);
    return text.includes('我已选择目录：') || text.includes('系统提示词：') || text.includes('工具使用规则：');
  },

  // 提取代码块的语言标记（小写）
  getCodeBlockLanguage(pre) {
    if (!pre) return '';
    let lang = pre.getAttribute('data-language') || '';
    if (!lang) {
      const parentDiv = pre.closest('div[data-language]');
      if (parentDiv) lang = parentDiv.getAttribute('data-language') || '';
    }
    if (!lang) {
      const codeEl = pre.querySelector('code');
      const els = [codeEl, pre].filter(Boolean);
      for (const el of els) {
        const cls = Array.from(el.classList).find((c) => c.startsWith('language-'));
        if (cls) { lang = cls.replace('language-', ''); break; }
      }
    }
    if (!lang) {
      const block = pre.closest('.md-code-block');
      if (block) {
        const banner = block.querySelector('.md-code-block-banner');
        if (banner) {
          const spans = banner.querySelectorAll('span');
          for (const span of spans) {
            if (span.closest('button')) continue;
            const t = (span.textContent || '').trim();
            if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(t)) {
              lang = t;
              break;
            }
          }
        }
      }
    }
    return (lang || '').toLowerCase();
  },
};

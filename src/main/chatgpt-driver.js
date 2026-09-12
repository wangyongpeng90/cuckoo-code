/**
 * ChatGPT 窗口驱动：在已登录的 chatgpt.com 页面里发消息、等回复、取文本
 *
 * 用于反向网关：外部请求 → 本驱动把提示词注入 ChatGPT 输入框 → 等待 assistant
 * 回复完成 → 返回纯文本。直接操作页面 DOM（executeJavaScript 注入主世界），
 * 不经过应用自身的工具调用管线，因此返回的是原始回复文本。
 *
 * exec(code) 由调用方注入（主进程里为 webContents.executeJavaScript），
 * 使本模块可在 Node 单测中离线验证。
 */

const SEND_TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 800;
const STABLE_ROUNDS = 2; // 连续 N 次文本不再增长视为完成

/**
 * 生成"发送一条消息"的注入脚本（自包含，运行在页面主世界）。
 * 返回 Promise<string>：新出现的 assistant 回复文本。
 */
function buildSendScript(prompt, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || SEND_TIMEOUT_MS;
  const pollMs = (opts && opts.pollMs) || POLL_INTERVAL_MS;
  const stableRounds = (opts && opts.stableRounds) || STABLE_ROUNDS;
  const promptJson = JSON.stringify(prompt);

  return `(async () => {
  const PROMPT = ${promptJson};
  const TIMEOUT = ${timeoutMs};
  const POLL = ${pollMs};
  const STABLE = ${stableRounds};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function visible(el) { return !!el && el.offsetWidth > 0 && el.offsetHeight > 0; }
  function findInput() {
    const sels = ['div[contenteditable="true"].ProseMirror','div[role="textbox"]','div[contenteditable="true"]','textarea'];
    for (const s of sels) { const el = document.querySelector(s); if (visible(el)) return el; }
    return null;
  }
  function findSend() {
    const sels = ['button[data-testid="send-button"]','button[aria-label*="Send"]','button[aria-label*="发送"]'];
    for (const s of sels) { const b = document.querySelector(s); if (visible(b) && !b.disabled) return b; }
    return null;
  }
  function assistantCount() {
    return document.querySelectorAll('[data-message-author-role="assistant"]').length;
  }
  function lastAssistantText() {
    const els = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!els.length) return '';
    const el = els[els.length - 1];
    const md = el.querySelector('[class*="markdown"]') || el;
    return (md.innerText || md.textContent || '').trim();
  }

  const input = findInput();
  if (!input) return { ok: false, error: '未找到 ChatGPT 输入框（可能未登录或页面未加载）' };

  const before = assistantCount();

  // 填入文本：contenteditable 用 paste 事件（兼容 React/ProseMirror）
  input.focus();
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, PROMPT); else input.value = PROMPT;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    const dt = new DataTransfer();
    dt.setData('text/plain', PROMPT);
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }

  await sleep(150);
  const btn = findSend();
  if (btn) btn.click();
  else {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keypress', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // 等待新 assistant 消息出现
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT) {
    if (assistantCount() > before) break;
    await sleep(POLL);
  }
  if (assistantCount() <= before) return { ok: false, error: '等待回复超时（未出现新消息）' };

  // 轮询直到文本稳定（连续 STABLE 次不变）
  let last = '', stable = 0;
  while (Date.now() - t0 < TIMEOUT) {
    const cur = lastAssistantText();
    if (cur && cur === last) { stable++; if (stable >= STABLE) break; }
    else stable = 0;
    last = cur;
    await sleep(POLL);
  }
  if (!last) return { ok: false, error: '回复为空' };
  return { ok: true, text: last };
})()`;
}

/**
 * 解析注入脚本的返回值（executeJavaScript 可能返回对象或 JSON 字符串）
 */
function normalizeResult(raw) {
  if (raw == null) return { ok: false, error: '页面无返回' };
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return { ok: true, text: v }; }
  }
  if (v && typeof v === 'object') {
    if (v.ok === false) return { ok: false, error: v.error || '未知错误' };
    if (typeof v.text === 'string') return { ok: true, text: v.text };
  }
  return { ok: false, error: '无法解析页面返回' };
}

/**
 * 创建驱动
 * @param {function(string):Promise<any>} exec 执行注入脚本（主进程传 webContents.executeJavaScript）
 * @param {object} [opts]
 */
function createChatgptDriver(exec, opts = {}) {
  if (typeof exec !== 'function') throw new Error('createChatgptDriver 需要 exec 函数');
  return {
    /**
     * 在 ChatGPT 页面发送一条消息并取回回复文本
     * @param {string} prompt
     * @returns {Promise<string>}
     */
    async ask(prompt) {
      if (!prompt || !String(prompt).trim()) throw new Error('prompt 不能为空');
      const script = buildSendScript(String(prompt), {
        timeoutMs: opts.timeoutMs,
        pollMs: opts.pollMs,
        stableRounds: opts.stableRounds,
      });
      const raw = await exec(script);
      const r = normalizeResult(raw);
      if (!r.ok) throw new Error(r.error);
      return r.text;
    },
  };
}

module.exports = {
  createChatgptDriver,
  buildSendScript,
  normalizeResult,
  SEND_TIMEOUT_MS,
};

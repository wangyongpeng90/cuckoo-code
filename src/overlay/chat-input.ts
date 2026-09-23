/**
 * 聊天输入框交互：查找输入框、填入与发送消息、工具结果回传
 * 由原 preload.js 拆分而来，逻辑保持不变。
 */
import { createRequire } from 'node:module';
import { state } from './state.js';
import { BT } from '../infra/markdown.js';
import { getProviderByUrl } from '../providers/registry.js';

// electron 特殊：其 index.js 导出字符串，须用 createRequire（见 P3a 手册 1.5）
const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

/**
 * 根据当前 URL 获取 provider
 */
function getCurrentProvider(): any {
  return getProviderByUrl(window.location.href);
}

/**
 * 生成随机等待时间（ms），范围由 state 配置（默认 2-4 秒）
 */
function randomDelay(): number {
  const min = typeof state.sendDelayMin === 'number' ? state.sendDelayMin : 2000;
  const max = typeof state.sendDelayMax === 'number' ? state.sendDelayMax : 4000;
  if (min >= max) return min;
  return Math.floor(Math.random() * (max - min)) + min;
}
/**
 * 将文本填入输入框（React 兼容：使用原生 value setter）
 * @param input - 输入框元素
 * @param msg - 要填入的文本
 * @returns 是否成功填入
 */
async function setInputContent(input: any, msg: string): Promise<boolean> {
  try {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value'
      )!.set;
      nativeSetter!.call(input, msg);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      input.focus();
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);

      // 分段 Paste：每段 ≤6000 字符，不会触发 ChatGPT 的附件行为，且每段都很快。
      // 实测 12000 字符只需约 350ms。
      const CHUNK_SIZE = 6000;
      for (let i = 0; i < msg.length; i += CHUNK_SIZE) {
        const chunk = msg.slice(i, i + CHUNK_SIZE);
        const dt = new DataTransfer();
        dt.setData('text/plain', chunk);
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        input.dispatchEvent(pasteEvent);
        if (i + CHUNK_SIZE < msg.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      return true;
    }
    return false;
  } catch (err: any) {
    console.error('[Cuckoo Code] 设置输入框内容失败:', err.message);
    return false;
  }
}
/**
 * 将消息填入当前可见输入框并按指定延迟触发发送
 * @param msg - 要发送的消息
 * @param tag - 日志标记
 * @param fixedDelay - 固定延迟毫秒数；缺省时使用 randomDelay()
 * @param afterSent - 发送后回调
 * @returns 是否成功
 */
// 当前待发送的消息（可被 cancelPendingSend 取消）
interface PendingSend { timer: any; input: any; cancelled: boolean; }
let pendingSend: PendingSend | null = null;

async function sendToChat(msg: string, tag?: string, fixedDelay?: number, afterSent?: () => void): Promise<boolean> {
  const input = findInputArea();
  if (!input) {
    console.log('[Cuckoo Code] 找不到输入框，无法发送消息');
    return false;
  }
  const token: PendingSend = { timer: null, input: input, cancelled: false };
  pendingSend = token;
  if (!(await setInputContent(input, msg))) {
    if (pendingSend === token) pendingSend = null;
    return false;
  }
  // 填充期间被取消：清空输入框，不发送
  if (token.cancelled) {
    try { setInputContent(input, ''); } catch (_) { /* ignore */ }
    return false;
  }
  const sendDelay = fixedDelay !== undefined ? fixedDelay : randomDelay();
  console.log('[Cuckoo Code] 消息已填入输入框，等待 ' + sendDelay + 'ms 后发送...');
  const timer = setTimeout(function() {
    if (pendingSend === token) pendingSend = null;
    if (token.cancelled) return;
    console.log('[Cuckoo Code] 等待结束，开始触发发送');
    triggerSend(input);
    console.log('[Cuckoo Code] 已触发发送, ' + (tag || '') + ', 长度=' + msg.length);
    if (typeof afterSent === 'function') afterSent();
  }, sendDelay);
  token.timer = timer;
  return true;
}

/**
 * 取消当前待发送的消息（清计时器 + 清空输入框）
 * @returns 是否确实取消了待发送
 */
function cancelPendingSend(): boolean {
  if (!pendingSend) return false;
  const t = pendingSend;
  t.cancelled = true;
  if (t.timer) clearTimeout(t.timer);
  pendingSend = null;
  try { setInputContent(t.input, ''); } catch (_) { /* ignore */ }
  console.log('[Cuckoo Code] 已取消待发送的消息');
  return true;
}
/**
 * 将消息填入 DeepSeek 聊天输入框并触发发送（工具结果回传的公共实现）
 */
function sendMessageToChat(msg: string, tag?: string, afterSent?: () => void): Promise<boolean> {
  return sendToChat(msg, tag, undefined, afterSent);
}
/**
 * 将 JS 工具脚本执行结果发送回 DeepSeek 聊天，让 AI 看到结果并继续工作
 */
async function sendCombinedJsResultsToChat(results: any, onSent?: () => void): Promise<boolean> {
  if (!Array.isArray(results) || results.length === 0) return false;

  const MAX_OUTPUT = 15000;
  const sep = String.fromCharCode(10);

  let msg = '【JS 执行结果汇总】(共 ' + results.length + ' 个脚本)' + sep + sep;

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    msg += '—— 脚本 ' + (i + 1) + ' ——' + sep;
    if (item && item.result && item.result.success) {
      let out = (item.result.output || '').trim();
      if (out.length > MAX_OUTPUT) {
        out = out.slice(0, MAX_OUTPUT) + sep + '...[输出过长已截断]...';
      }
      msg += '✅ 成功' + sep + (out || '(脚本执行完成，无输出)');
    } else {
      msg += '❌ 失败' + sep + '错误原因: ' + ((item && item.result && item.result.error) || '未知错误') + sep;
      msg += '本次实际执行的代码(前300字符):' + sep + String((item && item.code) || '').slice(0, 300) + sep;
      msg += '请修正 JavaScript 代码后重新输出完整的 ' + BT + BT + BT + 'cuckoo 代码块。';
    }
    msg += sep + sep;
  }

  console.log('[Cuckoo Code] 回传 JS 汇总执行结果, 消息长度=' + msg.length);
  return sendMessageToChat(msg, 'JS汇总', onSent);
}
/**
 * 查找 DeepSeek 的输入框元素
 */
function findInputArea(): any {
  const provider = getCurrentProvider();
  if (provider && typeof provider.findInput === 'function') {
    const el = provider.findInput();
    if (el) return el;
  }

  // 通用兜底：找所有可见 textarea
  const allTextareas = document.querySelectorAll('textarea');
  for (const ta of allTextareas) {
    if (isInputVisible(ta)) return ta;
  }
  // 再找 contenteditable 或 textbox
  const editable = document.querySelector('div[contenteditable="true"], [role="textbox"]');
  if (editable && isInputVisible(editable)) return editable;

  return null;
}
/**
 * 检查元素是否可见
 */
function isInputVisible(el: any): boolean {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}
/**
 * 发送初始提示（目录树+systemPrompt）到输入框
 */
async function sendInitialPromptToInput(): Promise<boolean> {
  if (!state.initialPromptContent) {
    state.pendingInitialPrompt = false;
    return false;
  }

  const input = findInputArea();
  if (!input) {
    return false;
  }

  if (!(await setInputContent(input, state.initialPromptContent))) {
    return false;
  }

  const sendDelay = randomDelay();
  console.log('[Cuckoo Code] 初始提示已填入，随机等待 ' + sendDelay + 'ms 后发送...');
  setTimeout(function() {
    console.log('[Cuckoo Code] 等待结束，开始发送初始提示');
    triggerSend(input);
    state.pendingInitialPrompt = false;
  }, sendDelay);

  return true;
}
/**
 * 等待输入框出现后再发送初始提示
 */
function waitForInitialPromptAndSend(): void {
  let attempts = 0;
  const maxAttempts = 30;
  console.log('[' + new Date().toISOString() + '] [Cuckoo Code] 开始等待输入框出现（最多 ' + maxAttempts + ' 次，每次 500ms）');

  const checkInterval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(checkInterval);
      state.pendingInitialPrompt = false;
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] 等待输入框超时，放弃发送初始提示');
      return;
    }

    const found = !!findInputArea();
    if (attempts === 1 || attempts % 5 === 0 || found) {
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] 等待输入框第 ' + attempts + ' 次检查, 输入框=' + (found ? '找到' : '未找到'));
    }
    if (found) {
      clearInterval(checkInterval);
      sendInitialPromptToInput();
    }
  }, 500);
}
/**
 * 触发发送消息
 */
function triggerSend(input: any): void {
  const provider = getCurrentProvider();

  // 方法 0: 站点原生发送（智谱等免疫合成事件的平台，经主进程注入真实级输入）
  if (provider && typeof provider.triggerSend === 'function') {
    let result: any = null;
    try { result = provider.triggerSend(input); } catch (_) { /* 站点实现异常时回退通用逻辑 */ }
    if (result && typeof result.then === 'function') {
      result.then(function (ok: boolean) {
        if (ok) {
          console.log('[Cuckoo Code] 已通过站点原生发送触发');
        } else {
          fallbackSend(provider, input);
        }
      }).catch(function () { fallbackSend(provider, input); });
      return;
    }
    if (result) {
      console.log('[Cuckoo Code] 已通过站点原生发送触发');
      return;
    }
  }

  fallbackSend(provider, input);
}

/**
 * 通用发送兜底：查找发送按钮点击，或模拟 Enter 按键序列
 */
function fallbackSend(provider: any, input: any): void {
  // 方法 1: 调用平台 Provider 查找发送按钮
  if (provider && typeof provider.findSendButton === 'function') {
    const btn = provider.findSendButton();
    if (btn) {
      btn.click();
      console.log('[Cuckoo Code] 已点击发送按钮');
      return;
    }
  }

  // 方法 2: 在输入框上模拟完整 Enter 按键序列（keydown + keypress + keyup）
  if (input) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, isComposing: false };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keypress', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
    console.log('[Cuckoo Code] 已通过 Enter 键触发发送 (未找到发送按钮)');
  }
}
/**
 * 注册主进程消息监听（initial-prompt）
 * 与原 preload.js 顶层注册时机一致：preload 入口加载时同步调用。
 */
function registerIpcListeners(): void {
// 监听主进程发送的初始提示
ipcRenderer.on('initial-prompt', (_event: any, content: string) => {
  console.log('[' + new Date().toISOString() + '] [Cuckoo Code] 收到 initial-prompt 事件, content长度=' + (content || '').length);
  state.initialPromptContent = content || '';
  state.pendingInitialPrompt = true;
  // 如果当前已有新的空会话输入框，立即发送
  if (state.pendingInitialPrompt && state.initialPromptContent) {
    try {
      const input = findInputArea();
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] 首次查找输入框结果=' + (input ? '找到' : '未找到'));
      if (input) {
        sendInitialPromptToInput();
      } else {
        // 等待输入框出现
        waitForInitialPromptAndSend();
      }
    } catch (e: any) {
      console.error('[' + new Date().toISOString() + '] [Cuckoo Code] initial-prompt 处理异常:', e.message);
    }
  }
});
}


export {
  randomDelay,
  setInputContent,
  sendToChat,
  sendMessageToChat,
  sendCombinedJsResultsToChat,
  cancelPendingSend,
  findInputArea,
  isInputVisible,
  sendInitialPromptToInput,
  waitForInitialPromptAndSend,
  triggerSend,
  registerIpcListeners,
};

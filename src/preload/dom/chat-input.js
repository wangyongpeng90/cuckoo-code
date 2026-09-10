/**
 * 聊天输入框交互：查找输入框、填入与发送消息、工具结果回传
 * 由原 preload.js 拆分而来，逻辑保持不变。
 */
const { ipcRenderer } = require('electron');
const state = require('./state');
const { BT } = require('./js-detector');
const { getProviderByUrl } = require('../../../src/providers');

/**
 * 根据当前 URL 获取 provider
 */
function getCurrentProvider() {
  return getProviderByUrl(window.location.href);
}

/**
 * 生成随机等待时间（ms），范围由 state 配置（默认 2-4 秒）
 */
function randomDelay() {
  const min = typeof state.sendDelayMin === 'number' ? state.sendDelayMin : 2000;
  const max = typeof state.sendDelayMax === 'number' ? state.sendDelayMax : 4000;
  if (min >= max) return min;
  return Math.floor(Math.random() * (max - min)) + min;
}
/**
 * 将文本填入输入框（React 兼容：使用原生 value setter）
 * @param {Element} input - 输入框元素
 * @param {string} msg - 要填入的文本
 * @returns {boolean} 是否成功填入
 */
function setInputContent(input, msg) {
  try {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value'
      ).set;
      nativeSetter.call(input, msg);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, msg);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[Cuckoo Code] 设置输入框内容失败:', err.message);
    return false;
  }
}
/**
 * 将消息填入当前可见输入框并按指定延迟触发发送
 * @param {string} msg - 要发送的消息
 * @param {string} [tag] - 日志标记
 * @param {number} [fixedDelay] - 固定延迟毫秒数；缺省时使用 randomDelay()
 * @param {Function} [afterSent] - 发送后回调
 * @returns {boolean} 是否成功
 */
function sendToChat(msg, tag, fixedDelay, afterSent) {
  const input = findInputArea();
  if (!input) {
    console.log('[Cuckoo Code] 找不到输入框，无法发送消息');
    return false;
  }
  if (!setInputContent(input, msg)) {
    return false;
  }
  const sendDelay = fixedDelay !== undefined ? fixedDelay : randomDelay();
  console.log('[Cuckoo Code] 消息已填入输入框，等待 ' + sendDelay + 'ms 后发送...');
  setTimeout(function() {
    console.log('[Cuckoo Code] 等待结束，开始触发发送');
    triggerSend(input);
    console.log('[Cuckoo Code] 已触发发送, ' + (tag || '') + ', 长度=' + msg.length);
    if (typeof afterSent === 'function') afterSent();
  }, sendDelay);
  return true;
}
/**
 * 将消息填入 DeepSeek 聊天输入框并触发发送（工具结果回传的公共实现）
 */
function sendMessageToChat(msg, tag) {
  return sendToChat(msg, tag);
}
/**
 * 将 JSON 工具执行结果发送回 DeepSeek 聊天，让 AI 看到结果并继续工作
 */
function sendToolResultToChat(toolCall, result) {
  // 构造回传消息（明确的成功/失败信息，AI 可据此修正并继续）
  let msg;
  if (result.success) {
    const data = result.data || {};
    // 大内容截断保护（20KB），避免超长消息
    if (typeof data.content === 'string' && data.content.length > 20000) {
      data.content = data.content.substring(0, 20000) + String.fromCharCode(10) + '...[内容过长已截断]...';
    }
    msg = '【工具执行结果】' + toolCall.toolName + ' 执行成功 (callId: ' + (toolCall.callId || '') + ')' + String.fromCharCode(10) +
      JSON.stringify(data, null, 2);
  } else {
    msg = '【工具执行结果】' + toolCall.toolName + ' 执行失败 (callId: ' + (toolCall.callId || '') + ')' + String.fromCharCode(10) +
      '错误原因: ' + (result.error || '未知错误') + String.fromCharCode(10) +
      '请根据错误原因修正参数后重新调用工具。';
  }

  console.log('[Cuckoo Code] 回传工具结果, 消息长度=' + msg.length);
  sendMessageToChat(msg, '工具=' + toolCall.toolName);
}
/**
 * 将 JS 工具脚本执行结果发送回 DeepSeek 聊天，让 AI 看到结果并继续工作
 */
function sendCombinedJsResultsToChat(results) {
  if (!Array.isArray(results) || results.length === 0) return;

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
  sendMessageToChat(msg, 'JS汇总');
}
/**
 * 查找 DeepSeek 的输入框元素
 */
function findInputArea() {
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
function isInputVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}
/**
 * 发送初始提示（目录树+systemPrompt）到输入框
 */
function sendInitialPromptToInput() {
  if (!state.initialPromptContent) {
    state.pendingInitialPrompt = false;
    return false;
  }

  const input = findInputArea();
  if (!input) {
    return false;
  }

  if (!setInputContent(input, state.initialPromptContent)) {
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
function waitForInitialPromptAndSend() {
  let attempts = 0;
  const maxAttempts = 30;

  const checkInterval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(checkInterval);
      state.pendingInitialPrompt = false;
      return;
    }

    if (findInputArea()) {
      clearInterval(checkInterval);
      sendInitialPromptToInput();
    }
  }, 500);
}
/**
 * 触发发送消息
 */
function triggerSend(input) {
  const provider = getCurrentProvider();

  // 方法 0: 站点原生发送（智谱等免疫合成事件的平台，经主进程注入真实级输入）
  if (provider && typeof provider.triggerSend === 'function') {
    let result = null;
    try { result = provider.triggerSend(input); } catch (_) { /* 站点实现异常时回退通用逻辑 */ }
    if (result && typeof result.then === 'function') {
      result.then(function (ok) {
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
function fallbackSend(provider, input) {
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
// 子 Agent 输入框锁定状态（事件拦截，不用 disabled 避免破坏自动填发）
let subagentInputLocked = false;
let subagentLockHandlers = [];

/**
 * 锁定子 Agent 输入框：捕获阶段拦截用户键盘/粘贴事件。
 * 不设 disabled 属性——textarea disabled 会挡掉 React 发送处理器，
 * contenteditable=false 会让 execCommand('insertText') 失效。
 */
function lockInputArea(input) {
  if (subagentInputLocked) return;
  subagentInputLocked = true;

  const blockUserInput = (e) => {
    // 只拦真实用户输入，程序化事件（isTrusted=false）不受影响
    if (e.isTrusted) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  input.addEventListener('keydown', blockUserInput, true);
  input.addEventListener('keyup', blockUserInput, true);
  input.addEventListener('input', blockUserInput, true);
  input.addEventListener('paste', blockUserInput, true);
  input.addEventListener('beforeinput', blockUserInput, true);

  subagentLockHandlers.push({ input, blockUserInput });
  console.log('[Cuckoo Code] 子 Agent 输入框已锁定（拦截用户输入）');
}

/**
 * 解锁子 Agent 输入框（任务结束/abort 时调用；completed 关窗场景下可不调用，窗口销毁自动清理）。
 */
function unlockInputArea() {
  if (!subagentInputLocked) return;
  for (const { input, blockUserInput } of subagentLockHandlers) {
    input.removeEventListener('keydown', blockUserInput, true);
    input.removeEventListener('keyup', blockUserInput, true);
    input.removeEventListener('input', blockUserInput, true);
    input.removeEventListener('paste', blockUserInput, true);
    input.removeEventListener('beforeinput', blockUserInput, true);
  }
  subagentLockHandlers = [];
  subagentInputLocked = false;
  console.log('[Cuckoo Code] 子 Agent 输入框已解锁');
}

/**
 * 注册主进程消息监听（initial-prompt）
 * 与原 preload.js 顶层注册时机一致：preload 入口加载时同步调用。
 */
function registerIpcListeners() {
// 监听主进程发送的初始提示
ipcRenderer.on('initial-prompt', (_event, content) => {
  state.initialPromptContent = content || '';
  state.pendingInitialPrompt = true;
  // 如果当前已有新的空会话输入框，立即发送
  if (state.pendingInitialPrompt && state.initialPromptContent) {
    try {
      const input = findInputArea();
      if (input) {
        sendInitialPromptToInput();
      } else {
        // 等待输入框出现
        waitForInitialPromptAndSend();
      }
    } catch (e) {
    }
  }
});

// 监听子 Agent 追问/提醒消息（subagent-reminder）
ipcRenderer.on('subagent-reminder', (_event, { message }) => {
  if (!message || typeof message !== 'string') return;
  const input = findInputArea();
  if (!input) {
    console.log('[Cuckoo Code] 子 Agent 提醒到达，但未找到输入框');
    return;
  }
  sendToChat(message, '子Agent提醒', 1500);
});

// 监听子 Agent 任务消息（subagent-task）
ipcRenderer.on('subagent-task', (_event, { task }) => {
  if (!task || typeof task !== 'string') return;

  // 等输入框出现再锁定+发送（最多 30 次 × 500ms = 15s），复用 initial-prompt 的等待模式
  let attempts = 0;
  const maxAttempts = 30;
  const checkInterval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(checkInterval);
      console.log('[Cuckoo Code] 子 Agent 任务等待输入框超时（15s），消息丢弃');
      return;
    }

    try {
      const input = findInputArea();
      if (!input) return;

      clearInterval(checkInterval);
      lockInputArea(input); // 6.3：条件禁用（检测到输入框后才锁，登录表单不锁）
      const sent = sendToChat(task, '子Agent任务', 1500);
      if (!sent) {
        console.log('[Cuckoo Code] 子 Agent 任务填入失败');
        unlockInputArea();
      }
    } catch (err) {
      clearInterval(checkInterval);
      console.error('[Cuckoo Code] 子 Agent 任务发送异常:', err);
    }
  }, 500);
});
}


module.exports = {
  randomDelay,
  setInputContent,
  sendToChat,
  sendMessageToChat,
  sendToolResultToChat,
  sendCombinedJsResultsToChat,
  findInputArea,
  isInputVisible,
  sendInitialPromptToInput,
  waitForInitialPromptAndSend,
  triggerSend,
  registerIpcListeners,
  lockInputArea,
  unlockInputArea,
};

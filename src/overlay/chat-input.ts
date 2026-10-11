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
    // 不使用 provider.fillInput：其实现只要首次 execCommand 返回 true 便无条件返回成功，
    // 既不做写入后读回、分片之间也不等待。实测存在「execCommand 报告成功但编辑器内容为空」
    // 被当作填入成功 → 发出空消息。统一走下方通用逻辑（含读回校验），各平台一致。
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
      // 清空现有内容：不用 execCommand('selectAll')，它选中的是「当前焦点所在的可编辑区域」，
      // 焦点未真正落入本输入框时会退化为全选整个文档（表现为页面文字被全部选中）。
      // 改为在 input 内部显式建立 Range 选区，范围锁定在本元素，不依赖焦点位置。
      try {
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(input);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('delete', false, undefined);
        }
      } catch (_) { /* 选区失败不阻断：由下方读回校验兜底 */ }

      // 分段插入：每段 ≤6000 字符，避免触发站点的"粘贴文件"附件行为。
      // 用 execCommand('insertText') 而非合成 ClipboardEvent('paste')：
      // 后者 isTrusted=false，ProseMirror 一类编辑器会拒收，导致写入静默失败。
      const CHUNK_SIZE = 6000;
      for (let i = 0; i < msg.length; i += CHUNK_SIZE) {
        const chunk = msg.slice(i, i + CHUNK_SIZE);
        document.execCommand('insertText', false, chunk);
        if (i + CHUNK_SIZE < msg.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      // 读回校验：编辑器可能拒绝写入（受控组件/合成事件），不能无条件返回 true。
      // 以去空白后长度 ≥ 期望的 90% 为准，容忍编辑器对空白与换行的处理差异。
      const probe = msg.replace(/\s+/g, '');
      const writtenCompact = getInputText(input).replace(/\s+/g, '');
      if (!writtenCompact || writtenCompact.length < probe.length * 0.9) {
        console.error('[Cuckoo Code] 输入框写入校验失败：期望约 ' + probe.length + ' 字，实际 ' + writtenCompact.length + ' 字');
        return false;
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

// 「用户消息已发出」回调（供 bridge 上报飞书等；overlay 不依赖上层，用回调注入）
// 系统内部消息的 tag（不视为"用户消息"，不上报飞书）
const SYSTEM_MSG_TAGS = [
  'JS汇总', '飞书', '看门狗', '重试', '重试(操作频繁)',
  '压缩-摘要', 'MCP信息', '技能与代理清单', '继续',
  'JSON工具调用提示', 'XML工具调用提示', '系统提示词',
];
let onUserMessageSentCb: ((text: string, tag?: string) => void) | null = null;
/** 注册"用户消息已发出"回调（返回取消注册） */
function onUserMessageSent(cb: (text: string, tag?: string) => void): () => void {
  onUserMessageSentCb = cb;
  return () => { if (onUserMessageSentCb === cb) onUserMessageSentCb = null; };
}

// 「消息已投递」回调：所有经 sendToChat 发出的消息都派发（含系统内部消息），
// 供纯净对话模式显示"框架正在驱动 AI 页面"的运行态反馈（内容不显示，只反馈状态）。
let onMessageDeliveredCb: ((info: { text: string; tag: string; isSystem: boolean }) => void) | null = null;
/** 注册"消息已投递"回调（返回取消注册） */
function onMessageDelivered(cb: (info: { text: string; tag: string; isSystem: boolean }) => void): () => void {
  onMessageDeliveredCb = cb;
  return () => { if (onMessageDeliveredCb === cb) onMessageDeliveredCb = null; };
}

/** 是否框架内部消息（不视为"用户消息"，飞书不上报；纯净模式只反馈状态不显示内容） */
function isSystemTag(tag?: string): boolean {
  return SYSTEM_MSG_TAGS.indexOf(tag || '') !== -1;
}

/** 派发"消息已投递"（回调缺失时零开销） */
function emitMessageDelivered(text: string, tag?: string): void {
  if (!onMessageDeliveredCb) return;
  try {
    onMessageDeliveredCb({ text: text, tag: tag || '', isSystem: isSystemTag(tag) });
  } catch (_) { /* ignore */ }
}

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
  // 填充期间被取消：不发送（输入框内容保留）
  if (token.cancelled) {
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
    // 通知监听者（飞书同步等）；系统内部消息（工具结果/看门狗/重试等）不上报
    try {
      if (onUserMessageSentCb && !isSystemTag(tag)) onUserMessageSentCb(msg, tag);
    } catch (_) {}
    // 纯净模式：任何投递（含框架内部消息）都派发一次，用于显示"框架正在驱动"运行态
    emitMessageDelivered(msg, tag);
    if (typeof afterSent === 'function') afterSent();
  }, sendDelay);
  token.timer = timer;
  return true;
}

/**
 * 取消当前待发送的消息（清计时器；输入框内容保留，用户可自行处理）
 * @returns 是否确实取消了待发送
 */
function cancelPendingSend(): boolean {
  if (!pendingSend) return false;
  const t = pendingSend;
  t.cancelled = true;
  if (t.timer) clearTimeout(t.timer);
  pendingSend = null;
  // 不清空输入框：保留待发内容，用户可自行决定发送或删除
  console.log('[Cuckoo Code] 已取消待发送的消息（输入框内容保留）');
  return true;
}
/**
 * 将消息填入 DeepSeek 聊天输入框并触发发送（工具结果回传的公共实现）
 */
function sendMessageToChat(msg: string, tag?: string, afterSent?: () => void): Promise<boolean> {
  return sendToChat(msg, tag, undefined, afterSent);
}
/**
 * 应用 provider 的工具结果格式转换（若提供）。
 * 独立成纯函数：接收文本与 provider，返回转换后文本，便于单测。
 * @returns 转换后文本；provider 未实现或返回空串时保持原文
 */
function applyResultTransform(text: string, provider: any): string {
  if (provider && typeof provider.transformToolResult === 'function') {
    try {
      const t = provider.transformToolResult(text);
      if (typeof t === 'string' && t) return t;
    } catch (err: any) {
      console.warn('[Cuckoo Code] transformToolResult 调用失败:', err && err.message);
    }
  }
  return text;
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

  // provider 可自定义回传格式（某些平台对格式敏感，如触发风控）
  msg = applyResultTransform(msg, getCurrentProvider());

  // 追加（不覆盖）：保留用户已输入的内容，工具结果拼在其后一起发送
  const input = findInputArea();
  if (input) {
    const current = (getInputText(input) || '').trim();
    if (current) {
      msg = current + sep + sep + msg;
      console.log('[Cuckoo Code] 工具结果追加在用户已输入内容之后（保留 ' + current.length + ' 字符）');
    }
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
 * 分批发送的每批字符数。
 * 仅用于**存在单条长度上限的平台**（实测 ChatGPT 会拒绝过长的单条消息，
 * 提示"内容过长"）。初始化提示词（模板 + 工具契约 + 项目说明 + 工作流规则）
 * 可达数万字符，故按固定长度切分后逐批发送；切分直接按字符数截断。
 */
const INITIAL_PROMPT_BATCH_SIZE = 15000;
/**
 * 批间等待（毫秒）。**从「上一批已发送」之后开始计时**。
 * 下一批在填入后还要经过 randomDelay()（发送延迟，用户可设）才会真正发出，
 * 两段等待叠加已足够让 AI 回执并结束生成，故批间只需补足剩余余量。
 */
const INITIAL_PROMPT_BATCH_WAIT_MS = 4000;
/** 已发出的批次数：重试时从下一批继续，避免重发已送达内容 */
let initialPromptBatchSent = 0;
/** 是否正在分批发送：期间不重入，避免 initial-prompt 重复到达导致交叉发送 */
let initialPromptSending = false;

/**
 * 是否需要分批发送初始提示。
 *
 * 仅在「ChatGPT 主 Agent」时为真，两个排除条件都有实测依据：
 *  - **子代理不分批**：子代理协议要求首条消息一次性投递（它收到后立即开工）。
 *    分批会先给它一段不完整提示词 + "请只回复收到，等待下一批"，实测子代理直接
 *    回复「无法开始审查：未收到第 2 批内容」；且第 1 片发送后会话 URL 变化会被
 *    看门狗判定为"会话切换"并重置状态。
 *  - **非 ChatGPT 平台不分批**：DeepSeek 等实测可一次接收数万字符，
 *    日志中无"内容过长"记录，无需分批。
 */
function shouldBatchInitialPrompt(): boolean {
  if (state.isSubagent) return false;
  try {
    const provider = getCurrentProvider();
    return !!provider && provider.id === 'chatgpt';
  } catch (_) {
    return false;
  }
}

/** 按固定长度切分文本（直接按字符数截断） */
function splitInitialPrompt(text: string, size: number): string[] {
  if (!text) return [];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** 生成某一批的尾注（说明这是分批内容，并要求 AI 只回执等待下一批） */
function buildBatchNote(index: number, total: number): string {
  if (total <= 1) return '';
  const no = index + 1;
  if (no < total) {
    return '\n\n---\n\n【分批发送 ' + no + '/' + total + '】以上是系统提示词的第 ' + no + ' 部分。'
      + '请只回复「收到」，不要执行任何操作，等待下一批内容。';
  }
  return '\n\n---\n\n【分批发送 ' + total + '/' + total + '】以上是系统提示词的完整内容（最后一批）。'
    + '请开始按上述系统提示词工作。';
}

/**
 * 发送初始提示（目录树+systemPrompt）到输入框。
 * 内容超过单条上限时分批发送，每批附带说明要求 AI 只回执、等待下一批。
 */
async function sendInitialPromptToInput(): Promise<boolean> {
  if (!state.initialPromptContent) {
    state.pendingInitialPrompt = false;
    return false;
  }
  if (initialPromptSending) {
    console.log('[Cuckoo Code] 初始提示正在分批发送中，忽略本次重复触发');
    return true;
  }
  initialPromptSending = true;
  try {
    // 不该分批的场景（子代理 / 非 ChatGPT）按"整条一次发出"处理：
    // 传大于内容长度的 size → 只切出 1 片 → 循环只跑一次、无尾注、无批间等待。
    const batching = shouldBatchInitialPrompt();
    const size = batching ? INITIAL_PROMPT_BATCH_SIZE : state.initialPromptContent.length + 1;
    const batches = splitInitialPrompt(state.initialPromptContent, size);
    const total = batches.length;
    console.log('[Cuckoo Code] 初始提示 ' + state.initialPromptContent.length
      + ' 字符，' + (batching ? '分 ' + total + ' 批发送' : '整条发送（不分批）'));

    for (let i = initialPromptBatchSent; i < total; i++) {
      const input = findInputArea();
      if (!input) {
        console.log('[Cuckoo Code] 第 ' + (i + 1) + '/' + total + ' 批发送失败：找不到输入框');
        return false;
      }

      const text = batches[i] + buildBatchNote(i, total);
      if (!(await setInputContent(input, text))) {
        console.log('[Cuckoo Code] 第 ' + (i + 1) + '/' + total + ' 批填充失败');
        return false;
      }

      // 校验：填充后输入框确实有内容（contenteditable 可能拒绝写入）
      try {
        const filled = getInputText(input);
        if (!filled || filled.trim().length < 10) {
          console.log('[Cuckoo Code] 第 ' + (i + 1) + '/' + total + ' 批填充后输入框为空，判定失败');
          return false;
        }
      } catch (_) { /* ignore */ }

      const sendDelay = randomDelay();
      console.log('[Cuckoo Code] 第 ' + (i + 1) + '/' + total + ' 批已填入，随机等待 ' + sendDelay + 'ms 后发送...');
      await new Promise<void>((resolve) => {
        setTimeout(function () {
          console.log('[Cuckoo Code] 发送第 ' + (i + 1) + '/' + total + ' 批');
          triggerSend(input);
          emitMessageDelivered(text, '系统提示词');
          resolve();
        }, sendDelay);
      });
      initialPromptBatchSent = i + 1;

      if (i < total - 1) {
        console.log('[Cuckoo Code] 等待 ' + INITIAL_PROMPT_BATCH_WAIT_MS + 'ms 后发送下一批...');
        await new Promise<void>((resolve) => setTimeout(resolve, INITIAL_PROMPT_BATCH_WAIT_MS));
      }
    }

    initialPromptBatchSent = 0;
    state.pendingInitialPrompt = false;
    console.log('[Cuckoo Code] 初始提示发送完毕（共 ' + total + ' 批）');
    return true;
  } finally {
    initialPromptSending = false;
  }
}
/** 初始提示发送的最大尝试次数（跨"等输入框"与"等发送成功"共用） */
const INITIAL_PROMPT_MAX_ATTEMPTS = 30;

/**
 * 尝试发送初始提示；失败则重试，直到成功或达上限。
 * @param attempt 已尝试次数（递归时 +1 传递，不重置，避免无限重试）
 */
function trySendInitialPrompt(attempt: number): void {
  const input = findInputArea();
  if (!input) {
    if (attempt >= INITIAL_PROMPT_MAX_ATTEMPTS) {
      state.pendingInitialPrompt = false;
      console.log('[Cuckoo Code] 等待输入框超时，放弃发送初始提示');
      return;
    }
    setTimeout(() => trySendInitialPrompt(attempt + 1), 500);
    return;
  }
  // 找到输入框：尝试发送（sendInitialPromptToInput 内部会校验填充是否成功）
  sendInitialPromptToInput().then((ok) => {
    if (ok) return;
    if (attempt < INITIAL_PROMPT_MAX_ATTEMPTS) {
      console.log('[Cuckoo Code] 初始提示发送失败，重试（第 ' + (attempt + 1) + ' 次）');
      setTimeout(() => trySendInitialPrompt(attempt + 1), 500);
    } else {
      console.log('[Cuckoo Code] 初始提示发送失败，已达上限，放弃');
      state.pendingInitialPrompt = false;
    }
  }).catch(() => {
    if (attempt < INITIAL_PROMPT_MAX_ATTEMPTS) setTimeout(() => trySendInitialPrompt(attempt + 1), 500);
  });
}

/** 等待输入框出现后再发送初始提示（对外入口，从 0 开始） */
function waitForInitialPromptAndSend(): void {
  trySendInitialPrompt(0);
}
/** 读取输入框当前文本 */
function getInputText(input: any): string {
  try {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      return input.value || '';
    }
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      return input.innerText || input.textContent || '';
    }
  } catch (_) {}
  return '';
}

/**
 * 在输入框现有内容末尾追加一段文本（不发送），光标移到末尾。
 * 用于快捷提示词/MCP 名等"追加"场景。
 * @param text 要追加的文本
 * @returns 是否成功
 */
async function appendTextToInput(text: string): Promise<boolean> {
  const input = findInputArea();
  if (!input) {
    console.log('[Cuckoo Code] 找不到输入框，无法追加文本');
    return false;
  }
  const current = getInputText(input);
  // 若已有内容且不以空白结尾，补一个空格
  const sep = current && !/\s$/.test(current) ? ' ' : '';
  const next = current + sep + text;
  const ok = await setInputContent(input, next);
  if (ok) {
    moveCaretToEnd(input);
    console.log('[Cuckoo Code] 已追加文本到输入框, 追加长度=' + text.length);
  }
  return ok;
}

/**
 * 把光标移到输入框末尾（填入提示词后，方便用户接着补充）
 */
function moveCaretToEnd(input: any): void {
  try {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const len = input.value ? input.value.length : 0;
      input.setSelectionRange(len, len);
      return;
    }
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false); // 折叠到末尾
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  } catch (err: any) {
    console.error('[Cuckoo Code] 移动光标到末尾失败:', err.message);
  }
}

/**
 * 插入快捷提示词：填入输入框 + 光标移到末尾；autoSend=true 时自动发送。
 * @param content 提示词内容
 * @param autoSend 是否自动发送（默认 false = 只填入）
 * @returns 是否成功填入
 */
async function insertSnippet(content: string, autoSend?: boolean): Promise<boolean> {
  const input = findInputArea();
  if (!input) {
    console.log('[Cuckoo Code] 找不到输入框，无法插入提示词');
    return false;
  }
  // 追加（不覆盖用户已输入的内容）：读现有内容 + 分隔 + 新内容
  const current = getInputText(input);
  const sep = current && !/\s$/.test(current) ? ' ' : '';
  const next = current + sep + content;
  if (!(await setInputContent(input, next))) {
    return false;
  }
  moveCaretToEnd(input);
  if (autoSend) {
    // 稍等片刻，让输入框内容稳定后再触发发送
    setTimeout(function () { triggerSend(input); }, 300);
    console.log('[Cuckoo Code] 提示词已追加并触发发送, 长度=' + content.length);
  } else {
    console.log('[Cuckoo Code] 提示词已追加（未发送）, 长度=' + content.length);
  }
  return true;
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
      // 统一走"尝试发送 + 失败重试"（找到/未找到都在内部处理）
      waitForInitialPromptAndSend();
    } catch (e: any) {
      console.error('[' + new Date().toISOString() + '] [Cuckoo Code] initial-prompt 处理异常:', e.message);
    }
  }
});
}


export {
  randomDelay,
  setInputContent,
  insertSnippet,
  appendTextToInput,
  sendToChat,
  onUserMessageSent,
  onMessageDelivered,
  isSystemTag,
  sendMessageToChat,
  applyResultTransform,
  sendCombinedJsResultsToChat,
  cancelPendingSend,
  findInputArea,
  isInputVisible,
  sendInitialPromptToInput,
  waitForInitialPromptAndSend,
  triggerSend,
  registerIpcListeners,
};

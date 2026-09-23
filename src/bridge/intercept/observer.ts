/**
 * DeepSeek 拦截模式下的回复处理器（隔离世界）
 * 监听主世界注入的 'cuckoo-ai-response' 事件，收到完整回复后走与 DOM 模式
 * 相同的工具调用/JS 代码块处理流程。
 */
import { extractJsToolBlocks, BT } from '../parser/js-detector.js';
import { looksLikeJsonToolCall } from '../parser/json-detector.js';
import { handleJsToolScript } from '../loop/executor.js';
import { sendCombinedJsResultsToChat, sendMessageToChat } from '../../overlay/chat-input.js';
import { showToolMask, hideToolMask } from '../../overlay/panel.js';
import * as watchdog from '../loop/watchdog.js';

const MAX_JS_RETRY = 3;
// 连续"格式提示"次数（JSON/XML 共用，防止 AI 来回切换格式绕过上限）
let formatHintCount = 0;
const FORMAT_HINT_MAX = 10;
// 上次已处理的文本（去重，防同一条回复重复处理）
let lastProcessedText = '';
// 最近一次拦截到的完整回复文本（供手动解析复用，不依赖 DOM）
let lastInterceptedText = '';

function looksLikeIncompleteCodeError(error: any): boolean {
  if (!error || typeof error !== 'string') return false;
  return /SyntaxError|Missing initializer|Unexpected end of input|Unexpected token|Unexpected identifier|Unexpected reserved word|Invalid or unexpected token/i.test(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 执行 JS 代码块，遇到"代码不完整"错误时自动重试。
 * 拦截模式下文本已完整（finished），无需重新提取，简单重试执行即可。
 */
async function executeJsBlocksWithRetry(blocks: string[]): Promise<any[]> {
  let results: any[] = [];
  for (let attempt = 0; attempt <= MAX_JS_RETRY; attempt++) {
    results = [];
    for (const code of blocks) {
      const r = await handleJsToolScript(code);
      if (r) results.push(r);
    }
    const hasIncompleteFailure = results.some(
      (item) => item && item.result && !item.result.success && looksLikeIncompleteCodeError(item.result.error)
    );
    if (!hasIncompleteFailure) break;
    if (attempt < MAX_JS_RETRY) await sleep(1000);
  }
  return results;
}

/**
 * 处理一条已完成的 AI 回复文本
 * @param text 完整回复文本（Markdown 原文）
 * @param force 为 true 时跳过去重（手动解析重新执行同一条时使用）
 */
async function processInterceptedResponse(text: string, force?: boolean): Promise<void> {
  const raw = (text || '').trim();
  if (!raw) return;
  if (!force && raw === lastProcessedText) return;
  lastProcessedText = raw;

  console.log('[Cuckoo Code][拦截] 收到完整回复，长度=' + raw.length + '，开始解析工具调用');

  // 1. 优先检测 JS 工具代码块（cuckoo / js 代码块）
  const jsBlocks = extractJsToolBlocks(raw);
  if (jsBlocks.length > 0) {
    console.log('[Cuckoo Code][拦截] 检测到 JS 工具代码块（' + jsBlocks.length + ' 个），开始执行');
    formatHintCount = 0;
    // 从检测到工具调用到结果发送完成，全程遮盖页面，禁止用户额外操作
    showToolMask();
    let results: any[] = [];
    try {
      results = await executeJsBlocksWithRetry(jsBlocks);
    } catch (err) {
      hideToolMask();
      throw err;
    }
    if (results.length === 0) {
      hideToolMask();
      return;
    }
    // afterSent 在"结果已发出"时触发隐藏；发送失败（找不到输入框等）则立即隐藏兜底
    const sent = await sendCombinedJsResultsToChat(results, hideToolMask);
    if (!sent) hideToolMask();
    return;
  }

  // 2. JSON 格式工具调用（D11：已废除执行，仅识别并提示改用 cuckoo 代码块）
  if (looksLikeJsonToolCall(raw)) {
    if (formatHintCount >= FORMAT_HINT_MAX) {
      console.log('[Cuckoo Code][拦截] 已连续提示 ' + formatHintCount + ' 次格式问题，停止发送');
      return;
    }
    formatHintCount++;
    console.log('[Cuckoo Code][拦截] 检测到 JSON 格式工具调用（第 ' + formatHintCount + ' 次提示）');
    sendMessageToChat(
      '请使用' + BT + BT + BT + 'cuckoo' + BT + BT + BT + ' 代码块进行工具调用，不要输出 JSON 格式。',
      'JSON工具调用提示'
    );
    return;
  }

  // 3. XML 格式工具调用提示
  const hasAntmlXml = /^<\s*｜｜DSML｜｜/i.test(raw);
  const hasXmlInvoke = /<\s*(?:[\w-]+:)?invoke\s+name=/i.test(raw);
  const hasXmlClose = /<\s*\/\s*(?:[\w-]+:)?invoke\s*>/i.test(raw);
  const hasXmlParam = /<\s*(?:[\w-]+:)?parameter\s+name=/i.test(raw);
  if (hasAntmlXml || (hasXmlInvoke && (hasXmlClose || hasXmlParam))) {
    if (formatHintCount >= FORMAT_HINT_MAX) {
      console.log('[Cuckoo Code][拦截] 已连续提示 ' + formatHintCount + ' 次格式问题，停止发送');
      return;
    }
    formatHintCount++;
    console.log('[Cuckoo Code][拦截] 检测到 XML 格式工具调用（第 ' + formatHintCount + ' 次提示）');
    sendMessageToChat(
      '请使用' + BT + BT + BT + 'cuckoo' + BT + BT + BT + ' 代码块进行工具调用，不要使用 XML invoke 格式。',
      'XML工具调用提示'
    );
    return;
  }

  // 4. 普通文本回复：任务完成，退出工具循环
  console.log('[Cuckoo Code][拦截] 正常文本回复，未检测到工具调用');
  try {
    (window as any).electronAPI.showAiNotification().catch(() => {});
  } catch (e) { /* ignore */ }
}

// 回复完成监听器（供压缩等流程等待 AI 回复完成）
// meta 携带服务端权威数据（tokenUsage / msgIds），由监听方按需取用，
// 避免共享状态跨层（bridge 不依赖 overlay）。
const responseListeners = new Set<(text: string, meta: any) => void>();
// 失败监听器（供自动重试引擎订阅）
const errorListeners = new Set<(detail: any) => void>();

/**
 * 注册"AI 回复完成"监听器
 * @param cb 收到完成回复时调用，参数为完整文本 + meta（{ tokenUsage, msgIds }）
 * @returns 取消注册
 */
function onInterceptedResponse(cb: (text: string, meta: any) => void): () => void {
  responseListeners.add(cb);
  return () => responseListeners.delete(cb);
}

/**
 * 注册"AI 请求失败"监听器
 * @param cb 收到失败事件时调用，参数为 detail { text, status, reason, httpStatus, name }
 * @returns 取消注册
 */
function onAiError(cb: (detail: any) => void): () => void {
  errorListeners.add(cb);
  return () => errorListeners.delete(cb);
}

/**
 * 启动拦截事件监听
 */
function startInterceptObserver(): void {
  window.addEventListener('cuckoo-ai-response', (ev: any) => {
    try {
      const detail = ev && ev.detail;
      if (!detail) return;
      // 诊断日志已移除（高频 JSON.stringify + 每回复输出，会拖慢页面/累积日志）
      // 用户主动停止：不处理，也不通知监听器（等待方按超时处理）
      if (detail.status === 'stopped') {
        console.log('[Cuckoo Code][拦截] 检测到用户停止生成，忽略该回复');
        try { watchdog.onResponseReceived('stopped'); } catch (_) { /* ignore */ }
        return;
      }
      if (!detail.finished) return;
      try { watchdog.onResponseReceived('finished'); } catch (_) { /* ignore */ }
      // 缓存最近一次完整回复文本，供手动解析复用（不依赖 DOM）
      lastInterceptedText = detail.text || '';
      // 通知监听器（每次成功回复都触发），携带服务端权威数据
      const meta = { tokenUsage: detail.tokenUsage || null, msgIds: detail.msgIds || null };
      for (const cb of responseListeners) {
        try { cb(detail.text || '', meta); } catch (_) { /* ignore */ }
      }
      processInterceptedResponse(detail.text);
    } catch (err) {
      console.error('[Cuckoo Code][拦截] 处理回复事件出错:', err);
    }
  });
  window.addEventListener('cuckoo-ai-error', (ev: any) => {
    try {
      const detail = ev && ev.detail;
      try { watchdog.onResponseReceived('error'); } catch (_) { /* ignore */ }
      for (const cb of errorListeners) {
        try { cb(detail || {}); } catch (_) { /* ignore */ }
      }
    } catch (err) {
      console.error('[Cuckoo Code][拦截] 处理失败事件出错:', err);
    }
  });
  console.log('[Cuckoo Code][拦截] 已启动 cuckoo-ai-response / cuckoo-ai-error 事件监听');
}

/** 取最近一次拦截到的完整回复文本（手动解析用） */
function getLastInterceptedText(): string {
  return lastInterceptedText;
}

export { startInterceptObserver, processInterceptedResponse, getLastInterceptedText, onInterceptedResponse, onAiError };

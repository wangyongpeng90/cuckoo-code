/**
 * DeepSeek 拦截模式下的回复处理器（隔离世界）
 * 监听主世界注入的 'cuckoo-ai-response' 事件，收到完整回复后走与 DOM 模式
 * 相同的工具调用/JS 代码块处理流程。
 */
import { extractJsToolBlocks, BT } from '../parser/js-detector.js';
import { looksLikeJsonToolCall } from '../parser/json-detector.js';
import { handleJsToolScript } from '../loop/executor.js';
import { sendCombinedJsResultsToChat, sendMessageToChat, cancelPendingSend } from '../../overlay/chat-input.js';
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
// 用户请求中止：停止工具循环的回传（停止按钮触发）
let abortRequested = false;
function requestAbort(): void { abortRequested = true; }
function clearAbort(): void { abortRequested = false; }

function looksLikeIncompleteCodeError(error: any): boolean {
  if (!error || typeof error !== 'string') return false;
  return /SyntaxError|Missing initializer|Unexpected end of input|Unexpected token|Unexpected identifier|Unexpected reserved word|Invalid or unexpected token/i.test(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断工具执行结果是否"疑似出错"——用于触发自动恢复（重发提示词）。
 * 覆盖两类：
 *  1. 脚本抛异常（result.success === false）
 *  2. 脚本"成功"但输出含高可靠错误信号（bash 非零退出、常见错误字样）
 * @returns 命中则返回简要原因，否则返回 null
 */
function detectToolFailure(results: any[]): string | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  // 高可靠错误信号（宁可漏判，不误判：只匹配明确的错误特征）
  const ERR_PATTERNS: RegExp[] = [
    /\[exit code:\s*[1-9]\d*\]/,      // bash/pwsh 非零退出
    /\bcommand not found\b/i,
    /\bNo such file or directory\b/i,
    /\bCannot find (?:module|path)\b/i,
    /^\s*Error[:\s]/m,                    // 行首 Error:
    /\bTypeError\b|\bReferenceError\b|\bSyntaxError\b/,
  ];
  for (const item of results) {
    const res = item && item.result;
    if (!res) continue;
    if (res.success === false) {
      return (res.error || '脚本执行失败').slice(0, 120);
    }
    const out = String(res.output || '');
    for (const re of ERR_PATTERNS) {
      if (re.test(out)) return ('输出疑似错误: ' + out.slice(0, 100)).replace(/\s+/g, ' ');
    }
  }
  return null;
}

/**
 * 执行 JS 代码块，遇到"代码不完整"错误时自动重试。
 * 拦截模式下文本已完整（finished），无需重新提取，简单重试执行即可。
 */
async function executeJsBlocksWithRetry(blocks: string[]): Promise<any[]> {
  // 工具开始（每个代码块一次）
  for (const code of blocks) emitToolCall({ phase: 'start', code });
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
  // 工具结束（逐块上报结果）
  for (const r of results) {
    emitToolCall({
      phase: 'end',
      code: (r && r.code) || '',
      success: !!(r && r.result && r.result.success),
      output: (r && r.result && r.result.output) || '',
      error: (r && r.result && r.result.error) || '',
    });
  }
  return results;
}

/**
 * 处理一条已完成的 AI 回复文本
 * @param text 完整回复文本（Markdown 原文）
 * @param force 为 true 时跳过去重（手动解析重新执行同一条时使用）
 */
async function processInterceptedResponse(text: string, force?: boolean): Promise<void> {
  if (abortRequested) { abortRequested = false; console.log('[Cuckoo Code][拦截] 已请求中止，跳过本次处理'); return; }
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
    // 从检测到工具调用到结果发送完成，显示执行小窗
    const firstLine = String(jsBlocks[0] || '').split('\n')[0].trim();
    showToolMask(undefined, firstLine);
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
    // 等待发送阶段：遮罩上显示「停止」按钮，点击可取消回传
    let cancelled = false;
    showToolMask(() => {
      cancelled = true;
      cancelPendingSend();
      hideToolMask();
    }, firstLine);
    if (abortRequested) { abortRequested = false; hideToolMask(); console.log('[Cuckoo Code][拦截] 已请求中止，不回传工具结果'); return; }
    // afterSent 在"结果已发出"时触发隐藏；发送失败（找不到输入框等）则立即隐藏兜底
    const sent = await sendCombinedJsResultsToChat(results, hideToolMask);
    if (cancelled) return; // 用户已取消，不再处理
    if (!sent) hideToolMask();
    // 工具结果已回传 → 启动"工具循环超时"定时器：若 AI 迟迟不继续回复，自动催继续
    if (sent) { try { watchdog.armToolLoopTimer(); } catch (_) { /* ignore */ } }
    // 工具执行疑似出错 → 派发错误事件，交由自动重试引擎（cuckoo-retry-* 配置）恢复
    const failReason = detectToolFailure(results);
    if (failReason) {
      console.log('[Cuckoo Code][拦截] 工具疑似失败，触发自动恢复: ' + failReason);
      try {
        window.dispatchEvent(new CustomEvent('cuckoo-ai-error', {
          detail: { reason: 'tool_failure', message: failReason },
        }));
      } catch (_) { /* ignore */ }
    }
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
  // 任务空闲信号（工具循环结束 = AI 给出普通文本回复）——供自动压缩等"任务边界"逻辑使用
  emitTaskIdle();
}

// 流式增量监听器（供纯净模式实时渲染；无监听者时零开销）
const streamListeners = new Set<(ev: any) => void>();

/** 注册"流式增量"监听器（{ think, text, finished }） */
function onStream(cb: (ev: any) => void): () => void {
  streamListeners.add(cb);
  return () => streamListeners.delete(cb);
}

/** 派发流式增量（无监听者时直接返回） */
function emitStream(ev: any): void {
  if (streamListeners.size === 0) return;
  for (const cb of streamListeners) {
    try { cb(ev); } catch (_) { /* ignore */ }
  }
}

// 任务空闲监听器（工具循环结束：AI 给出普通文本回复时派发；无监听者时零开销）
const taskIdleListeners = new Set<() => void>();

/** 注册"任务空闲"监听器（工具循环结束） */
function onTaskIdle(cb: () => void): () => void {
  taskIdleListeners.add(cb);
  return () => taskIdleListeners.delete(cb);
}

/** 派发"任务空闲"（无监听者时直接返回） */
function emitTaskIdle(): void {
  if (taskIdleListeners.size === 0) return;
  for (const cb of taskIdleListeners) {
    try { cb(); } catch (_) { /* ignore */ }
  }
}

// 用户消息监听器（供对话记录插件订阅）
const userMessageListeners = new Set<(ev: any) => void>();

/** 注册"用户消息"监听器 */
function onUserMessage(cb: (ev: any) => void): () => void {
  userMessageListeners.add(cb);
  return () => userMessageListeners.delete(cb);
}

/** 派发"用户消息"（无监听者时直接返回） */
function emitUserMessage(ev: any): void {
  if (userMessageListeners.size === 0) return;
  for (const cb of userMessageListeners) {
    try { cb(ev); } catch (_) { /* ignore */ }
  }
}

// 工具调用监听器（供纯净模式等上报工具开始/结束；无监听者时零开销）
const toolCallListeners = new Set<(ev: any) => void>();

/**
 * 注册"工具调用"监听器
 * @param cb 工具开始/结束时调用，参数 { phase: 'start'|'end', code, success?, output?, error? }
 * @returns 取消注册
 */
function onToolCall(cb: (ev: any) => void): () => void {
  toolCallListeners.add(cb);
  return () => toolCallListeners.delete(cb);
}

/** 派发工具调用事件（无监听者时直接返回） */
function emitToolCall(ev: any): void {
  if (toolCallListeners.size === 0) return;
  for (const cb of toolCallListeners) {
    try { cb(ev); } catch (_) { /* ignore */ }
  }
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

// ===== 对话记录落盘：已落盘的 AI 回复去重（按 responseMessageId，缺失时用文本）=====
const savedResponseKeys = new Set<string>();

/** 从当前 URL 提取会话 ID（与主世界 hook 同一规则） */
function getSessionIdFromUrl(): string | null {
  try {
    const m = String(window.location.href).match(/\/chat\/s\/([a-f0-9-]+)/i);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

/** 把一条消息交给主进程追加写入当前项目的「对话记录.md」 */
function persistConversation(role: 'user' | 'assistant', text: string, sessionId: string | null, ts?: number): void {
  const content = String(text || '').trim();
  if (!content) return;
  try {
    const api = (window as any).electronAPI;
    if (api && typeof api.saveConversation === 'function') {
      api.saveConversation({ sessionId: sessionId || null, role: role, text: content, ts: ts || Date.now() }).catch(() => {});
    }
  } catch (_) { /* ignore */ }
}

/**
 * 启动拦截事件监听
 */
function startInterceptObserver(): void {
  // 对话记录：监听主世界派发的"用户消息"事件
  window.addEventListener('cuckoo-user-message', (ev: any) => {
    try {
      const d = ev && ev.detail;
      if (!d || !d.text) return;
      persistConversation('user', d.text, d.sessionId || null, d.ts);
      // 派发给监听器（对话记录插件订阅）
      emitUserMessage({ text: d.text, sessionId: d.sessionId || null, ts: d.ts || Date.now() });
    } catch (_) { /* ignore */ }
  });
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
      // 收到新回复 → 取消"工具循环超时"定时器（已恢复响应）
      try { watchdog.clearToolLoopTimer(); } catch (_) { /* ignore */ }
      // 对话记录：AI 回复落盘（按 responseMessageId 去重，缺失时用文本指纹）
      try {
        const rid = (detail.msgIds && detail.msgIds.responseMessageId) || '';
        const txt = String(detail.text || '');
        const key = 'a:' + (rid || ('len:' + txt.length + ':' + txt.slice(0, 40)));
        if (!savedResponseKeys.has(key)) {
          if (savedResponseKeys.size > 2000) savedResponseKeys.clear();
          savedResponseKeys.add(key);
          persistConversation('assistant', txt, getSessionIdFromUrl(), Date.now());
        }
      } catch (_) { /* ignore */ }
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
  window.addEventListener('cuckoo-ai-stream', (ev: any) => {
    try {
      const detail = ev && ev.detail;
      if (!detail) return;
      // 收到流数据 → 取消"工具循环超时"定时器（AI 已开始/正在响应）
      try { watchdog.clearToolLoopTimer(); } catch (_) { /* ignore */ }
      emitStream({
        think: detail.think || '',
        text: detail.text || '',
        finished: !!detail.finished,
        // 透传服务端权威 token（DeepSeek）；缺失时为 undefined，下游回退估算
        accumulatedTokens: typeof detail.accumulatedTokens === 'number' ? detail.accumulatedTokens : null,
      });
    } catch (_) { /* ignore */ }
  });
  window.addEventListener('cuckoo-ai-error', (ev: any) => {
    try {
      const detail = ev && ev.detail;
      try { watchdog.onResponseReceived('error'); } catch (_) { /* ignore */ }
      // 收到错误 → 取消"工具循环超时"定时器（错误由重试引擎处理）
      try { watchdog.clearToolLoopTimer(); } catch (_) { /* ignore */ }
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

export { startInterceptObserver, processInterceptedResponse, getLastInterceptedText, onInterceptedResponse, onAiError, onToolCall, onStream, onTaskIdle, onUserMessage, requestAbort, clearAbort };

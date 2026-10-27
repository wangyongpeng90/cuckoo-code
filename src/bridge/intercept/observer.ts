/**
 * DeepSeek 拦截模式下的回复处理器（隔离世界）
 * 监听主世界注入的 'cuckoo-ai-response' 事件，收到完整回复后走与 DOM 模式
 * 相同的工具调用/JS 代码块处理流程。
 */
import { extractJsToolBlocks, BT } from '../parser/js-detector.js';
import { looksLikeJsonToolCall } from '../parser/json-detector.js';
import { handleJsToolScript } from '../loop/executor.js';
import { sendCombinedJsResultsToChat, sendMessageToChat, cancelPendingSend, takePendingSendText, getLastToolResultText } from '../../overlay/chat-input.js';
import { showToolMask, hideToolMask } from '../../overlay/panel.js';
import * as watchdog from '../loop/watchdog.js';

// 正文标记：AI 回复里输出 [记忆]xxx，软件据此自动创建
// 中文全角/半角方括号都支持。标记本身会留在 AI 页面的对话正文里（无法隐藏）。
// 只匹配行首（可含前导空白）的标记，避免误伤正文中引用的 `[记忆]` 字样
const MEMORY_MARKER_RE = /^[ \t]*[\[【]记忆[\]】]\s*([^\n]+)/gm;

/**
 * 从 AI 回复正文中提取 [记忆] 标记并触发主进程创建。
 * 失败静默（不影响主流程）。返回提取到的数量。
 * 注意：标记行已由 AI 网页渲染进对话，本函数只负责捕获，不修改显示。
 */
async function processInlineMarkers(text: string): Promise<{ memories: number }> {
  const result = { memories: 0 };
  if (!text) return result;
  const api = (window as any).electronAPI;
  if (!api) return result;

  const memMatches = Array.from(text.matchAll(MEMORY_MARKER_RE));
  for (const m of memMatches) {
    const content = (m[1] || '').trim();
    if (!content) continue;
    try {
      if (api.createMemoryFromMarker) { await api.createMemoryFromMarker(content); result.memories++; }
    } catch (_) { /* ignore */ }
  }
  if (result.memories) {
    console.log('[Cuckoo Code][标记] 记忆=' + result.memories);
  }
  return result;
}


const MAX_JS_RETRY = 3;
// 连续"格式提示"次数（JSON/XML 共用，防止 AI 来回切换格式绕过上限）
let formatHintCount = 0;
const FORMAT_HINT_MAX = 10;

/** AI 回复拦截的默认正则（和 settings.ts 的 DEFAULT_AI_INTERCEPT_PATTERNS 一致） */
const DEFAULT_AI_INTERCEPT_PATTERNS = [
  '^<\\s*｜｜DSML｜｜',
  '<\\s*(?:[\\w-]+:)?invoke\\s+name=',
  '<\\s*\\/\\s*(?:[\\w-]+:)?invoke\\s*>',
  '<\\s*(?:[\\w-]+:)?parameter\\s+name=',
].join('\n');
/** AI 回复拦截的默认提示语 */
const DEFAULT_AI_INTERCEPT_PROMPT = '请使用 cuckoo 代码块进行工具调用，不要使用 XML invoke 格式。';

/** 读取用户配置的拦截正则列表（已编译）。空列表 = 不拦截。 */
function getAiInterceptRegexes(): RegExp[] {
  let raw = '';
  try { raw = localStorage.getItem('cuckoo-ai-intercept-patterns') || ''; } catch (_) { /* ignore */ }
  const source = raw.trim() ? raw : DEFAULT_AI_INTERCEPT_PATTERNS;
  const out: RegExp[] = [];
  for (const line of source.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(new RegExp(s, 'i')); } catch (_) { /* 非法正则跳过（settings 保存时已校验） */ }
  }
  return out;
}

/** 读取用户配置的拦截提示语。 */
function getAiInterceptPrompt(): string {
  try {
    const v = localStorage.getItem('cuckoo-ai-intercept-prompt');
    if (v !== null) return v;
  } catch (_) { /* ignore */ }
  return DEFAULT_AI_INTERCEPT_PROMPT;
}
// 上次已处理的文本（去重，防同一条回复重复处理）
let lastProcessedText = '';
// 最近一次拦截到的完整回复文本（供手动解析复用，不依赖 DOM）
let lastInterceptedText = '';
// [临时诊断] 最近一次回复的 dbg（含 hook 的 opLog）
let lastRespDbg: any = null;
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
 * 执行 JS 代码块，遇到"代码不完整"错误时自动重试。
 * 拦截模式下文本已完整（finished），无需重新提取，简单重试执行即可。
 * @param shouldCancel 取消判定；返回 true 时停止执行后续代码块（已进入执行的块不中断）
 * @returns 已执行块的结果（取消时为已完成的那些块）
 */
async function executeJsBlocksWithRetry(blocks: string[], shouldCancel?: () => boolean): Promise<any[]> {
  // 工具开始（每个代码块一次）
  for (const code of blocks) emitToolCall({ phase: 'start', code });
  let results: any[] = [];
  for (let attempt = 0; attempt <= MAX_JS_RETRY; attempt++) {
    results = [];
    for (const code of blocks) {
      // 用户已取消：不再执行后续代码块，仅保留已执行块的结果
      if (shouldCancel && shouldCancel()) break;
      const r = await handleJsToolScript(code);
      if (r) results.push(r);
    }
    if (shouldCancel && shouldCancel()) break;
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

  // 0. 正文标记：[记忆]xxx（独立于工具调用，无论后续走哪条路都先处理）
  try { await processInlineMarkers(raw); } catch (_) { /* ignore */ }

  // 1. 优先检测 JS 工具代码块（cuckoo / js 代码块）
  const jsBlocks = extractJsToolBlocks(raw);
  // [临时诊断] 定位「有块却识别不到」——失败时落盘全文
  try {
    const BT3 = BT + BT + BT;
    const fenceCount = raw.split(BT3).length - 1;
    const hasCuckooWord = raw.indexOf('cuckoo') >= 0;
    const fenceLangs = raw.split(String.fromCharCode(10)).map(function (l) { return l.trim(); }).filter(function (l) { return l.indexOf(BT3) === 0; }).map(function (l) { return l.slice(3).trim().split(' ')[0]; }).slice(0, 10);
    console.log('[Cuckoo Code][诊断] 原文特征: 长度=' + raw.length + ' 围栏符号数=' + fenceCount + ' 含cuckoo字=' + hasCuckooWord + ' 围栏语言=' + JSON.stringify(fenceLangs) + ' 提取块数=' + jsBlocks.length);
    // 有 cuckoo 字但提取 0 块 → 打全文供分析（用分隔标记包裹，便于日志提取）
    if (hasCuckooWord && jsBlocks.length === 0) {
      console.log('[Cuckoo Code][诊断] 提取失败全文 >>>' + raw + '<<< 全文结束');
      try { console.log('[Cuckoo Code][诊断] opLog=' + JSON.stringify(lastRespDbg && lastRespDbg.opLog)); } catch (_) {}
    }
  } catch (e) { /* ignore */ }
  if (jsBlocks.length > 0) {
    console.log('[Cuckoo Code][拦截] 检测到 JS 工具代码块（' + jsBlocks.length + ' 个），开始执行');
    formatHintCount = 0;
    // 从检测到工具调用到结果发送完成，全程遮盖页面，禁止用户额外操作；
    // 工具执行期间同样显示「停止」按钮，点击可取消（长任务可中止）
    let cancelled = false;
    const onCancel = () => {
      cancelled = true;
      cancelPendingSend();
      hideToolMask();
    };
    showToolMask(onCancel);
    let results: any[] = [];
    try {
      results = await executeJsBlocksWithRetry(jsBlocks, () => cancelled);
    } catch (err) {
      hideToolMask();
      throw err;
    }
    // 用户已取消：丢弃执行结果，不再回传
    if (cancelled) {
      hideToolMask();
      return;
    }
    if (results.length === 0) {
      hideToolMask();
      return;
    }
    // 等待发送阶段：遮罩保持「停止」按钮（onCancel 复用），点击可取消回传
    showToolMask(onCancel);
    if (abortRequested) { abortRequested = false; hideToolMask(); console.log('[Cuckoo Code][拦截] 已请求中止，不回传工具结果'); return; }
    // afterSent 在"结果已发出"时触发隐藏；发送失败（找不到输入框等）则立即隐藏兜底
    const sent = await sendCombinedJsResultsToChat(results, hideToolMask);
    if (cancelled) return; // 用户已取消，不再处理
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

  // 3. AI 回复拦截（用户可配置正则，任意命中即提示 AI 改格式）
  const interceptRegexes = getAiInterceptRegexes();
  if (interceptRegexes.some((re) => re.test(raw))) {
    if (formatHintCount >= FORMAT_HINT_MAX) {
      console.log('[Cuckoo Code][拦截] 已连续提示 ' + formatHintCount + ' 次格式问题，停止发送');
      return;
    }
    formatHintCount++;
    console.log('[Cuckoo Code][拦截] 命中 AI 回复拦截规则（第 ' + formatHintCount + ' 次提示）');
    sendMessageToChat(getAiInterceptPrompt(), 'AI回复拦截提示');
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
      lastRespDbg = detail.dbg || null;
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
      emitStream({
        think: detail.think || '',
        text: detail.text || '',
        finished: !!detail.finished,
        // 透传服务端权威 token（DeepSeek）；缺失时为 undefined，下游回退估算
        accumulatedTokens: typeof detail.accumulatedTokens === 'number' ? detail.accumulatedTokens : null,
      });
    } catch (_) { /* ignore */ }
  });
  // 上下文耗尽：hook 检测到 banner_info.call_to_action 含 continue_in_new_chat → 请求主进程自动续接
  window.addEventListener('cuckoo-context-exhausted', (ev: any) => {
    try {
      const detail = ev && ev.detail;
      console.log('[Cuckoo Code][拦截] 上下文已用完，请求自动在新会话续接:', JSON.stringify(detail || {}));
      // 捞回工具结果带到新会话：
      //  1) 优先「刚填入、未及发送」的（耗尽瞬间卡在发送延迟里）
      //  2) 否则用「最近一条已发出的工具结果」（耗尽通常发生在 AI 回复流末尾，此时结果已发出，
      //     但新会话上下文里没有它，需要补发让 AI 知道执行结果）
      let pendingText: string | null = null;
      try {
        cancelPendingSend();
        pendingText = takePendingSendText();
        if (pendingText) {
          console.log('[Cuckoo Code][拦截] 捞回未发出的工具结果，长度=' + pendingText.length);
        } else {
          pendingText = getLastToolResultText() || null;
          if (pendingText) console.log('[Cuckoo Code][拦截] 用最近已发出的工具结果续接，长度=' + pendingText.length);
        }
      } catch (_) { /* ignore */ }
      const api = (window as any).electronAPI;
      if (api && typeof api.contextExhaustedContinue === 'function') {
        api.contextExhaustedContinue({ pendingText }).catch((err: any) => {
          console.error('[Cuckoo Code][拦截] 上下文续接请求失败:', err && err.message);
        });
      }
    } catch (err) {
      console.error('[Cuckoo Code][拦截] 处理上下文耗尽事件出错:', err);
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

export { startInterceptObserver, processInterceptedResponse, processInlineMarkers, getLastInterceptedText, onInterceptedResponse, onAiError, onToolCall, onStream, onTaskIdle, requestAbort, clearAbort };

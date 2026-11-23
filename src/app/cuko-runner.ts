/**
 * [261109-8ms69z-cuko-api] Cuko 后台运行器（主进程）
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 为什么放主进程：原来 fetch / 工具循环都在渲染进程，关掉 Cuko 窗口就全停了，
 * 而且一个窗口只能跑一个会话。现在：
 *   - 每个会话一个独立的运行实例，可以同时跑多个会话（互不干扰）
 *   - 运行状态与消息落库都在主进程，窗口关掉也继续跑
 *   - 窗口重开后用 getRuns() 拿快照恢复现场，再靠 run-event 继续追增量
 */
import { randomUUID } from 'node:crypto';
import { buildPrompt } from '../session/prompt-builder.js';
import { nowLocalIso } from '../infra/time.js';
import { jsRunner } from '../tools/index.js';
import { pickJsResultPhrase, pickJsResultItemTemplate, formatJsResultItemTitle } from '../overlay/js-result-phrases.js';
import {
  createSseDecoder,
  extractCuckooBlocks,
  extractToolNames,
  friendlyError,
  splitPromptByH1,
} from './cuko-run-protocol.js';
import {
  normalizeProtocol,
  joinApiUrl,
  composeFirstUserText,
  buildToolSentText,
  assistantSentText,
  parseStoredUserContent,
  buildChatMessages,
  buildChatCompletionsBody,
  parseJsonObjectParam,
  createChatStreamParser,
  classifyFailure,
  retryDelayMs,
  MAX_RETRIES,
  isContextOverflowError,
  effectiveModelMeta,
  reasoningRequestOf,
} from './cuko-openai.js';
import type { CukoProtocol, ToolRunItem, ModelMeta, ReasoningRequest } from './cuko-openai.js';

export type CukoRunStatus = 'complete' | 'cancelled' | 'error';

export interface CukoRunInputPart {
  type: string;
  [key: string]: any;
}

export interface StartRunParams {
  sessionId: string;
  input: CukoRunInputPart[];
  /** 发起运行的 Cuko 窗口 id（部分工具需要窗口上下文；窗口关了就是失效 id） */
  windowId?: number | null;
  /** [261123-q4h7tn-cuko-openai] 用户消息（由主进程落库；OpenAI 协议必需，Cuko 协议可选） */
  userMessage?: { id: string; content: string };
}

export interface CukoRunSnapshot {
  sessionId: string;
  runId: string;
  phase: 'streaming' | 'tools';
  assistantId: string;
  content: string;
  think: string;
  usage?: any;
  toolMessageId?: string;
  toolParts?: any[];
  startedAt: number;
}

interface CukoRun extends CukoRunSnapshot {
  abort: AbortController;
  aborted: boolean;
  finished: boolean;
  providerSessionId: string;
  projectDir: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  initialInput: CukoRunInputPart[];
  windowId: number | null;
  /** [261123-q4h7tn-cuko-openai] 协议（未设置视为 cuko） */
  protocol?: CukoProtocol;
}

/** 当前正在运行的会话（sessionId → run） */
const runs = new Map<string, CukoRun>();

// ====== 请求日志（页面里可见；主进程发请求后 DevTools Network 看不到） ======
export interface CukoRequestLogEntry {
  id: string;
  ts: string;
  kind: 'run' | 'compress';
  sessionId: string;
  model: string;
  url: string;
  /** 请求体里的 type（普通对话轮次为空，切模型压缩是 compress） */
  type?: string;
  inputCount: number;
  inputChars: number;
  /** 每条 input 的截断预览（最多 10 条，每条 300 字） */
  inputPreview: Array<{ type: string; text: string }>;
  providerSessionId?: string;
  status: 'pending' | 'ok' | 'error';
  httpStatus?: number;
  error?: string;
  durationMs?: number;
}

const REQUEST_LOG_MAX = 100;
const requestLogs: CukoRequestLogEntry[] = [];

const truncate = (text: string, max: number): string =>
  text.length > max ? text.slice(0, max) + '…' : text;

function pushRequestLog(entry: Omit<CukoRequestLogEntry, 'id' | 'ts' | 'status' | 'inputCount' | 'inputChars' | 'inputPreview'> & {
  input: any[];
}): string {
  const id = randomUUID();
  const input = Array.isArray(entry.input) ? entry.input : [];
  requestLogs.unshift({
    id,
    ts: nowLocalIso(),
    status: 'pending',
    inputCount: input.length,
    inputChars: input.reduce((sum, p) => sum + (typeof p?.text === 'string' ? p.text.length : 0), 0),
    inputPreview: input.slice(0, 10).map((p) => ({
      type: String(p?.type || ''),
      text: truncate(String(p?.text ?? p?.filename ?? ''), 300),
    })),
    ...entry,
  });
  if (requestLogs.length > REQUEST_LOG_MAX) requestLogs.length = REQUEST_LOG_MAX;
  return id;
}

function finishRequestLog(id: string, patch: Partial<CukoRequestLogEntry>): void {
  const index = requestLogs.findIndex((item) => item.id === id);
  if (index < 0) return;
  requestLogs[index] = { ...requestLogs[index], ...patch };
}

/** 页面里的请求日志列表（最新在前） */
export function listCukoRequestLogs(): CukoRequestLogEntry[] {
  return requestLogs.map((item) => ({ ...item }));
}

export function clearCukoRequestLogs(): void {
  requestLogs.length = 0;
}

/** 订阅运行事件的 webContents（Cuko 窗口） */
const subscribers = new Set<any>();

function getDb(): any {
  return (global as any).__globalDb;
}

/** 广播事件给所有 Cuko 窗口；窗口关了也不影响，事件直接丢弃 */
function emit(event: Record<string, any>): void {
  for (const wc of subscribers) {
    try {
      if (wc && typeof wc.isDestroyed === 'function' && wc.isDestroyed()) continue;
      wc.send('cuko:run-event', event);
    } catch { /* 窗口已关闭或正在销毁 */ }
  }
}

function snapshotOf(run: CukoRun): CukoRunSnapshot {
  return {
    sessionId: run.sessionId,
    runId: run.runId,
    phase: run.phase,
    assistantId: run.assistantId,
    content: run.content,
    think: run.think,
    usage: run.usage,
    toolMessageId: run.toolMessageId,
    toolParts: run.toolParts,
    startedAt: run.startedAt,
  };
}

/** 把一个 webContents 加入事件订阅（返回退订函数） */
export function subscribeCukoRuns(wc: any): () => void {
  subscribers.add(wc);
  const off = () => { subscribers.delete(wc); };
  try { wc.once('destroyed', off); } catch { /* ignore */ }
  return off;
}

/** 当前所有在跑的会话快照（窗口重开 / 切换会话时用来恢复现场） */
export function listCukoRuns(): CukoRunSnapshot[] {
  return Array.from(runs.values()).map(snapshotOf);
}

function insertMessage(msg: {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  think?: string;
  usage?: any;
  /** [261123-q4h7tn-cuko-openai] 发给模型的原文（写入即固定） */
  sentRole?: string | null;
  sentText?: string | null;
}): void {
  const db = getDb();
  if (!db) return;
  try {
    const now = nowLocalIso();
    db.prepare('INSERT INTO cuko_messages (id, session_id, role, content, think, usage_json, created_at, sent_role, sent_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.sessionId, msg.role, msg.content, msg.think || null, msg.usage ? JSON.stringify(msg.usage) : null, now, msg.sentRole || null, msg.sentText || null);
    db.prepare('UPDATE cuko_sessions SET updated_at = ? WHERE id = ?').run(now, msg.sessionId);
  } catch (err: any) {
    console.error('[Cuko] 消息落库失败:', err?.message || err);
  }
}

function persistProviderSessionId(sessionId: string, providerSessionId: string): void {
  const db = getDb();
  if (!db) return;
  try {
    const now = nowLocalIso();
    db.prepare('UPDATE cuko_sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?')
      .run(providerSessionId, now, sessionId);
  } catch (err: any) {
    console.error('[Cuko] providerSessionId 落库失败:', err?.message || err);
  }
}

interface BuiltFirstInput {
  input: CukoRunInputPart[];
  /** 本轮实际注入的完整系统提示词（空串表示没有注入） */
  promptText: string;
}

/** 首次对话（无 providerSessionId）时把系统提示词按 # 分段拼到 input 前面 */
function withSystemPrompt(input: CukoRunInputPart[], projectDir: string, providerSessionId: string): BuiltFirstInput {
  if (providerSessionId || !projectDir) return { input, promptText: '' };
  try {
    const built = buildPrompt({ providerId: 'cuko', selectedDir: projectDir });
    if (built.error || !built.prompt) return { input, promptText: '' };
    const segments = splitPromptByH1(built.prompt).filter((s) => s && s.trim());
    if (segments.length === 0) return { input, promptText: '' };
    return {
      input: [...segments.map((text) => ({ type: 'text', text })), ...input],
      promptText: built.prompt,
    };
  } catch (err: any) {
    console.error('[Cuko] 组装系统提示词失败:', err?.message || err);
    return { input, promptText: '' };
  }
}

/**
 * 首轮注入的完整提示词留档：
 * - cuko_sessions.system_prompt：会话级字段，切模型压缩时要用
 * - cuko_messages 里再插一条 role='system'，让消息表本身就能看到这次请求带了什么
 *   （渲染层 switchThread 会过滤 role='system'，聊天界面不展示）
 */
function persistSystemPrompt(sessionId: string, prompt: string): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare('UPDATE cuko_sessions SET system_prompt = ? WHERE id = ?').run(prompt, sessionId);
  } catch (err: any) {
    console.error('[Cuko] 系统提示词落库失败:', err?.message || err);
    return;
  }
  try {
    // 同一段提示词重复注入（比如 provider 没返回 session id 又发了一轮）不重复插行
    const last = db.prepare("SELECT content FROM cuko_messages WHERE session_id = ? AND role = 'system' ORDER BY rowid DESC LIMIT 1").get(sessionId) as any;
    if (last && last.content === prompt) return;
    db.prepare('INSERT INTO cuko_messages (id, session_id, role, content, think, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), sessionId, 'system', prompt, null, null, nowLocalIso());
  } catch (err: any) {
    console.error('[Cuko] 系统提示词写入消息表失败:', err?.message || err);
  }
}

interface RoundResult {
  content: string;
  think: string;
  usage?: any;
  sawDone: boolean;
  aborted: boolean;
  error?: string;
  /** [261123-q4h7tn-cuko-openai] OpenAI 协议：本轮 assistant 原文（null = 不进历史） */
  sentText?: string | null;
}

/** 跑一轮请求：POST /v1/responses，解析 SSE，返回累计内容 */
async function streamRound(
  run: CukoRun,
  input: CukoRunInputPart[],
  providerSessionId: string,
  requestType: 'user' | 'tool',
): Promise<RoundResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (run.apiKey) headers.Authorization = 'Bearer ' + run.apiKey;

  const body: Record<string, any> = {
    cuckSessionId: run.sessionId,
    requestId: randomUUID(),
    model: run.modelId,
    // 顶层 type 区分请求来源：user=用户输入，tool=工具执行结果（compress 用于切模型压缩）
    type: requestType,
    input,
  };
  if (providerSessionId) body.providerSessionId = providerSessionId;

  let content = '';
  let think = '';
  let usage: any;
  let sawDone = false;
  let aborted = false;
  let error: string | undefined;
  let currentProviderSessionId = providerSessionId;

  const seeProviderSession = (value: string) => {
    if (!value || value === currentProviderSessionId) return;
    currentProviderSessionId = value;
    run.providerSessionId = value;
    persistProviderSessionId(run.sessionId, value);
    emit({ type: 'provider-session', sessionId: run.sessionId, providerSessionId: value });
  };

  const decoder = createSseDecoder((eventName, data) => {
    if (sawDone) return;
    if (eventName === 'message') {
      try {
        const payload = JSON.parse(data);
        if (payload.providerSessionId) seeProviderSession(payload.providerSessionId);
        let delta = '';
        if (Array.isArray(payload.output)) {
          delta = payload.output.map((x: any) => (typeof x === 'string' ? x : x && x.text ? x.text : '')).join('');
        } else if (typeof payload.output === 'string') {
          delta = payload.output;
        }
        const thinkDelta = typeof payload.think === 'string' ? payload.think : '';
        if (!delta && !thinkDelta) return;
        content += delta;
        think += thinkDelta;
        run.content = content;
        run.think = think;
        emit({ type: 'delta', sessionId: run.sessionId, assistantId: run.assistantId, delta, thinkDelta });
      } catch { /* 非 JSON 帧忽略 */ }
    } else if (eventName === 'done') {
      sawDone = true;
      try {
        const payload = JSON.parse(data);
        usage = payload.usage;
        if (payload.providerSessionId) seeProviderSession(payload.providerSessionId);
      } catch { /* ignore */ }
    } else if (eventName === 'error') {
      sawDone = true;
      try {
        const payload = JSON.parse(data);
        error = friendlyError(payload.code || 'internal_error', payload.message || '');
      } catch {
        error = data;
      }
      content += '\n\n⚠️ ' + error;
    }
  });

  const url = run.baseUrl.replace(/\/+$/, '') + '/v1/responses';
  const startedAt = Date.now();
  const logId = pushRequestLog({
    kind: 'run',
    sessionId: run.sessionId,
    model: run.modelId,
    url,
    type: requestType,
    input,
    providerSessionId: providerSessionId || undefined,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: run.abort.signal,
    });
    finishRequestLog(logId, { httpStatus: response.status });
    if (!response.ok || !response.body) {
      let errText = 'HTTP ' + response.status;
      try { const t = await response.text(); if (t) errText += ': ' + t; } catch { /* ignore */ }
      throw new Error(errText);
    }
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      decoder.push(textDecoder.decode(value, { stream: true }));
    }
    decoder.push(textDecoder.decode());
    decoder.flush();
  } catch (err: any) {
    if (err?.name === 'AbortError' || run.aborted) {
      aborted = true;
      content += '\n\n（已停止）';
    } else {
      error = err?.message || '请求失败';
      content += '\n\n⚠️ ' + error;
    }
  }

  // [261123-q4h7tn-cuko-openai] 流读完却没收到 done / error：连接中途断开，回复不完整
  if (!aborted && !error && !sawDone) {
    error = '连接中断，回复不完整';
    content += '\n\n⚠️ ' + error;
  }
  run.content = content;
  run.think = think;
  run.usage = usage;
  finishRequestLog(logId, {
    status: error || aborted ? 'error' : 'ok',
    error: error || (aborted ? '已停止' : undefined),
    providerSessionId: run.providerSessionId || undefined,
    durationMs: Date.now() - startedAt,
  });
  return { content, think, usage, sawDone, aborted, error };
}

interface ToolExecResult {
  success: boolean;
  output?: string;
  error?: string;
}

/** 执行一组 cuckoo 代码块：发 tool-* 事件、落工具消息，返回每个脚本的结果 */
async function executeToolBlocks(run: CukoRun, blocks: string[]): Promise<ToolExecResult[]> {
  run.phase = 'tools';
  run.toolMessageId = randomUUID();
  run.toolParts = [];
  emit({ type: 'tool-start', sessionId: run.sessionId, toolMessageId: run.toolMessageId, parts: run.toolParts });

  const results: ToolExecResult[] = [];
  for (const code of blocks) {
    if (run.aborted) break;
    const toolCallId = randomUUID();
    const toolNames = extractToolNames(code);
    const part: any = {
      type: 'tool-call',
      toolCallId,
      toolName: toolNames.length ? toolNames.join(' + ') : 'cuckoo',
      args: {},
      argsText: code,
      result: undefined,
    };
    run.toolParts = [...(run.toolParts || []), part];
    emit({ type: 'tool-update', sessionId: run.sessionId, toolMessageId: run.toolMessageId, parts: run.toolParts });

    let r: ToolExecResult;
    try {
      r = await jsRunner.run(code, run.projectDir || null, run.windowId, {});
    } catch (err: any) {
      r = { success: false, error: err?.message || '执行失败' };
    }
    results.push(r);
    run.toolParts = (run.toolParts || []).map((p: any) =>
      p.toolCallId === toolCallId
        ? { ...p, result: r.success ? (r.output || '') : (r.error || ''), isError: !r.success }
        : p,
    );
    emit({ type: 'tool-update', sessionId: run.sessionId, toolMessageId: run.toolMessageId, parts: run.toolParts });
  }

  insertMessage({
    id: run.toolMessageId,
    sessionId: run.sessionId,
    role: 'assistant',
    content: JSON.stringify(run.toolParts || []),
    ...toolSentFields(run, results, blocks.length),
  });
  emit({ type: 'tool-complete', sessionId: run.sessionId, toolMessageId: run.toolMessageId, parts: run.toolParts });
  return results;
}

/** 工具执行结果 → 下一轮 input（回复语 + 每个结果） */
function buildToolInput(results: ToolExecResult[]): CukoRunInputPart[] {
  let phrase = '执行了 ' + results.length + ' 个脚本';
  try {
    const picked = pickJsResultPhrase(results.length || 1);
    if (picked) phrase = picked;
  } catch { /* 用默认回复语 */ }
  return [
    { type: 'text', text: phrase },
    ...results.map((r) => ({
      type: 'text',
      text: r.success ? (r.output || '(脚本执行完成，无输出)') : '错误原因: ' + (r.error || '未知错误'),
    })),
  ];
}

/** 运行主循环：请求 → 落库 → 有 cuckoo 块则执行工具 → 下一轮
 *  initialContent：切模型压缩的回复里已有 cuckoo 块时，先执行它们再继续 */
async function runLoop(run: CukoRun, initialContent?: string): Promise<void> {
  let currentInput = run.initialInput;
  let requestType: 'user' | 'tool' = 'user';
  try {
    if (initialContent) {
      const blocks = extractCuckooBlocks(initialContent);
      if (blocks.length === 0) {
        finishRun(run, 'complete');
        return;
      }
      const results = await executeToolBlocks(run, blocks);
      if (run.aborted) {
        finishRun(run, 'cancelled');
        return;
      }
      requestType = 'tool';
      currentInput = buildToolInput(results);
    }
    for (;;) {
      if (run.aborted) break;

      const assistantId = randomUUID();
      run.assistantId = assistantId;
      run.phase = 'streaming';
      run.content = '';
      run.think = '';
      run.usage = undefined;
      run.toolMessageId = undefined;
      run.toolParts = undefined;
      emit({ type: 'run-start', sessionId: run.sessionId, runId: run.runId, assistantId, startedAt: run.startedAt });

      // [261123-q4h7tn-cuko-openai] 按协议分流：OpenAI 每轮从库里重放原文，Cuko 只发增量
      const round = run.protocol === 'openai'
        ? await streamOpenAiRound(run)
        : await streamRound(run, currentInput, run.providerSessionId, requestType);

      insertMessage({
        id: assistantId,
        sessionId: run.sessionId,
        role: 'assistant',
        content: round.content,
        think: round.think,
        usage: round.usage,
        sentRole: round.sentText ? 'assistant' : null,
        sentText: round.sentText || null,
      });
      emit({
        type: 'round-complete',
        sessionId: run.sessionId,
        assistantId,
        content: round.content,
        think: round.think,
        usage: round.usage,
        status: round.aborted ? 'cancelled' : round.error ? 'error' : 'complete',
      });

      // 中断 / 出错不执行工具
      // [261123-q4h7tn-cuko-openai] 中断不执行工具；出错 / 中途断开同样不执行，并以 error 结束运行
      if (round.aborted) break;
      if (round.error || !round.sawDone) {
        finishRun(run, 'error', round.error || '连接中断，回复不完整');
        return;
      }

      const blocks = extractCuckooBlocks(round.content);
      if (blocks.length === 0) break;

      const results = await executeToolBlocks(run, blocks);
      if (run.aborted) break;
      // 工具循环回传：input 元素仍是 text，靠外层 type: "tool" 区分
      requestType = 'tool';
      currentInput = buildToolInput(results);
    }
  } catch (err: any) {
    finishRun(run, run.aborted ? 'cancelled' : 'error', err?.message || String(err));
    return;
  }
  finishRun(run, run.aborted ? 'cancelled' : 'complete');
}

function finishRun(run: CukoRun, status: CukoRunStatus, error?: string): void {
  if (run.finished) return;
  run.finished = true;
  runs.delete(run.sessionId);
  emit({ type: 'run-complete', sessionId: run.sessionId, runId: run.runId, status, error });
}

/** 启动一个会话的后台运行；同一会话同时只允许一个 */
export function startCukoRun(params: StartRunParams): { success: boolean; runId?: string; error?: string } {
  const sessionId = String(params?.sessionId || '');
  if (!sessionId) return { success: false, error: '缺少会话 ID' };
  if (runs.has(sessionId)) return { success: false, error: '该会话正在运行，请先停止' };

  const db = getDb();
  if (!db) return { success: false, error: '数据库未就绪' };

  let session: any;
  try {
    session = db.prepare('SELECT * FROM cuko_sessions WHERE id = ?').get(sessionId);
  } catch (err: any) {
    return { success: false, error: err?.message || '读取会话失败' };
  }
  if (!session) return { success: false, error: '会话不存在' };
  if (!session.provider_id || !session.model_id) return { success: false, error: '尚未选择模型，请先配置' };

  let provider: any;
  try {
    provider = db.prepare('SELECT * FROM cuko_providers WHERE id = ?').get(session.provider_id);
  } catch (err: any) {
    return { success: false, error: err?.message || '读取 Provider 失败' };
  }
  if (!provider || !provider.base_url) return { success: false, error: 'Provider 不存在，请重新配置' };

  const input = Array.isArray(params.input) ? params.input.filter((p) => p && typeof p.type === 'string') : [];
  if (input.length === 0) return { success: false, error: '消息内容为空' };

  const protocol = normalizeProtocol(provider.protocol);
  const providerSessionId = session.provider_session_id || '';
  const projectDir = session.project_dir || '';
  let firstInput: CukoRunInputPart[] = input;
  if (protocol === 'openai') {
    // [261123-q4h7tn-cuko-openai] 用户消息由主进程落库并固定原文（第一条拼上系统提示词）
    const prep = prepareOpenAiUserTurn(sessionId, projectDir, params.userMessage);
    if (!prep.ok) return { success: false, error: prep.error };
  } else {
    const first = withSystemPrompt(input, projectDir, providerSessionId);
    firstInput = first.input;
    if (first.promptText) persistSystemPrompt(sessionId, first.promptText);
    // 新版界面把用户消息交给主进程落库；旧版界面自己存（不传 userMessage）
    if (params.userMessage && params.userMessage.id) {
      insertMessage({ id: params.userMessage.id, sessionId, role: 'user', content: String(params.userMessage.content ?? '') });
    }
  }

  const run: CukoRun = {
    sessionId,
    runId: randomUUID(),
    phase: 'streaming',
    assistantId: '',
    content: '',
    think: '',
    usage: undefined,
    toolMessageId: undefined,
    toolParts: undefined,
    startedAt: Date.now(),
    abort: new AbortController(),
    aborted: false,
    finished: false,
    providerSessionId,
    projectDir,
    baseUrl: provider.base_url,
    apiKey: provider.api_key || '',
    modelId: session.model_id,
    initialInput: firstInput,
    protocol,
    windowId: typeof params.windowId === 'number' ? params.windowId : null,
  };

  runs.set(sessionId, run);
  // 不 await：IPC 立即返回，循环在后台继续跑（窗口关了也跑）
  void runLoop(run);
  return { success: true, runId: run.runId };
}

export interface ContinueAfterSwitchParams {
  sessionId: string;
  assistantId: string;
  windowId?: number | null;
}

/**
 * 切模型压缩的回复里如果带 cuckoo 工具块，从这条助手消息继续：
 * 先执行工具，再把结果以顶层 type:"tool" 发给新模型，进入正常循环。
 */
export function continueAfterSwitch(params: ContinueAfterSwitchParams): {
  success: boolean;
  runId?: string;
  skipped?: boolean;
  error?: string;
} {
  const sessionId = String(params?.sessionId || '');
  const assistantId = String(params?.assistantId || '');
  if (!sessionId || !assistantId) return { success: false, error: '参数不完整' };
  if (runs.has(sessionId)) return { success: false, error: '该会话正在运行' };

  const db = getDb();
  if (!db) return { success: false, error: '数据库未就绪' };

  let session: any;
  try {
    session = db.prepare('SELECT * FROM cuko_sessions WHERE id = ?').get(sessionId);
  } catch (err: any) {
    return { success: false, error: err?.message || '读取会话失败' };
  }
  if (!session) return { success: false, error: '会话不存在' };
  if (!session.provider_id || !session.model_id) return { success: false, error: '尚未选择模型，请先配置' };
  if (!session.provider_session_id) return { success: false, error: '缺少 Provider 会话状态，请重新切换模型' };

  let provider: any;
  try {
    provider = db.prepare('SELECT * FROM cuko_providers WHERE id = ?').get(session.provider_id);
  } catch (err: any) {
    return { success: false, error: err?.message || '读取 Provider 失败' };
  }
  if (!provider || !provider.base_url) return { success: false, error: 'Provider 不存在，请重新配置' };

  let msg: any;
  try {
    msg = db.prepare("SELECT content FROM cuko_messages WHERE id = ? AND session_id = ? AND role = 'assistant'").get(assistantId, sessionId);
  } catch (err: any) {
    return { success: false, error: err?.message || '读取回复失败' };
  }
  if (!msg) return { success: false, error: '找不到切模型回复' };

  const content = String(msg.content || '');
  if (extractCuckooBlocks(content).length === 0) return { success: true, skipped: true };

  const run: CukoRun = {
    sessionId,
    runId: randomUUID(),
    phase: 'tools',
    assistantId: '',
    content: '',
    think: '',
    usage: undefined,
    toolMessageId: undefined,
    toolParts: undefined,
    startedAt: Date.now(),
    abort: new AbortController(),
    aborted: false,
    finished: false,
    providerSessionId: session.provider_session_id,
    projectDir: session.project_dir || '',
    baseUrl: provider.base_url,
    apiKey: provider.api_key || '',
    modelId: session.model_id,
    initialInput: [],
    windowId: typeof params.windowId === 'number' ? params.windowId : null,
  };

  runs.set(sessionId, run);
  void runLoop(run, content);
  return { success: true, runId: run.runId };
}


/** 停止某个会话的后台运行 */
export function cancelCukoRun(sessionId: string): { success: boolean; error?: string } {
  const run = runs.get(String(sessionId || ''));
  if (!run) return { success: false, error: '没有正在运行的任务' };
  run.aborted = true;
  try { run.abort.abort(); } catch { /* ignore */ }
  return { success: true };
}

export interface SwitchModelParams {
  sessionId: string;
  providerId: string;
  modelId: string;
  /** 已压缩好的历史（每条消息一个 text 元素），由渲染层按规则生成 */
  history: Array<{ type: string; text: string }>;
}

/**
 * 切换模型：把历史对话以 type: "compress" 发给新模型，建立新的 Provider 会话状态，
 * 成功后才更新库里的 provider/model/provider_session_id。
 * 失败不改任何绑定，让用户可以重试或留在旧模型上。
 */
export async function switchModelWithHistory(params: SwitchModelParams): Promise<{
  success: boolean;
  error?: string;
  providerSessionId?: string;
  inputCount?: number;
  /** 压缩请求本身也是一次 /v1/responses，模型返回的正文要展示并落库 */
  reply?: { id: string; content: string; think?: string; usage?: any };
  /** 回复里是否带 cuckoo 工具块（需要继续执行工具） */
  hasToolBlocks?: boolean;
}> {
  const sessionId = String(params?.sessionId || '');
  const providerId = String(params?.providerId || '');
  const modelId = String(params?.modelId || '');
  if (!sessionId || !providerId || !modelId) return { success: false, error: '参数不完整' };
  if (runs.has(sessionId)) return { success: false, error: '该会话正在运行，请先停止再切换模型' };

  const db = getDb();
  if (!db) return { success: false, error: '数据库未就绪' };

  let session: any;
  let provider: any;
  try {
    session = db.prepare('SELECT * FROM cuko_sessions WHERE id = ?').get(sessionId);
    provider = db.prepare('SELECT * FROM cuko_providers WHERE id = ?').get(providerId);
  } catch (err: any) {
    return { success: false, error: err?.message || '读取配置失败' };
  }
  if (!session) return { success: false, error: '会话不存在' };
  if (!provider || !provider.base_url) return { success: false, error: 'Provider 不存在' };

  const history = Array.isArray(params.history)
    ? params.history.filter((p) => p && p.type === 'text' && typeof p.text === 'string' && p.text.trim())
    : [];
  if (history.length === 0) return { success: false, error: '没有可同步的历史内容' };

  // 新模型没有旧的会话状态，系统提示词要重新给一遍，否则它不知道工具怎么用
  const systemPrompt = String(session.system_prompt || '').trim();
  const systemParts = systemPrompt
    ? splitPromptByH1(systemPrompt).filter((s) => s && s.trim()).map((text) => ({ type: 'text', text }))
    : [];
  const input = [...systemParts, ...history];

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (provider.api_key) headers.Authorization = 'Bearer ' + provider.api_key;

  const body: Record<string, any> = {
    cuckSessionId: sessionId,
    requestId: randomUUID(),
    model: modelId,
    input,
    type: 'compress',
  };

  let providerSessionId = '';
  let remoteError = '';
  let replyContent = '';
  let replyThink = '';
  let replyUsage: any;
  const decoder = createSseDecoder((eventName, data) => {
    if (eventName === 'message' || eventName === 'done') {
      try {
        const payload = JSON.parse(data);
        if (payload && payload.providerSessionId) providerSessionId = String(payload.providerSessionId);
        if (eventName === 'message') {
          let delta = '';
          if (Array.isArray(payload.output)) {
            delta = payload.output.map((x: any) => (typeof x === 'string' ? x : x && x.text ? x.text : '')).join('');
          } else if (typeof payload.output === 'string') {
            delta = payload.output;
          }
          replyContent += delta;
          if (typeof payload.think === 'string') replyThink += payload.think;
        } else {
          replyUsage = payload.usage;
        }
      } catch { /* 非 JSON 帧忽略 */ }
    } else if (eventName === 'error') {
      try {
        const payload = JSON.parse(data);
        remoteError = friendlyError(payload.code || 'internal_error', payload.message || '');
      } catch {
        remoteError = data;
      }
    }
  });

  const url = String(provider.base_url).replace(/\/+$/, '') + '/v1/responses';
  const startedAt = Date.now();
  const logId = pushRequestLog({
    kind: 'compress',
    sessionId,
    model: modelId,
    url,
    type: 'compress',
    input,
  });
  const fail = (message: string) => {
    finishRequestLog(logId, { status: 'error', error: message, durationMs: Date.now() - startedAt });
    return { success: false, error: message };
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    finishRequestLog(logId, { httpStatus: response.status });
    if (!response.ok || !response.body) {
      let errText = 'HTTP ' + response.status;
      try { const t = await response.text(); if (t) errText += ': ' + t; } catch { /* ignore */ }
      return fail(errText);
    }
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      decoder.push(textDecoder.decode(value, { stream: true }));
    }
    decoder.push(textDecoder.decode());
    decoder.flush();
  } catch (err: any) {
    return fail(err?.message || '历史同步请求失败');
  }

  if (remoteError) return fail(remoteError);

  try {
    const now = nowLocalIso();
    db.prepare('UPDATE cuko_sessions SET provider_id = ?, model_id = ?, provider_session_id = ?, updated_at = ? WHERE id = ?')
      .run(providerId, modelId, providerSessionId || null, now, sessionId);
  } catch (err: any) {
    return fail(err?.message || '保存模型绑定失败');
  }

  // 压缩请求的返回正文同样落库 + 回传渲染层展示（它也是一次正常的 responses 请求）
  let reply: { id: string; content: string; think?: string; usage?: any } | undefined;
  if (replyContent.trim() || replyThink.trim()) {
    const replyId = randomUUID();
    insertMessage({
      id: replyId,
      sessionId,
      role: 'assistant',
      content: replyContent,
      think: replyThink,
      usage: replyUsage,
    });
    reply = { id: replyId, content: replyContent, think: replyThink || undefined, usage: replyUsage };
  }

  finishRequestLog(logId, {
    status: 'ok',
    providerSessionId: providerSessionId || undefined,
    durationMs: Date.now() - startedAt,
  });
  return {
    success: true,
    providerSessionId,
    inputCount: input.length,
    reply,
    hasToolBlocks: !!reply && extractCuckooBlocks(reply.content).length > 0,
  };
}

/** 进程退出前停掉所有运行 */
export function cancelAllCukoRuns(): void {
  for (const run of runs.values()) {
    run.aborted = true;
    try { run.abort.abort(); } catch { /* ignore */ }
  }
}

// ================= [261123-q4h7tn-cuko-openai] OpenAI 兼容协议（Chat Completions） =================
// 设计见 docs/requirements/261123-q4h7tn-cuko-openai.md：
// 原文写入即固定、每轮原样重放（前缀不变以命中缓存）；失败尝试不进历史；临时错误原样重发重试。

/** 与网页模式一致：单个脚本结果超过这个长度就截断 */
const OPENAI_TOOL_OUTPUT_MAX = 15000;

function truncateToolOutput(text: string): string {
  const s = String(text ?? '').trim();
  return s.length > OPENAI_TOOL_OUTPUT_MAX ? s.slice(0, OPENAI_TOOL_OUTPUT_MAX) + '\n...[输出过长已截断]...' : s;
}

/** 工具卡片的原文（仅 OpenAI 协议）：回复语 + 每个脚本「标题 + 结果」；被停止没跑的脚本标为未执行 */
function toolSentFields(run: CukoRun, results: ToolExecResult[], total: number): { sentRole?: string; sentText?: string } {
  if (run.protocol !== 'openai') return {};
  const items: ToolRunItem[] = [];
  for (let i = 0; i < total; i++) {
    const r = results[i];
    if (!r) items.push({ status: 'skipped' });
    else if (r.success) items.push({ status: 'ok', text: truncateToolOutput(r.output || '') });
    else items.push({ status: 'error', text: r.error || '未知错误' });
  }
  let phrase = '执行了 ' + total + ' 个脚本，结果如下：';
  try {
    const picked = pickJsResultPhrase(total || 1);
    if (picked) phrase = picked;
  } catch { /* 用默认回复语 */ }
  let template = '';
  try {
    template = pickJsResultItemTemplate();
  } catch { /* 用默认标题 */ }
  const title = template ? (i: number, ok: boolean) => formatJsResultItemTitle(template, i, ok) : undefined;
  return { sentRole: 'user', sentText: buildToolSentText(phrase, items, title) };
}

/** 首轮完整系统提示词（未绑定工作区时为空） */
function buildSystemPromptText(projectDir: string): string {
  if (!projectDir) return '';
  try {
    const built = buildPrompt({ providerId: 'cuko', selectedDir: projectDir });
    if (built.error || !built.prompt) return '';
    return String(built.prompt).trim();
  } catch (err: any) {
    console.error('[Cuko] 组装系统提示词失败:', err?.message || err);
    return '';
  }
}

type PrepareUserTurnResult = { ok: true } | { ok: false; error: string };

/** OpenAI 协议：用户消息由主进程落库并固定原文；会话还没有任何原文时拼上系统提示词 */
function prepareOpenAiUserTurn(sessionId: string, projectDir: string, userMessage: StartRunParams['userMessage']): PrepareUserTurnResult {
  if (!userMessage || !userMessage.id) {
    return { ok: false, error: 'OpenAI 协议需要由主进程保存用户消息，当前界面版本过旧，请更新后重试' };
  }
  const raw = String(userMessage.content ?? '');
  const parsed = parseStoredUserContent(raw);
  if (parsed.attachmentNames.length > 0) return { ok: false, error: '当前模型暂不支持附件，请移除附件后再发送' };
  const db = getDb();
  if (!db) return { ok: false, error: '数据库未就绪' };
  let isFirst = true;
  try {
    const row = db.prepare("SELECT COUNT(*) AS c FROM cuko_messages WHERE session_id = ? AND sent_text IS NOT NULL AND sent_text != ''").get(sessionId) as any;
    isFirst = !row || !row.c;
  } catch (err: any) {
    return { ok: false, error: '读取历史失败：' + (err?.message || String(err)) };
  }
  let sentText = parsed.text;
  if (isFirst) {
    const prompt = buildSystemPromptText(projectDir);
    if (prompt) {
      persistSystemPrompt(sessionId, prompt);
      sentText = composeFirstUserText(prompt, sentText);
    }
  }
  if (!sentText.trim()) return { ok: false, error: '消息内容为空' };
  insertMessage({ id: userMessage.id, sessionId, role: 'user', content: raw, sentRole: 'user', sentText });
  return { ok: true };
}

interface OpenAiRequestOptions {
  extraParams: Record<string, any> | null;
  maxTokens: number | null;
  reasoning: ReasoningRequest | null;
}

function parseMetaJson(text: unknown): ModelMeta | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ModelMeta) : null;
  } catch {
    return null;
  }
}

/** 每轮请求前从库里读：额外参数、模型最大输出、会话思考强度（改了从下一次请求生效） */
function loadOpenAiRequestOptions(run: CukoRun): OpenAiRequestOptions {
  const out: OpenAiRequestOptions = { extraParams: null, maxTokens: null, reasoning: null };
  const db = getDb();
  if (!db) return out;
  try {
    const session = db.prepare('SELECT provider_id, reasoning_effort FROM cuko_sessions WHERE id = ?').get(run.sessionId) as any;
    const providerId = session?.provider_id || '';
    const provider = db.prepare('SELECT extra_params, reasoning_field, disable_reasoning_params FROM cuko_providers WHERE id = ?').get(providerId) as any;
    const model = db.prepare('SELECT api_meta, user_meta FROM cuko_models WHERE provider_id = ? AND model_id = ?').get(providerId, run.modelId) as any;
    const extra = parseJsonObjectParam(String(provider?.extra_params || ''));
    if (extra.ok) out.extraParams = extra.value;
    const meta = effectiveModelMeta(parseMetaJson(model?.api_meta), parseMetaJson(model?.user_meta));
    if (typeof meta.maxTokens === 'number' && meta.maxTokens > 0) out.maxTokens = meta.maxTokens;
    const disable = parseJsonObjectParam(String(provider?.disable_reasoning_params || ''));
    out.reasoning = reasoningRequestOf(meta, session?.reasoning_effort, {
      field: provider?.reasoning_field || null,
      disableParams: disable.ok ? disable.value : null,
    });
  } catch (err: any) {
    console.error('[Cuko] 读取 OpenAI 请求参数失败:', err?.message || err);
  }
  return out;
}

/** 等待 ms 毫秒；期间被停止返回 false */
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface OpenAiAttempt {
  content: string;
  think: string;
  usage?: any;
  sawDone: boolean;
  aborted: boolean;
  httpStatus?: number;
  networkError: boolean;
  streamError?: string;
  errorText?: string;
}

/** 一次 Chat Completions 请求（流式）；每次尝试都记一条请求日志 */
async function openAiAttempt(run: CukoRun, url: string, headers: Record<string, string>, bodyText: string, logInput: any[], attempt: number): Promise<OpenAiAttempt> {
  const parser = createChatStreamParser((delta, thinkDelta) => {
    run.content += delta;
    run.think += thinkDelta;
    emit({ type: 'delta', sessionId: run.sessionId, assistantId: run.assistantId, delta, thinkDelta });
  });
  const startedAt = Date.now();
  const logId = pushRequestLog({
    kind: 'run',
    sessionId: run.sessionId,
    model: run.modelId,
    url,
    type: attempt > 0 ? 'openai（第 ' + attempt + ' 次重试）' : 'openai',
    input: logInput,
  });
  let httpStatus: number | undefined;
  let networkError = false;
  let aborted = false;
  let errorText: string | undefined;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: bodyText, signal: run.abort.signal });
    httpStatus = response.status;
    finishRequestLog(logId, { httpStatus });
    if (!response.ok || !response.body) {
      let detail = '';
      try {
        detail = await response.text();
      } catch { /* ignore */ }
      errorText = 'HTTP ' + response.status + (detail ? ': ' + detail.slice(0, 2000) : '');
    } else {
      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(textDecoder.decode(value, { stream: true }));
      }
      parser.push(textDecoder.decode());
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || run.aborted) {
      aborted = true;
    } else {
      networkError = true;
      errorText = err?.message || '网络错误';
    }
  }
  if (run.aborted) aborted = true;
  const res = parser.finish();
  const failed = aborted || !!errorText || !!res.error || !res.sawDone;
  finishRequestLog(logId, {
    status: failed ? 'error' : 'ok',
    error: aborted ? '已停止' : (errorText || res.error || (res.sawDone ? undefined : '连接中断，回复不完整')),
    durationMs: Date.now() - startedAt,
  });
  return {
    content: res.content,
    think: res.think,
    usage: res.usage,
    sawDone: res.sawDone,
    aborted,
    httpStatus,
    networkError,
    streamError: res.error,
    errorText: errorText || res.error,
  };
}

/**
 * OpenAI 协议的一轮：按 rowid 顺序重放库里的原文 → 请求 → 解析；
 * 临时错误（网络 / 断开 / 429 / 5xx）原样重发，最多 MAX_RETRIES 次。
 * 停止：已输出的正文进历史；出错 / 断开：不进历史（sentText 为空）。
 */
async function streamOpenAiRound(run: CukoRun): Promise<RoundResult> {
  const db = getDb();
  let rows: any[] = [];
  try {
    rows = db ? (db.prepare('SELECT sent_role, sent_text FROM cuko_messages WHERE session_id = ? ORDER BY rowid ASC').all(run.sessionId) as any[]) : [];
  } catch (err: any) {
    const error = '读取历史失败：' + (err?.message || String(err));
    return { content: '⚠️ ' + error, think: '', sawDone: false, aborted: false, error };
  }
  const messages = buildChatMessages(rows);
  if (messages.length === 0) {
    const error = '没有可发送的内容';
    return { content: '⚠️ ' + error, think: '', sawDone: false, aborted: false, error };
  }
  const opts = loadOpenAiRequestOptions(run);
  const body = buildChatCompletionsBody({ model: run.modelId, messages, extraParams: opts.extraParams, maxTokens: opts.maxTokens, reasoning: opts.reasoning });
  const bodyText = JSON.stringify(body);
  const url = joinApiUrl(run.baseUrl, '/v1/chat/completions');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (run.apiKey) headers.Authorization = 'Bearer ' + run.apiKey;
  const logInput = messages.map((m) => ({ type: m.role, text: m.content }));

  for (let attempt = 0; ; attempt++) {
    run.content = '';
    run.think = '';
    run.usage = undefined;
    const a = await openAiAttempt(run, url, headers, bodyText, logInput, attempt);
    const kind = classifyFailure({ aborted: a.aborted, httpStatus: a.httpStatus, networkError: a.networkError, streamError: a.streamError, sawDone: a.sawDone });
    if (kind === 'none') {
      return { content: a.content, think: a.think, usage: a.usage, sawDone: true, aborted: false, sentText: assistantSentText(a.content) };
    }
    if (kind === 'aborted') {
      return { content: a.content + '\n\n（已停止）', think: a.think, usage: a.usage, sawDone: false, aborted: true, sentText: assistantSentText(a.content) };
    }
    if (kind === 'retry' && attempt < MAX_RETRIES) {
      emit({ type: 'round-retry', sessionId: run.sessionId, assistantId: run.assistantId, attempt: attempt + 1, maxRetries: MAX_RETRIES, error: a.errorText || '连接中断，回复不完整' });
      const waited = await sleepUnlessAborted(retryDelayMs(attempt + 1), run.abort.signal);
      if (!waited) {
        // 重试等待期间被停止：失败的那次尝试不进历史
        return { content: '（已停止）', think: '', sawDone: false, aborted: true, sentText: null };
      }
      continue;
    }
    let error = a.errorText || '连接中断，回复不完整';
    if (isContextOverflowError(error)) error = '对话已超出模型上下文长度，请新开会话，或切换到上下文更长的模型（' + error + '）';
    if (kind === 'retry') error = '已重试 ' + MAX_RETRIES + ' 次仍失败：' + error;
    return { content: (a.content ? a.content + '\n\n' : '') + '⚠️ ' + error, think: a.think, usage: a.usage, sawDone: false, aborted: false, error };
  }
}

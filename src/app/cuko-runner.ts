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
import { pickJsResultPhrase } from '../overlay/js-result-phrases.js';
import {
  createSseDecoder,
  extractCuckooBlocks,
  extractToolNames,
  friendlyError,
  splitPromptByH1,
} from './cuko-run-protocol.js';

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
}

/** 当前正在运行的会话（sessionId → run） */
const runs = new Map<string, CukoRun>();

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
}): void {
  const db = getDb();
  if (!db) return;
  try {
    const now = nowLocalIso();
    db.prepare('INSERT INTO cuko_messages (id, session_id, role, content, think, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.sessionId, msg.role, msg.content, msg.think || null, msg.usage ? JSON.stringify(msg.usage) : null, now);
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

/** 首轮注入的完整提示词留档，便于事后核对 / 手动恢复 */
function persistSystemPrompt(sessionId: string, prompt: string): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare('UPDATE cuko_sessions SET system_prompt = ? WHERE id = ?').run(prompt, sessionId);
  } catch (err: any) {
    console.error('[Cuko] 系统提示词落库失败:', err?.message || err);
  }
}

interface RoundResult {
  content: string;
  think: string;
  usage?: any;
  sawDone: boolean;
  aborted: boolean;
  error?: string;
}

/** 跑一轮请求：POST /v1/responses，解析 SSE，返回累计内容 */
async function streamRound(run: CukoRun, input: CukoRunInputPart[], providerSessionId: string): Promise<RoundResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (run.apiKey) headers.Authorization = 'Bearer ' + run.apiKey;

  const body: Record<string, any> = {
    cuckSessionId: run.sessionId,
    requestId: randomUUID(),
    model: run.modelId,
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

  try {
    const response = await fetch(run.baseUrl.replace(/\/+$/, '') + '/v1/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: run.abort.signal,
    });
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
  } catch (err: any) {
    if (err?.name === 'AbortError' || run.aborted) {
      aborted = true;
      content += '\n\n（已停止）';
    } else {
      error = err?.message || '请求失败';
      content += '\n\n⚠️ ' + error;
    }
  }

  run.content = content;
  run.think = think;
  run.usage = usage;
  return { content, think, usage, sawDone, aborted, error };
}

/** 运行主循环：请求 → 落库 → 有 cuckoo 块则执行工具 → 下一轮 */
async function runLoop(run: CukoRun): Promise<void> {
  let currentInput = run.initialInput;
  try {
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

      const round = await streamRound(run, currentInput, run.providerSessionId);

      insertMessage({
        id: assistantId,
        sessionId: run.sessionId,
        role: 'assistant',
        content: round.content,
        think: round.think,
        usage: round.usage,
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
      if (round.aborted || !round.sawDone) break;

      const blocks = extractCuckooBlocks(round.content);
      if (blocks.length === 0) break;

      run.phase = 'tools';
      run.toolMessageId = randomUUID();
      run.toolParts = [];
      emit({ type: 'tool-start', sessionId: run.sessionId, toolMessageId: run.toolMessageId, parts: run.toolParts });

      const results: Array<{ success: boolean; output?: string; error?: string }> = [];
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

        let r: { success: boolean; output?: string; error?: string };
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
      });
      emit({ type: 'tool-complete', sessionId: run.sessionId, toolMessageId: run.toolMessageId, parts: run.toolParts });
      if (run.aborted) break;

      let phrase = '执行了 ' + results.length + ' 个脚本';
      try {
        const picked = pickJsResultPhrase(results.length || 1);
        if (picked) phrase = picked;
      } catch { /* 用默认回复语 */ }

      currentInput = [
        { type: 'text', text: phrase },
        ...results.map((r) => ({
          type: 'text',
          text: r.success ? (r.output || '(脚本执行完成，无输出)') : '错误原因: ' + (r.error || '未知错误'),
        })),
      ];
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

  const providerSessionId = session.provider_session_id || '';
  const projectDir = session.project_dir || '';
  const first = withSystemPrompt(input, projectDir, providerSessionId);
  const firstInput = first.input;
  if (first.promptText) persistSystemPrompt(sessionId, first.promptText);

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
    windowId: typeof params.windowId === 'number' ? params.windowId : null,
  };

  runs.set(sessionId, run);
  // 不 await：IPC 立即返回，循环在后台继续跑（窗口关了也跑）
  void runLoop(run);
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

/** 进程退出前停掉所有运行 */
export function cancelAllCukoRuns(): void {
  for (const run of runs.values()) {
    run.aborted = true;
    try { run.abort.abort(); } catch { /* ignore */ }
  }
}

/**
 * [261123-q4h7tn-cuko-openai] Cuko 接入 OpenAI 兼容接口（Chat Completions）的纯函数
 * 此文件属于 Cuko OpenAI 协议需求，详细设计见：
 * docs/requirements/261123-q4h7tn-cuko-openai.md
 *
 * 不依赖 Electron / 数据库，主进程运行器、IPC 与测试共用：
 *   - 协议归一化、URL 拼接
 *   - 「发给模型的原文」（sent_text）的生成、旧消息补齐、重放成 messages
 *   - Chat Completions 流式解析、usage（含缓存命中）归一
 *   - 请求体合并（额外参数 / 最大输出 / 思考强度 / 必需字段）
 *   - 重试判定、模型列表解析、模型设置合并、上下文提醒
 */
import { createSseDecoder } from './cuko-run-protocol.js';

export type CukoProtocol = 'cuko' | 'openai';
export type SentRole = 'user' | 'assistant';

/** Provider 协议归一化：只有 openai 走 Chat Completions，其他（空值、cuko、cuko-api）一律 cuko */
export function normalizeProtocol(value: unknown): CukoProtocol {
  return String(value ?? '').trim().toLowerCase() === 'openai' ? 'openai' : 'cuko';
}

/** 拼接接口地址：地址末尾已有 /v1 时不再重复（https://api.deepseek.com 与 https://api.deepseek.com/v1 都能用） */
export function joinApiUrl(baseUrl: string, apiPath: string): string {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const p = '/' + String(apiPath ?? '').trim().replace(/^\/+/, '');
  if (/\/v1$/i.test(base) && /^\/v1(\/|$)/i.test(p)) return base + p.slice(3);
  return base + p;
}

// ================= 发给模型的原文（sent_text） =================

/** 系统提示词与用户第一句话之间的分隔 */
export const FIRST_MESSAGE_SEPARATOR = '\n\n---\n\n';

/** 第一条 user 原文 = 系统提示词 + 分隔线 + 用户第一句话 */
export function composeFirstUserText(systemPrompt: string, userText: string): string {
  const prompt = String(systemPrompt ?? '').trim();
  const text = String(userText ?? '');
  if (!prompt) return text;
  if (!text.trim()) return prompt;
  return prompt + FIRST_MESSAGE_SEPARATOR + text;
}

/** 被停止、没有执行的脚本，回传给模型的固定结果 */
export const TOOL_NOT_RUN_TEXT = '（运行被停止，脚本未执行）';
const TOOL_NO_OUTPUT_TEXT = '(脚本执行完成，无输出)';

export interface ToolRunItem {
  status: 'ok' | 'error' | 'skipped';
  text?: string;
}

/** 脚本标题：index 从 1 开始；skipped 按失败处理 */
export type ToolTitleFn = (index: number, success: boolean) => string;

const defaultToolTitle: ToolTitleFn = (index) => '[脚本 ' + index + ']';

/** 工具结果原文 = 回复语 + 每个脚本「标题 + 结果」 */
export function buildToolSentText(phrase: string, items: ToolRunItem[], title?: ToolTitleFn): string {
  const fn = title || defaultToolTitle;
  const list = Array.isArray(items) ? items : [];
  const parts = list.map((item, i) => {
    const ok = item && item.status === 'ok';
    let body = '';
    if (!item || item.status === 'skipped') body = TOOL_NOT_RUN_TEXT;
    else if (item.status === 'error') body = '错误原因: ' + (item.text || '未知错误');
    else body = item.text || TOOL_NO_OUTPUT_TEXT;
    return fn(i + 1, ok) + '\n' + body;
  });
  const head = String(phrase ?? '').trim();
  return [head, ...parts].filter((s) => s !== '').join('\n\n');
}

/** 去掉 Cuckoo 自己追加在回复末尾的提示（「（已停止）」「⚠️ 错误」），只留模型输出 */
export function stripCuckooNotices(content: string): string {
  let s = String(content ?? '');
  const stopped = '\n\n（已停止）';
  if (s.endsWith(stopped)) return s.slice(0, s.length - stopped.length);
  const idx = s.lastIndexOf('\n\n⚠️ ');
  if (idx >= 0) s = s.slice(0, idx);
  return s;
}

/** 助手原文：模型输出的正文（去首尾空白）；为空返回 null（不进历史） */
export function assistantSentText(modelOutput: string): string | null {
  const s = String(modelOutput ?? '').trim();
  return s ? s : null;
}

export interface StoredUserContent {
  text: string;
  attachmentNames: string[];
}

/** 解析用户消息落库格式：纯文本 / { v:1, text, attachments } / 早期 part 数组（与 src/ui/cuko/persisted-content.ts 一致） */
export function parseStoredUserContent(raw: string): StoredUserContent {
  const s = String(raw ?? '');
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return { text: s, attachmentNames: [] };
  let parsed: any;
  try {
    parsed = JSON.parse(t);
  } catch {
    return { text: s, attachmentNames: [] };
  }
  if (Array.isArray(parsed)) {
    const isParts = parsed.length > 0 && parsed.every((p: any) => p && typeof p === 'object' && typeof p.type === 'string');
    if (!isParts) return { text: s, attachmentNames: [] };
    const text = parsed.filter((p: any) => p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('\n\n');
    const names = parsed.filter((p: any) => p.type === 'file').map((p: any) => String(p.filename || 'attachment'));
    return { text, attachmentNames: names };
  }
  if (parsed && typeof parsed === 'object' && parsed.v === 1 && Array.isArray(parsed.attachments)) {
    const names = parsed.attachments.filter((a: any) => a && typeof a === 'object').map((a: any) => String(a.filename || 'attachment'));
    return { text: typeof parsed.text === 'string' ? parsed.text : '', attachmentNames: names };
  }
  return { text: s, attachmentNames: [] };
}

/** 工具卡片：content 是全部为 tool-call 的 JSON 数组 */
export function parseToolCardParts(raw: string): any[] | null {
  const t = String(raw ?? '').trim();
  if (!t.startsWith('[')) return null;
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr) && arr.length > 0 && arr.every((p: any) => p && p.type === 'tool-call')) return arr;
  } catch {
    // 不是 JSON，按普通文本处理
  }
  return null;
}

/** 工具卡片 part → ToolRunItem（没有 result 视为未执行） */
export function toolPartToItem(part: any): ToolRunItem {
  if (!part || part.result === undefined || part.result === null) return { status: 'skipped' };
  const text = String(part.result);
  return part.isError ? { status: 'error', text } : { status: 'ok', text };
}

export interface BackfillRow {
  id: string;
  role: string;
  content: string;
  sent_text?: string | null;
}

export interface BackfillResult {
  id: string;
  sentRole: SentRole;
  sentText: string;
}

export interface BackfillOptions {
  /** 工具结果回复语（补齐需要确定性，默认固定文案） */
  toolPhrase?: (count: number) => string;
  toolTitle?: ToolTitleFn;
}

/**
 * 跨协议切到 OpenAI 时，给缺原文的旧消息补 sent_text（补好即固定）。
 * - system 行跳过；已有 sent_text 的行跳过
 * - 第一条 user 行（若缺原文）拼上系统提示词
 * - 用户消息：文本 +（附件：文件名）
 * - 助手回复：去掉 Cuckoo 追加的提示，只剩提示（纯错误）的不补
 * - 工具卡片：sent_role=user，回复语 + 每个脚本结果
 */
export function backfillSentRows(rows: BackfillRow[], systemPrompt: string, options?: BackfillOptions): BackfillResult[] {
  const list = Array.isArray(rows) ? rows : [];
  const phraseFn = (options && options.toolPhrase) || ((n: number) => '执行了 ' + n + ' 个脚本，结果如下：');
  const out: BackfillResult[] = [];
  let seenUser = false;
  for (const row of list) {
    if (!row || typeof row.content !== 'string') continue;
    const hasSent = typeof row.sent_text === 'string' && row.sent_text !== '';
    if (row.role === 'user') {
      const isFirstUser = !seenUser;
      seenUser = true;
      if (hasSent) continue;
      const parsed = parseStoredUserContent(row.content);
      const names = parsed.attachmentNames;
      const text = [parsed.text.trim(), names.length ? '（附件：' + names.join('、') + '）' : ''].filter(Boolean).join('\n\n');
      const sentText = isFirstUser ? composeFirstUserText(systemPrompt, text) : text;
      if (sentText.trim()) out.push({ id: row.id, sentRole: 'user', sentText });
      continue;
    }
    if (row.role !== 'assistant' || hasSent) continue;
    const parts = parseToolCardParts(row.content);
    if (parts) {
      const sentText = buildToolSentText(phraseFn(parts.length), parts.map(toolPartToItem), options && options.toolTitle);
      out.push({ id: row.id, sentRole: 'user', sentText });
      continue;
    }
    const sentText = assistantSentText(stripCuckooNotices(row.content));
    if (sentText) out.push({ id: row.id, sentRole: 'assistant', sentText });
  }
  return out;
}

export interface SentRow {
  sent_role?: string | null;
  sent_text?: string | null;
}

export interface ChatMessage {
  role: SentRole;
  content: string;
}

/** 原文按落库顺序重放成 messages；相邻同角色用空行合并（只在末尾追加，前缀不变） */
export function buildChatMessages(rows: SentRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const text = row.sent_text;
    if (typeof text !== 'string' || text === '') continue;
    const role = row.sent_role === 'assistant' ? 'assistant' : row.sent_role === 'user' ? 'user' : null;
    if (!role) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = last.content + '\n\n' + text;
    else out.push({ role, content: text });
  }
  return out;
}

// ================= 请求体 =================

/** 不允许被额外参数覆盖的字段 */
export const RESERVED_BODY_KEYS = ['model', 'messages', 'stream', 'stream_options'];
export const DEFAULT_REASONING_FIELD = 'reasoning_effort';

export interface ReasoningRequest {
  /** 推理强度字段名（默认 reasoning_effort） */
  field?: string;
  /** 档位的 API 参数值 */
  value?: string;
  /** 选了 off：删掉推理强度字段，再合并 disableParams */
  off?: boolean;
  disableParams?: Record<string, any> | null;
}

export interface ChatBodyOptions {
  model: string;
  messages: ChatMessage[];
  extraParams?: Record<string, any> | null;
  maxTokens?: number | null;
  reasoning?: ReasoningRequest | null;
}

function isPlainObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeUnreserved(body: Record<string, any>, extra: unknown): void {
  if (!isPlainObject(extra)) return;
  const src: Record<string, any> = extra as Record<string, any>;
  for (const key of Object.keys(src)) {
    if (RESERVED_BODY_KEYS.includes(key)) continue;
    body[key] = src[key];
  }
}

/** 合并顺序（后者覆盖前者）：额外参数 → 最大输出 → 思考强度 → 必需字段 */
export function buildChatCompletionsBody(options: ChatBodyOptions): Record<string, any> {
  const body: Record<string, any> = {};
  mergeUnreserved(body, options.extraParams);
  const maxTokens = options.maxTokens;
  if (typeof maxTokens === 'number' && Number.isInteger(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  const r = options.reasoning;
  if (r) {
    const field = String(r.field || '').trim() || DEFAULT_REASONING_FIELD;
    if (r.off) {
      delete body[field];
      mergeUnreserved(body, r.disableParams);
    } else if (typeof r.value === 'string' && r.value.trim()) {
      body[field] = r.value.trim();
    }
  }
  body.model = options.model;
  body.messages = options.messages;
  body.stream = true;
  body.stream_options = { include_usage: true };
  return body;
}

export type JsonParamResult =
  | { ok: true; value: Record<string, any> | null; ignoredKeys: string[] }
  | { ok: false; error: string };

/** 校验设置页填写的 JSON 参数（额外请求参数 / 关闭思考参数）；空串表示不填 */
export function parseJsonObjectParam(text: string): JsonParamResult {
  const t = String(text ?? '').trim();
  if (!t) return { ok: true, value: null, ignoredKeys: [] };
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch (err: any) {
    return { ok: false, error: 'JSON 格式不正确：' + (err?.message || String(err)) };
  }
  if (!isPlainObject(value)) return { ok: false, error: '必须是 JSON 对象，例如 {"max_tokens": 8192}' };
  const obj: Record<string, any> = value as Record<string, any>;
  return { ok: true, value: obj, ignoredKeys: Object.keys(obj).filter((k) => RESERVED_BODY_KEYS.includes(k)) };
}

// ================= usage / 缓存命中 =================

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * usage 归一：补出 input_tokens / output_tokens / total_tokens / cache_read_tokens / cache_miss_tokens，原字段保留。
 * 缓存命中：DeepSeek 为 prompt_cache_hit_tokens / prompt_cache_miss_tokens，OpenAI 官方为 prompt_tokens_details.cached_tokens。
 */
export function normalizeUsage(raw: any): any {
  if (!isPlainObject(raw)) return raw;
  const input = num(raw.prompt_tokens) ?? num(raw.input_tokens);
  const output = num(raw.completion_tokens) ?? num(raw.output_tokens);
  let total = num(raw.total_tokens);
  if (total === undefined && input !== undefined && output !== undefined) total = input + output;
  const details = isPlainObject(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const cacheRead = num(raw.prompt_cache_hit_tokens) ?? num(details.cached_tokens) ?? num(raw.cache_read_tokens);
  let cacheMiss = num(raw.prompt_cache_miss_tokens) ?? num(raw.cache_miss_tokens);
  if (cacheMiss === undefined && cacheRead !== undefined && input !== undefined) cacheMiss = Math.max(0, input - cacheRead);
  const out: Record<string, any> = { ...raw };
  if (input !== undefined) out.input_tokens = input;
  if (output !== undefined) out.output_tokens = output;
  if (total !== undefined) out.total_tokens = total;
  if (cacheRead !== undefined) out.cache_read_tokens = cacheRead;
  if (cacheMiss !== undefined) out.cache_miss_tokens = cacheMiss;
  return out;
}

/** 缓存命中率（0~1）；接口没给命中数时返回 undefined */
export function cacheHitRatio(usage: any): number | undefined {
  if (!isPlainObject(usage)) return undefined;
  const read = num(usage.cache_read_tokens);
  const miss = num(usage.cache_miss_tokens);
  if (read === undefined || miss === undefined || read + miss <= 0) return undefined;
  return read / (read + miss);
}

// ================= 流式解析 =================

export interface ChatStreamResult {
  content: string;
  think: string;
  usage?: any;
  finishReason?: string;
  /** 正常结束：收到 [DONE]，或至少收到 finish_reason */
  sawDone: boolean;
  /** 流内错误（error 对象 / event: error） */
  error?: string;
}

export interface ChatStreamParser {
  push(chunk: string): void;
  /** 流读完后调用：处理末尾残留帧并返回结果 */
  finish(): ChatStreamResult;
}

function streamErrorText(payload: any, fallback: string): string {
  if (isPlainObject(payload)) {
    const e = isPlainObject(payload.error) ? payload.error : payload;
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof payload.error === 'string' && payload.error) return payload.error;
    if (typeof e.code === 'string' && e.code) return e.code;
  }
  return fallback || '未知错误';
}

/** 解析 Chat Completions 流（data: {...} 帧，以 data: [DONE] 结束） */
export function createChatStreamParser(onDelta?: (delta: string, thinkDelta: string) => void): ChatStreamParser {
  const result: ChatStreamResult = { content: '', think: '', sawDone: false };
  let ended = false;
  const decoder = createSseDecoder((eventName, data) => {
    if (ended) return;
    const text = data.trim();
    if (text === '[DONE]') {
      result.sawDone = true;
      ended = true;
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
    if (eventName === 'error' || (isPlainObject(payload) && payload.error)) {
      result.error = streamErrorText(payload, text);
      ended = true;
      return;
    }
    if (!isPlainObject(payload)) return;
    if (isPlainObject(payload.usage)) result.usage = normalizeUsage(payload.usage);
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
    if (!isPlainObject(choice)) return;
    if (choice.finish_reason) result.finishReason = String(choice.finish_reason);
    const d = isPlainObject(choice.delta) ? choice.delta : {};
    const delta = typeof d.content === 'string' ? d.content : '';
    let thinkDelta = '';
    if (typeof d.reasoning_content === 'string') thinkDelta = d.reasoning_content;
    else if (typeof d.reasoning === 'string') thinkDelta = d.reasoning;
    if (!delta && !thinkDelta) return;
    result.content += delta;
    result.think += thinkDelta;
    if (onDelta) onDelta(delta, thinkDelta);
  });
  return {
    push(chunk: string) {
      decoder.push(chunk);
    },
    finish() {
      decoder.flush();
      // 个别兼容服务不发 [DONE]，但给了 finish_reason，也算正常结束
      if (!result.sawDone && !result.error && result.finishReason) result.sawDone = true;
      return { ...result };
    },
  };
}

// ================= 重试 =================

export const MAX_RETRIES = 3;

export interface RoundFailure {
  aborted?: boolean;
  /** HTTP 状态码（拿到响应时） */
  httpStatus?: number;
  /** fetch / 读流抛出的网络错误 */
  networkError?: boolean;
  /** 流内错误 */
  streamError?: string;
  sawDone?: boolean;
}

/** none=正常结束 / retry=临时错误可重试 / fatal=不重试直接报错 / aborted=用户停止 */
export type FailureKind = 'none' | 'retry' | 'fatal' | 'aborted';

export function classifyFailure(f: RoundFailure): FailureKind {
  if (f.aborted) return 'aborted';
  const status = f.httpStatus;
  if (typeof status === 'number' && (status < 200 || status >= 300)) {
    return status === 429 || status >= 500 ? 'retry' : 'fatal';
  }
  if (f.networkError) return 'retry';
  if (f.streamError) return 'fatal';
  if (!f.sawDone) return 'retry';
  return 'none';
}

/** 第 n 次重试前的等待（n 从 1 开始）：2s / 4s / 8s */
export function retryDelayMs(retryIndex: number): number {
  const n = Math.max(1, Math.floor(retryIndex));
  return 2000 * Math.pow(2, n - 1);
}

/** 接口错误是否是「上下文太长」 */
export function isContextOverflowError(text: string): boolean {
  return /context[_ ]length|context window|maximum context|too many tokens|prompt is too long|上下文.{0,6}(长度|超)/i.test(String(text ?? ''));
}

// ================= 模型列表 / 模型设置 =================

export type InputModality = 'text' | 'image';

export interface ListedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: InputModality[];
  // [261123-q4h7tn-cuko-openai] 接口返回的推理档位（DeepSeek 的 effort 扩展字段），刷新时预填到 api_meta
  reasoningLevels?: ReasoningLevel[];
  defaultEffort?: string;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

// [261123-q4h7tn-cuko-openai] 接口返回的档位列表 → 档位表：只认非空字符串，去重；一个都没有当作没返回
function parseSupportedLevels(value: unknown): ReasoningLevel[] {
  if (!Array.isArray(value)) return [];
  const out: ReasoningLevel[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id });
  }
  return out;
}

/** 解析 GET /v1/models：标准字段 + 可选扩展字段（context_window / max_output_tokens / input_modalities） */
export function parseModelList(json: any): ListedModel[] {
  const data = isPlainObject(json) ? json.data : undefined;
  if (!Array.isArray(data)) throw new Error('返回格式不正确：缺少 data 数组');
  const out: ListedModel[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (!isPlainObject(entry)) continue;
    const id = entry.id;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    const model: ListedModel = { id };
    if (typeof entry.name === 'string' && entry.name.trim()) model.name = entry.name.trim();
    const cw = positiveInt(entry.context_window);
    if (cw !== undefined) model.contextWindow = cw;
    const mo = positiveInt(entry.max_output_tokens);
    if (mo !== undefined) model.maxOutputTokens = mo;
    if (Array.isArray(entry.input_modalities)) {
      const mods: InputModality[] = [];
      for (const m of entry.input_modalities) {
        if ((m === 'text' || m === 'image') && !mods.includes(m)) mods.push(m);
      }
      if (mods.length) model.inputModalities = mods;
    }
    // DeepSeek 等：effort = { supported_levels: ["low","high","max"], default_level: "high" }；
    // 字段缺失或类型不对就当作没返回，不影响其它字段
    if (isPlainObject(entry.effort)) {
      const levels = parseSupportedLevels(entry.effort.supported_levels);
      if (levels.length) {
        model.reasoningLevels = levels;
        const def = entry.effort.default_level;
        const defId = typeof def === 'string' ? def.trim() : '';
        if (defId && levels.some((l) => l.id === defId)) model.defaultEffort = defId;
      }
    }
    out.push(model);
  }
  return out;
}

export interface ReasoningLevel {
  /** 档位名（off 表示关闭思考） */
  id: string;
  /** API 参数值；为空时用档位名 */
  value?: string;
}

/** 模型设置（api_meta 与 user_meta 都是这个结构，user_meta 逐项覆盖 api_meta） */
export interface ModelMeta {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  inputModalities?: InputModality[];
  reasoningEnabled?: boolean;
  reasoningLevels?: ReasoningLevel[];
  defaultEffort?: string;
}

export const OFF_EFFORT = 'off';

/** 打开推理档位总开关时预填的档位 */
export const DEFAULT_REASONING_LEVELS: ReasoningLevel[] = [
  { id: 'off', value: '' },
  { id: 'low', value: 'low' },
  { id: 'high', value: 'high' },
  { id: 'max', value: 'max' },
];

/** 接口拿到的模型信息 → api_meta */
export function listedToApiMeta(model: ListedModel): ModelMeta {
  const meta: ModelMeta = {};
  if (model.name) meta.name = model.name;
  if (model.contextWindow) meta.contextWindow = model.contextWindow;
  if (model.maxOutputTokens) meta.maxTokens = model.maxOutputTokens;
  if (model.inputModalities && model.inputModalities.length) meta.inputModalities = [...model.inputModalities];
  // 接口给了推理档位就打开总开关；用户改过的值存在 user_meta 里、优先于这里的接口值
  if (model.reasoningLevels && model.reasoningLevels.length) {
    meta.reasoningEnabled = true;
    meta.reasoningLevels = model.reasoningLevels.map((l) => ({ ...l }));
    if (model.defaultEffort) meta.defaultEffort = model.defaultEffort;
  }
  return meta;
}

/** 生效的模型设置：user_meta 中有定义的字段覆盖 api_meta */
export function effectiveModelMeta(apiMeta: ModelMeta | null | undefined, userMeta: ModelMeta | null | undefined): ModelMeta {
  const out: Record<string, any> = { ...(apiMeta || {}) };
  const user: Record<string, any> = { ...(userMeta || {}) };
  for (const key of Object.keys(user)) {
    if (user[key] !== undefined && user[key] !== null) out[key] = user[key];
  }
  return out as ModelMeta;
}

function levelsOf(meta: ModelMeta | null | undefined): ReasoningLevel[] {
  if (!meta || !meta.reasoningEnabled || !Array.isArray(meta.reasoningLevels)) return [];
  return meta.reasoningLevels.filter((l) => l && typeof l.id === 'string' && l.id.trim() !== '');
}

/** 模型的默认档位：标了且存在就用它，否则第一个；没开推理档位返回 undefined */
export function defaultEffortOf(meta: ModelMeta | null | undefined): string | undefined {
  const levels = levelsOf(meta);
  if (levels.length === 0) return undefined;
  const preferred = meta && meta.defaultEffort;
  if (preferred && levels.some((l) => l.id === preferred)) return preferred;
  return levels[0].id;
}

/** 切换模型后的档位：新模型有同名档位就沿用，否则用新模型的默认档位 */
export function resolveEffortAfterSwitch(previous: string | null | undefined, meta: ModelMeta | null | undefined): string | undefined {
  const levels = levelsOf(meta);
  if (levels.length === 0) return undefined;
  if (previous && levels.some((l) => l.id === previous)) return previous;
  return defaultEffortOf(meta);
}

export interface ProviderReasoningConfig {
  field?: string | null;
  disableParams?: Record<string, any> | null;
}

/** 会话档位 + 模型设置 + Provider 配置 → 请求体里的思考强度部分；模型没开推理档位返回 null */
export function reasoningRequestOf(meta: ModelMeta | null | undefined, effort: string | null | undefined, provider?: ProviderReasoningConfig | null): ReasoningRequest | null {
  const levels = levelsOf(meta);
  if (levels.length === 0) return null;
  const chosen = levels.find((l) => l.id === effort) || levels.find((l) => l.id === defaultEffortOf(meta)) || levels[0];
  const field = (provider && provider.field ? String(provider.field).trim() : '') || DEFAULT_REASONING_FIELD;
  if (chosen.id === OFF_EFFORT) return { field, off: true, disableParams: (provider && provider.disableParams) || null };
  const value = String(chosen.value || '').trim() || chosen.id;
  return { field, value };
}

// ================= 上下文提醒 =================

export const CONTEXT_WARN_RATIO = 0.6;

export interface ContextUsage {
  used: number;
  limit?: number;
  ratio?: number;
  warn: boolean;
}

export function contextUsageOf(usedTokens: number, contextWindow?: number | null): ContextUsage {
  const used = typeof usedTokens === 'number' && Number.isFinite(usedTokens) && usedTokens > 0 ? usedTokens : 0;
  const limit = typeof contextWindow === 'number' && contextWindow > 0 ? contextWindow : undefined;
  if (limit === undefined) return { used, warn: false };
  const ratio = used / limit;
  return { used, limit, ratio, warn: ratio >= CONTEXT_WARN_RATIO };
}

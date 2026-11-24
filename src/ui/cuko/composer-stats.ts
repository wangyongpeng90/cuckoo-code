// [261123-q4h7tn-cuko-openai] 聊天输入框的用量显示与推理等级：纯函数（不依赖 Electron / React / 数据库）
// 设计见 docs/requirements/261123-q4h7tn-cuko-openai.md 第 6 节；算法照 deepseek-harness（dsh-v0.2.2-rc.5）：
//   - 缓存命中：会话累计命中 ÷ 会话累计输入（ui-chat StatsPills 的 cacheHitPercent），本项目固定两位小数
//   - 上下文：最近一次请求的输入侧用量（token-meter 的 pressureTokens），数字格式照 ContextMeter 的 formatTokens
// 界面层不引用 src/app，这里只放显示需要的规则；60% 阈值与档位规则和 src/app/cuko-openai.ts 一致（测试里交叉校验）

export const CONTEXT_WARN_RATIO = 0.6;

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ================= 缓存命中（会话累计） =================

export interface CacheTotals {
  read: number;
  prompt: number;
}

// 只统计同时带 cache_read_tokens / cache_miss_tokens 的用量；一条都没有返回 null
export function sessionCacheTotals(usages: unknown[]): CacheTotals | null {
  let read = 0;
  let prompt = 0;
  let seen = false;
  for (const usage of usages) {
    if (!isObject(usage)) continue;
    const hit = num(usage.cache_read_tokens);
    const miss = num(usage.cache_miss_tokens);
    if (hit === undefined || miss === undefined) continue;
    seen = true;
    read += hit;
    prompt += hit + miss;
  }
  return seen ? { read, prompt } : null;
}

// 命中率文本（不含 %）：固定两位小数；没全部命中时最多 99.99，全部命中才 100.00；输入为 0 返回 null
export function formatHitPercent(read: number, prompt: number): string | null {
  if (!(prompt > 0)) return null;
  if (read >= prompt) return '100.00';
  const units = Math.min(9999, Math.max(0, Math.round((read * 10000) / prompt)));
  const whole = Math.floor(units / 100);
  const cents = units % 100;
  return whole + '.' + (cents < 10 ? '0' : '') + cents;
}

// ================= 上下文用量 =================

// token 数的紧凑写法（照 harness ContextMeter 的 formatTokens）：小于 1000 原样；小于 100K 保留 1 位小数；其余取整；百万用 M
export function formatTokenCount(value: number): string {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const scaled = (candidate: number): string => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
  if (v < 1000) return String(v);
  if (v < 1000000) return scaled(v / 1000) + 'K';
  return scaled(v / 1000000) + 'M';
}

// 最近一次请求的输入侧用量：从后往前找第一条带 prompt_tokens（没有时用 input_tokens）的用量
export function lastPromptTokens(usages: unknown[]): number | undefined {
  for (let i = usages.length - 1; i >= 0; i--) {
    const usage = usages[i];
    if (!isObject(usage)) continue;
    const prompt = num(usage.prompt_tokens);
    if (prompt !== undefined) return prompt;
    const input = num(usage.input_tokens);
    if (input !== undefined) return input;
  }
  return undefined;
}

export interface ContextDisplay {
  text: string;
  warn: boolean;
}

// 「上下文 3.7K」；填了上下文窗口且用量 >= 60% 时变成「上下文 82.3K / 128K（64%）」并标 warn（百分比取整，最多 100）
export function contextDisplay(promptTokens: number | undefined, contextWindow?: number | null): ContextDisplay | null {
  if (promptTokens === undefined) return null;
  const used = formatTokenCount(promptTokens);
  const limit = typeof contextWindow === 'number' && contextWindow > 0 ? contextWindow : undefined;
  if (limit === undefined || promptTokens / limit < CONTEXT_WARN_RATIO) return { text: '上下文 ' + used, warn: false };
  const percent = Math.min(100, Math.round((promptTokens / limit) * 100));
  return { text: '上下文 ' + used + ' / ' + formatTokenCount(limit) + '（' + percent + '%）', warn: true };
}

// ================= 推理等级 =================

export interface ReasoningLevelLike {
  id: string;
  value?: string;
}

export interface ReasoningMetaLike {
  reasoningEnabled?: boolean;
  reasoningLevels?: ReasoningLevelLike[] | null;
  defaultEffort?: string | null;
}

// 模型可选的档位（与 cuko-openai.ts 的 levelsOf 相同）：没开总开关返回空数组
export function reasoningLevelsOf(meta: ReasoningMetaLike | null | undefined): ReasoningLevelLike[] {
  if (!meta || !meta.reasoningEnabled || !Array.isArray(meta.reasoningLevels)) return [];
  return meta.reasoningLevels.filter((l) => !!l && typeof l.id === 'string' && l.id.trim() !== '');
}

// 当前生效的档位：会话里存的在档位表里就用它，否则用默认档位（标了且存在），再否则第一个；没开推理档位返回 undefined
export function effectiveEffort(meta: ReasoningMetaLike | null | undefined, stored: string | null | undefined): string | undefined {
  const levels = reasoningLevelsOf(meta);
  if (levels.length === 0) return undefined;
  if (stored && levels.some((l) => l.id === stored)) return stored;
  const preferred = meta ? meta.defaultEffort : undefined;
  if (preferred && levels.some((l) => l.id === preferred)) return preferred;
  return levels[0].id;
}

// 档位显示名：首字母大写（max → Max）
export function effortLabel(id: string | null | undefined): string {
  const s = String(id == null ? '' : id).trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export type ReasoningUnsupported = 'protocol' | 'model' | null;

// 推理等级为什么不能选：不是 OpenAI 协议 → protocol；OpenAI 但模型没开推理档位 → model；能选 → null
export function reasoningUnsupportedReason(protocol: string | null | undefined, meta: ReasoningMetaLike | null | undefined): ReasoningUnsupported {
  if (String(protocol == null ? '' : protocol).trim().toLowerCase() !== 'openai') return 'protocol';
  return reasoningLevelsOf(meta).length > 0 ? null : 'model';
}


// ================= 会话累计用量（xxx tok，照 harness UsagePill） =================

export interface SessionTokenTotals {
  total: number;
  uncachedInput: number;
  cacheRead: number;
  output: number;
}

// 每条用量取 输入 + 输出（input_tokens / output_tokens，没有时用 prompt_tokens / completion_tokens），
// 两者都没有时用 total_tokens；命中数按输入封顶；累计为 0 返回 null
export function sessionTokenTotals(usages: unknown[]): SessionTokenTotals | null {
  let total = 0;
  let uncachedInput = 0;
  let cacheRead = 0;
  let output = 0;
  for (const usage of usages) {
    if (!isObject(usage)) continue;
    const input = num(usage.input_tokens) ?? num(usage.prompt_tokens);
    const out = num(usage.output_tokens) ?? num(usage.completion_tokens);
    if (input !== undefined && out !== undefined) {
      const hit = Math.min(input, num(usage.cache_read_tokens) ?? 0);
      total += input + out;
      cacheRead += hit;
      uncachedInput += input - hit;
      output += out;
      continue;
    }
    const all = num(usage.total_tokens);
    if (all !== undefined) total += all;
  }
  return total > 0 ? { total, uncachedInput, cacheRead, output } : null;
}

// 精确数字，千分位（照 harness formatExactTokens）
export function formatExactCount(value: number): string {
  const digits = String(Math.max(0, Math.round(Number(value) || 0)));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(',');
}

// 浮动面板明细（照 harness UsagePill 对话框）：缓存命中（没返回命中字段时省略）/ 未缓存输入 / 缓存读取 / 输出
export interface UsageDetailRow {
  label: string;
  value: string;
}

export function usageDetailRows(t: SessionTokenTotals, hitText: string | null): UsageDetailRow[] {
  const rows: UsageDetailRow[] = [];
  if (hitText) rows.push({ label: '缓存命中', value: hitText + '%' });
  rows.push({ label: '未缓存输入', value: formatExactCount(t.uncachedInput) });
  rows.push({ label: '缓存读取', value: formatExactCount(t.cacheRead) });
  rows.push({ label: '输出', value: formatExactCount(t.output) });
  return rows;
}
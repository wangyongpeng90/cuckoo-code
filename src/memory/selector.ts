/**
 * 记忆选取：打分排序 + token 预算截断
 *
 * 对齐 DeepSeek++ 的 selector.ts：
 *   score = (pinned?1000:0) + keywordScore + decayScore + (1h内访问?5:0)
 *   keywordScore = tagHits*20 + nameHits*15 + contentHits*5
 *   decayScore = min(accessCount,20) + max(0,10-daysSinceAccess*0.1)
 */
import type { Memory } from './types.js';

/** 默认记忆注入预算（tokens，粗略按字符数/2 估算中文/英文混合） */
export const MEMORY_TOKEN_BUDGET = 2000;

/** 中文停用词（简化版，避免无意义词命中） */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '或', '有',
  '这', '那', '一个', '什么', '怎么', '如何', '可以', '需要', 'the', 'a', 'an', 'is',
  'are', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'this', 'that', 'it',
]);

/** 粗略 token 估算（中文约 1.5 字/token，英文约 4 字/token，取折中 2 字符/token） */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 2);
}

/** 文本分词（中文按 2-gram 简化，英文按空白/标点切） */
export function segmentText(text: string): string[] {
  const s = String(text || '').toLowerCase();
  const words: string[] = [];
  // 英文/数字词
  const latin = s.match(/[a-z0-9_]{2,}/g) || [];
  for (const w of latin) if (!STOP_WORDS.has(w)) words.push(w);
  // 中文：连续汉字按 2-gram 切
  const cjkRuns = s.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) { words.push(run); continue; }
    for (let i = 0; i < run.length - 1; i++) {
      const gram = run.slice(i, i + 2);
      if (!STOP_WORDS.has(gram)) words.push(gram);
    }
  }
  return words;
}

function keywordScore(promptWords: string[], memory: Memory): number {
  const promptSet = new Set(promptWords);
  let tagHits = 0;
  for (const tag of memory.tags || []) {
    const tagLower = String(tag).toLowerCase();
    if (tagLower.length > 1 && promptSet.has(tagLower)) tagHits++;
    for (const pw of promptWords) {
      if (pw.length > 2 && tagLower.includes(pw) && tagLower !== pw) tagHits += 0.5;
    }
  }
  let nameHits = 0;
  for (const w of segmentText(memory.name)) if (promptSet.has(w)) nameHits++;
  let contentHits = 0;
  for (const w of segmentText(memory.content)) if (promptSet.has(w)) contentHits++;
  return tagHits * 20 + nameHits * 15 + contentHits * 5;
}

function decayScore(memory: Memory): number {
  const daysSinceAccess = (Date.now() - memory.lastAccessedAt) / 86400000;
  const freshness = Math.max(0, 10 - daysSinceAccess * 0.1);
  return Math.min(memory.accessCount, 20) + freshness;
}

export interface SelectOptions {
  budget?: number;
  identityOnly?: boolean;
}

/** 根据 prompt 规模动态调整预算（prompt 越大，留给记忆越少） */
export function getMemoryBudget(promptTokens: number): number {
  if (promptTokens > 3000) {
    return Math.max(800, MEMORY_TOKEN_BUDGET - Math.floor((promptTokens - 3000) * 0.2));
  }
  return MEMORY_TOKEN_BUDGET;
}

/** 选取要注入的记忆（按打分排序，按预算截断） */
export function selectMemories(
  prompt: string,
  allMemories: Memory[],
  options?: SelectOptions,
): Memory[] {
  if (!allMemories.length) return [];
  const { budget = MEMORY_TOKEN_BUDGET, identityOnly = false } = options ?? {};
  const candidates = identityOnly
    ? allMemories.filter((m) => m.type === 'user' || m.type === 'feedback' || m.pinned)
    : allMemories;
  if (!candidates.length) return [];

  const promptWords = segmentText(prompt);
  const scored = candidates.map((m) => ({
    memory: m,
    score:
      (m.pinned ? 1000 : 0) +
      keywordScore(promptWords, m) +
      decayScore(m) +
      (Date.now() - m.lastAccessedAt < 3600000 ? 5 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  const selected: Memory[] = [];
  let remaining = budget;
  for (const { memory } of scored) {
    const cost = estimateTokens(formatMemoryLine(memory));
    if (remaining - cost < 0 && selected.length > 0) break;
    selected.push(memory);
    remaining -= cost;
  }
  return selected;
}

/** 单条记忆格式化为一行（注入用） */
export function formatMemoryLine(m: Memory): string {
  const scopePrefix = m.scope === 'project' ? 'project ' : '';
  return '- #' + m.id + ' [' + scopePrefix + m.type + '] ' + m.name + ': ' + m.content;
}

/** 记忆块格式化为注入文本 */
export function formatMemoriesBlock(memories: Memory[]): string {
  if (!memories.length) return '(暂无记忆)';
  return memories.map(formatMemoryLine).join('\n');
}

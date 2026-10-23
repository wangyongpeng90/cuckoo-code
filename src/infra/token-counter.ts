/**
 * Token 计数抽象（单一真相源）
 *
 * 背景：TPS 展示与上下文预算（何时压缩）都需要 token 数。原先 tps.ts 内联了
 * 一套启发式估算，分散且无法替换。此处收敛为可替换的 TokenCounter：
 *  - 默认 EstimateTokenCounter：纯 JS 启发式，零依赖，用于体感展示；
 *  - 未来可注入精确 tokenizer（如 DeepSeek recipe 的 tokenizer，经 WASM/napi 包装），
 *    只需调用 setExactTokenCounter()，全部调用点自动切换。
 *
 * 设计对齐 deepseek-recipe 的「单一真相源 + 可替换编解码」理念。
 */

/** Token 计数器接口 */
export interface TokenCounter {
  /** 统计一段文本的 token 数 */
  count(text: string): number;
  /** 统计一条消息的 token 数（含角色开销） */
  countMessage(role: string, content: string): number;
  /** 是否为精确计数器（false 表示启发式估算） */
  readonly isExact: boolean;
}

/**
 * 启发式估算计数器。
 *
 * 按字符类别加权（依据 DeepSeek BPE 的合并特性，经验值）：
 *  - CJK 约 0.65 token/字（BPE 常合并双字词）
 *  - ASCII 字母约 0.27 token/字符（约 3.7 字符/token）
 *  - 数字约 0.35/位，空白约 0.25/字符，标点/符号约 0.45/个，emoji 约 2.5/个
 * 最后乘 1.05 保守上偏，避免上下文预算判断低估。
 *
 * 仅用于体感展示与预判，非计费口径。
 */
export class EstimateTokenCounter implements TokenCounter {
  readonly isExact = false;

  count(text: string): number {
    if (!text) return 0;
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
    const emoji = (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
    const digits = (text.match(/\d/g) || []).length;
    const spaces = (text.match(/\s/g) || []).length;
    // 标点/符号：非字母、非数字、非空白、非 CJK、非 emoji
    const punct = (text.match(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
    const ascii = Math.max(0, text.length - cjk - emoji - digits - spaces - punct);
    const raw = cjk * 0.65 + ascii * 0.27 + digits * 0.35 + spaces * 0.25 + punct * 0.45 + emoji * 2.5;
    return Math.ceil(raw * 1.05);
  }

  countMessage(role: string, content: string): number {
    // 角色/分隔符开销：system 消息略高
    const overhead = role === 'system' ? 8 : 4;
    return this.count(content) + overhead;
  }
}

/** 默认估算计数器（单例） */
const estimateCounter = new EstimateTokenCounter();

/** 已注入的精确计数器（null 表示使用估算） */
let exactCounter: TokenCounter | null = null;

/**
 * 注入精确 tokenizer 实现（如 DeepSeek 官方 tokenizer）。
 * 传 null 恢复默认估算。
 */
export function setExactTokenCounter(counter: TokenCounter | null): void {
  exactCounter = counter;
}

/** 获取当前生效的计数器（精确优先，否则估算） */
export function getTokenCounter(): TokenCounter {
  return exactCounter ?? estimateCounter;
}

/**
 * 模型输出速度（tokens per second）
 *
 * 两条路径：
 *  1) 精确路径：DeepSeek 每帧下发 accumulated_token_usage（= 对话上下文累计 token），
 *     本轮输出 token = 当前值 − 本轮起始值，TpsMeter 优先采用。**不含输入 token**。
 *  2) 回退估算：ChatGPT/Claude hook 未提供 token 用量，用正文长度近似估算。
 *     - CJK 约 0.7 token/字（DeepSeek BPE 常合并双字词）
 *     - 英文/符号约 0.28 token/字符（约 3.5 字符/token）
 *     - 数字约 0.35/位，空白约 0.25/字符，emoji 约 2.5/个
 *     仅用于体感展示，非计费口径。
 *
 * 新一轮检测：正文长度回退（本轮正文从 0 重新累积）即视为新一轮开始，
 * 自动重置基准。这样即使上一轮被中止（未收到 finished），也不会把两轮 token 叠加。
 */

import { getTokenCounter } from '../infra/token-counter.js';

/**
 * 估算一段文本的 token 数（近似；仅在无服务端 token 时回退使用）。
 * 委托给统一的 TokenCounter（见 infra/token-counter），可被精确 tokenizer 替换。
 */
export function estimateTokens(text: string): number {
  return getTokenCounter().count(text);
}

/** 最小计时窗口（秒）：过短会让 TPS 虚高 */
const MIN_WINDOW = 0.3;

/**
 * 测速器：记录一轮生成的首字时间与已输出 token，实时算平均 TPS。
 * - 优先用服务端 accumulated_token_usage 差值算精确 TPS；
 * - 无服务端 token 时回退正文长度估算；
 * - 结束（finished）后冻结最终值，下一轮开始自动重置基准（防叠加）。
 */
export function createTpsMeter() {
  let startAt = 0;        // 本轮起始时间（ms）
  let baseAcc = 0;        // 本轮起始 accumulated（差值基准）
  let lastAcc = 0;        // 最新 accumulated
  let hasAcc = false;     // 本轮是否已收到服务端 token
  let running = false;    // 本轮是否进行中
  let value = 0;          // 最近一次算出的 TPS（跨轮保留供展示）
  let tokens = 0;         // 最近一次的本轮输出 token
  let lastTextLen = 0;    // 上一帧正文长度，用于检测新一轮

  /** 开始新一轮：只重置"本轮计算状态"，保留 value 供展示（避免归零） */
  function startNewRound(): void {
    startAt = 0; baseAcc = 0; lastAcc = 0; hasAcc = false;
    running = false; tokens = 0; lastTextLen = 0;
  }

  return {
    /**
     * 流式更新。finished 为 true 时结束本轮（冻结 value）。
     * acc 为服务端 accumulated_token_usage；优先用其差值算精确 TPS，否则回退估算。
     */
    update(text: string, finished: boolean, acc: number | null = null, now: number = Date.now()): number {
      if (finished) { running = false; return value; }

      const textLen = (text || '').length;
      // 新一轮检测：上一轮已结束，或正文长度回退（本轮正文重新累积）
      if ((!running && startAt !== 0) || (startAt !== 0 && textLen < lastTextLen)) {
        startNewRound();
      }
      running = true;
      lastTextLen = textLen;

      // 优先尝试服务端精确 token 差值（不含输入 token）
      let outTokens = -1;
      if (typeof acc === 'number' && acc >= 0) {
        if (!hasAcc) { baseAcc = acc; hasAcc = true; startAt = now; }
        lastAcc = acc;
        const accTokens = lastAcc - baseAcc;
        if (accTokens > 0) outTokens = accTokens;
      }

      // 服务端未提供 token 或差值未增长时，回退正文长度估算
      // （保证只要正文在增长，就一定能算出一个速度，不会一直不显示）
      if (outTokens <= 0) {
        outTokens = estimateTokens(text);
        if (outTokens <= 0) return value;
        if (startAt === 0) startAt = now;
      }

      tokens = outTokens;
      const elapsed = (now - startAt) / 1000;
      if (elapsed >= MIN_WINDOW) value = tokens / elapsed;
      return value;
    },
    /** 完全重置（如切换会话）：清空本轮状态与展示值 */
    reset(): void { startNewRound(); value = 0; },
    get value(): number { return value; },
    get tokens(): number { return tokens; },
    /** 本轮是否正在生成计时中 */
    get active(): boolean { return running; },
  };
}

/** 把 TPS 格式化为展示文本（无数据返回空串） */
export function formatTps(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

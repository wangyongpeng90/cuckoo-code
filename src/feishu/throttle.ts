/**
 * 飞书工具状态推送限流（纯逻辑，无 electron/网络依赖，便于单测）
 *
 * 背景：一轮任务里 AI 可能反复调用工具，tool-start/tool-end 会把飞书刷屏。
 * 策略：单轮内工具状态推送达阈值 → 自动暂停这类推送，并询问用户「继续/暂停」。
 *  - 仅本轮有效：下一轮用户消息调用 reset() 复位。
 *  - 询问超时（默认 15s）未回复：保持暂停。
 *  - 仅在"已询问、等回复"窗口内拦截「继续/暂停」，避免误吞正常聊天。
 */

/** 单个群的限流状态 */
export interface ThrottleState {
  count: number;    // 本轮已放行的工具状态条数
  paused: boolean;  // 本轮是否已暂停
  asking: boolean;  // 是否已发询问、正等待回复
}

/** tryPush 的判定结果 */
export interface TryPushResult {
  /** 是否放行本条工具状态推送 */
  allow: boolean;
  /** 是否应发出「继续/暂停」询问（仅当本次刚好触及阈值） */
  shouldAsk: boolean;
}

export const DEFAULT_TOOL_PUSH_LIMIT = 8;

export class ToolPushThrottle {
  private limit: number;
  private map = new Map<string, ThrottleState>();

  constructor(limit: number = DEFAULT_TOOL_PUSH_LIMIT) {
    this.limit = limit > 0 ? limit : DEFAULT_TOOL_PUSH_LIMIT;
  }

  /** 阈值（供调用方组装文案） */
  get limitValue(): number { return this.limit; }

  private get(chatId: string): ThrottleState {
    let s = this.map.get(chatId);
    if (!s) { s = { count: 0, paused: false, asking: false }; this.map.set(chatId, s); }
    return s;
  }

  /**
   * 尝试放行一条工具状态推送。
   * - 已暂停：不放行、不询问（静默丢弃）。
   * - 计数达阈值：不放行 + 本次应发询问。
   * - 否则：放行。
   */
  tryPush(chatId: string): TryPushResult {
    if (!chatId) return { allow: false, shouldAsk: false };
    const s = this.get(chatId);
    if (s.paused) return { allow: false, shouldAsk: false };
    s.count++;
    if (s.count >= this.limit) {
      s.paused = true;
      s.asking = true;
      return { allow: false, shouldAsk: true };
    }
    return { allow: true, shouldAsk: false };
  }

  /** 新一轮任务：复位 */
  reset(chatId: string): void {
    if (!chatId) return;
    const s = this.get(chatId);
    s.count = 0;
    s.paused = false;
    s.asking = false;
  }

  /**
   * 解析用户回复。仅在 asking 窗口内生效。
   * @returns 'resume'（恢复并复位）/ 'pause'（保持暂停）/ null（非控制指令，应转发给 AI）
   */
  handleReply(chatId: string, text: string): 'resume' | 'pause' | null {
    if (!chatId) return null;
    const s = this.map.get(chatId);
    if (!s || !s.asking) return null;
    const cmd = String(text || '').trim();
    if (cmd === '继续') {
      s.count = 0;
      s.paused = false;
      s.asking = false;
      return 'resume';
    }
    if (cmd === '暂停') {
      s.paused = true;
      s.asking = false;
      return 'pause';
    }
    return null;
  }

  /** 询问超时：关闭询问窗口（保持暂停） */
  askTimeout(chatId: string): void {
    if (!chatId) return;
    const s = this.map.get(chatId);
    if (s) s.asking = false;
  }

  /** 读取状态（供测试/调试） */
  peek(chatId: string): ThrottleState | undefined {
    return this.map.get(chatId);
  }
}

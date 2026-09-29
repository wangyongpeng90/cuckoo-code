/**
 * 对话 token 统计（T7 从 events.ts 拆出）
 * 负责：按会话缓存 + 按天累计的 localStorage 持久化、壳页面状态条同步。
 * UI 改版（Task 6）后本模块只负责数据上报，不再写 overlay DOM
 * （「对话 Token」展示迁至 shell 侧栏「项目」面板，由主进程转发 shell-token-updated）。
 * deps 显式注入（会话 ID 提取、响应订阅、壳页面同步），便于测试。
 */
import { KEYS, readKey, writeKey, removeKey } from './storage.js';

// 每日统计口径版本：
//  v1 = 累加完整 acc 但无限膨胀（错误）
//  v2 = 累加 delta（跨天会漏算，与预期不符）
//  v3 = 每天累加"当轮完整 acc"（今天每轮的总量之和，跨天归零）
const DAILY_VERSION = '3';

/** 是否子代理窗口（由 bridge 注入）。子代理共享父窗口 localStorage，不应参与 token 统计 */
let isSubagentWindow = false;
function setIsSubagentWindow(v: boolean): void { isSubagentWindow = !!v; }

/** 服务端权威 token 统计（由 bridge 经回调推送，不共享状态） */
let serverTokenUsage: any = null;

/** 旧口径数据迁移：v1 的今日值是"完整 acc 之和"（会膨胀），不可比，检测到就清空重来 */
function migrateDailyVersion(): void {
  try {
    if (localStorage.getItem(KEYS.tokenDailyVersion) !== DAILY_VERSION) {
      removeKey(KEYS.tokenDaily);
      localStorage.setItem(KEYS.tokenDailyVersion, DAILY_VERSION);
    }
  } catch (_) {}
}

/** 取本地日期字符串 YYYY-MM-DD */
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 某天累加 token（传入"当轮完整 acc"） */
function addDailyToken(delta: number): void {
  if (typeof delta !== 'number' || delta <= 0) return;
  try {
    const obj: any = readKey(KEYS.tokenDaily, {});
    const map = (obj && typeof obj === 'object') ? obj : {};
    const k = todayKey();
    map[k] = (typeof map[k] === 'number' ? map[k] : 0) + delta;
    writeKey(KEYS.tokenDaily, map);
  } catch (_) {}
}

/** 今日累计消耗（今天新消耗的 token；跨天归零） */
function getTodayCumulative(): number {
  try {
    migrateDailyVersion();
    const obj: any = readKey(KEYS.tokenDaily, {});
    const v = obj ? obj[todayKey()] : 0;
    return typeof v === 'number' ? v : 0;
  } catch (_) {
    return 0;
  }
}

/** 单个会话的 token 数据 */
interface SessionToken {
  /** 当前上下文总量（最新 accumulated） */
  context: number;
  /** 累计消耗（各轮回复结束时的 accumulated 之和） */
  cumulative: number;
  /** 上次记录的 accumulated（用于去重/判断是否新增一轮） */
  lastAcc: number;
}

/** 读整个 token 缓存（sessionId → SessionToken） */
function readTokenCache(): Record<string, SessionToken> {
  const obj: any = readKey(KEYS.tokenCache, {});
  return (obj && typeof obj === 'object') ? obj : {};
}

/**
 * 记录某会话的当前上下文 token，并累加累计消耗。
 * 累计消耗 = 各轮回复结束时的 accumulated 之和
 *（DeepSeek 每轮都把完整历史作为 prompt 重发，故每轮实际处理的 token ≈ 当轮 accumulated）。
 * 仅在 acc 相比上次增大时才累加，避免同一轮重复事件重复计数。
 */
function saveTokenForSession(sessionId: string, acc: number): void {
  if (!sessionId || typeof acc !== 'number') return;
  if (isSubagentWindow) return; // 子代理不参与 token 统计（共享父窗口 localStorage，会污染）
  try {
    const cache = readTokenCache();
    let entry: any = cache[sessionId];
    // 兼容旧格式（数字）
    if (typeof entry === 'number') entry = { context: entry, cumulative: entry, lastAcc: entry };
    if (!entry || typeof entry !== 'object') entry = { context: 0, cumulative: 0, lastAcc: 0 };
    const lastAcc = typeof entry.lastAcc === 'number' ? entry.lastAcc : 0;
    if (acc > lastAcc) {
      // 窗口累计：累加"当轮完整上下文"（DeepSeek 每轮都重发完整历史）
      entry.cumulative = (typeof entry.cumulative === 'number' ? entry.cumulative : 0) + acc;
      // 今日窗口：累加"当轮完整 acc"（今天每轮的总量之和）；跨天由 todayKey() 天然归零
      addDailyToken(acc);
    }
    entry.context = acc;
    entry.lastAcc = acc;
    cache[sessionId] = entry;
    // 限制缓存条数，避免无限增长（保留最近 200 个）
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) delete cache[k];
    }
    writeKey(KEYS.tokenCache, cache);
  } catch (_) {}
}

/** 窗口累计：本窗口所有会话的累计消耗之和（localStorage 按 partition 隔离，天然是本窗口的） */
function getWindowCumulative(): number {
  try {
    const cache = readTokenCache();
    let sum = 0;
    for (const k of Object.keys(cache)) {
      const e: any = cache[k];
      if (typeof e === 'number') sum += e;
      else if (e && typeof e.cumulative === 'number') sum += e.cumulative;
    }
    return sum;
  } catch (_) {
    return 0;
  }
}

/** 取某会话的 token 数据（兼容旧格式） */
function getTokenForSession(sessionId: string | null): { context: number; cumulative: number } {
  if (!sessionId) return { context: 0, cumulative: 0 };
  const entry: any = readTokenCache()[sessionId];
  if (typeof entry === 'number') return { context: entry, cumulative: entry };
  if (entry && typeof entry === 'object') {
    return {
      context: typeof entry.context === 'number' ? entry.context : 0,
      cumulative: typeof entry.cumulative === 'number' ? entry.cumulative : 0,
    };
  }
  return { context: 0, cumulative: 0 };
}

interface TokenCounterDeps {
  /** 取当前页面对应的会话 ID（无则 null） */
  getCurrentSessionId(): string | null;
  /** 订阅"AI 回复完成"事件（bridge 注入的 onInterceptedResponse） */
  onResponse?: (cb: (text: string, meta: any) => void) => void;
  /** 同步到壳页面状态条：上下文 + 对话累计 + 窗口累计 + 今日累计 */
  updateShellTokenUsage?: (context: number, cumulative: number, windowCumulative: number, todayCumulative: number) => void | Promise<unknown>;
}

interface TokenCounter {
  /** 重新计算当前会话 token 并同步壳页面（数据上报，不写 DOM） */
  refresh(): Promise<void>;
}

/**
 * 启动对话 token 统计（事件驱动）
 * 仅在收到成功回复事件时记录并同步壳页面，避免失败/停止时因旧 token 值误刷新。
 */
function initTokenCounter(deps: TokenCounterDeps): TokenCounter {
  async function refresh(): Promise<void> {
    // 优先用"当前会话"的缓存值（切会话/刷新后仍能显示该会话的 token）
    const sid = deps.getCurrentSessionId();
    const cached = sid ? getTokenForSession(sid) : { context: 0, cumulative: 0 };
    const context = (cached.context > 0)
      ? cached.context
      : (serverTokenUsage && typeof serverTokenUsage.accumulatedTokens === 'number' ? serverTokenUsage.accumulatedTokens : 0);
    const cumulative = cached.cumulative || 0;

    try {
      await deps.updateShellTokenUsage?.(context, cumulative, getWindowCumulative(), getTodayCumulative());
    } catch (_) {}
  }

  deps.onResponse?.((_text: string, meta: any) => {
    serverTokenUsage = (meta && meta.tokenUsage) || null;
    // 按当前会话写入缓存（切回来时能显示该会话的值）
    const tokens = serverTokenUsage && serverTokenUsage.accumulatedTokens;
    if (typeof tokens === 'number') {
      const sid = deps.getCurrentSessionId();
      if (sid) saveTokenForSession(sid, tokens);
    }
    void refresh();
  });

  return { refresh };
}

export { initTokenCounter, setIsSubagentWindow, saveTokenForSession, getTodayCumulative };
export type { TokenCounter, TokenCounterDeps };

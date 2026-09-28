/**
 * 子代理运行状态（主进程侧）
 *
 * 供壳页面（shell.html）显示"Agent 虚拟人头"：
 *  - working（工作中）：绿色闪烁
 *  - idle（已停止）：红色
 *
 * 状态源：subagent.ts 在 runAgent 开始时 markWorking、结束时 markIdle。
 * 广播：状态变化时经 windowState 把快照推给所有壳页面（shell-agent-updated）。
 *
 * 常驻显示：除运行中的 agent 外，还会把 userData/agents 下所有已配置的 agent
 * 一并列出（状态为 idle），使工具栏始终显示全部可用子代理。
 */
import * as windowState from './window.js';
import { listAgents } from '../agents/config.js';

/** 单个 agent 的运行状态 */
interface AgentRuntime {
  /** 是否工作中 */
  working: boolean;
  /** 本轮开始时间（毫秒） */
  since: number;
  /** 最近一次委派的任务描述（截断展示） */
  task: string;
}

/** agentName -> 运行状态 */
const runtime = new Map<string, AgentRuntime>();

/**
 * 生成快照：合并「已配置的全部 agent」与「运行时有记录的 agent」。
 * - 已配置 agent 默认 idle
 * - 运行时 Map 里的 working 状态优先
 */
function snapshotAgents(): Array<{ name: string; working: boolean; since: number; task: string }> {
  const result = new Map<string, { name: string; working: boolean; since: number; task: string }>();
  // 1. 先放所有已配置的 agent（默认 idle）
  try {
    for (const a of listAgents()) {
      if (!a || !a.name) continue;
      if (a.enabled === false) continue;
      result.set(a.name, { name: a.name, working: false, since: 0, task: '' });
    }
  } catch (_) { /* 非 Electron 环境或读取失败，忽略 */ }
  // 2. 运行时记录覆盖
  for (const [name, r] of runtime.entries()) {
    result.set(name, { name, working: r.working, since: r.since, task: r.task });
  }
  return Array.from(result.values());
}

/** 把最新状态广播给所有壳页面 + AI 页面（overlay 卡片用） */
function broadcast(): void {
  const agents = snapshotAgents();
  for (const ctx of windowState.getAllContexts()) {
    try {
      if (ctx && ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('shell-agent-updated', { agents });
      }
    } catch (_) { /* ignore */ }
    try {
      // 也发给 AI 页面 view，供 overlay 的 agent 卡片渲染
      if (ctx && ctx.view && ctx.view.webContents && !ctx.view.webContents.isDestroyed()) {
        ctx.view.webContents.send('overlay-agent-updated', { agents });
      }
    } catch (_) { /* ignore */ }
  }
}

/** 标记某 agent 开始工作 */
function markAgentWorking(name: string, task: string): void {
  if (!name) return;
  runtime.set(name, {
    working: true,
    since: Date.now(),
    task: (task || '').slice(0, 120),
  });
  broadcast();
}

/** 标记某 agent 停止工作 */
function markAgentIdle(name: string): void {
  if (!name) return;
  const prev = runtime.get(name);
  runtime.set(name, {
    working: false,
    since: prev ? prev.since : Date.now(),
    task: prev ? prev.task : '',
  });
  broadcast();
}

/** 查询当前快照（壳页面加载时拉取一次） */
function getAgentStatus(): Array<{ name: string; working: boolean; since: number; task: string }> {
  return snapshotAgents();
}

/** 把当前快照推给指定壳窗口 + 其 AI 页面 view */
function pushAgentStatusTo(win: any): void {
  const agents = snapshotAgents();
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('shell-agent-updated', { agents });
    }
  } catch (_) { /* ignore */ }
  // 同时推给该窗口的 AI 页面 view（overlay 卡片用）
  try {
    const ctx = win ? windowState.getContextByWebContents(win.webContents) : null;
    const view = ctx ? ctx.view : null;
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('overlay-agent-updated', { agents });
    }
  } catch (_) { /* ignore */ }
}

export { markAgentWorking, markAgentIdle, getAgentStatus, pushAgentStatusTo, broadcast };
export type { AgentRuntime };

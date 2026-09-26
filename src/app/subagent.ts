/**
 * 子代理运行器（主进程侧编排）
 *
 * 流程：创建子代理窗口 → 等加载 → 导航到新对话 → 注入提示词+任务
 *      → 等子代理回复完成（无工具调用）→ 取最终文本 → 关闭窗口 → 返回
 *
 * 依赖注入：createWindow / profileManager 由 entry.ts 注入，避免循环依赖。
 */
import * as windowState from './window.js';
import { buildPrompt } from '../session/prompt-builder.js';

type CreateWindowFn = (profile: any) => number;

/** 各子代理窗口的"待发送提示词"缓存（windowId → prompt） */
const promptCache = new Map<number, string>();

/** bridge 拉取子代理提示词（IPC） */
export function getSubagentPrompt(windowId: number): string | null {
  return promptCache.get(windowId) || null;
}

let _createWindow: CreateWindowFn | null = null;
let _profileManager: any = null;

/** 由 entry.ts 注入依赖 */
export function injectSubagentDeps(deps: { createWindow: CreateWindowFn; profileManager: any }): void {
  _createWindow = deps.createWindow;
  _profileManager = deps.profileManager;
}

/** 等待子代理完成的回调注册表：windowId → resolve */
const pending = new Map<number, (text: string) => void>();

/** bridge 侧检测到子代理完成时调用（IPC 入口） */
export function onSubagentResponse(windowId: number, text: string): void {
  const resolve = pending.get(windowId);
  if (resolve) {
    pending.delete(windowId);
    resolve(text || '');
  }
}

/** 等子代理回复完成（超时兜底） */
function waitForDone(windowId: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      pending.delete(windowId);
      resolve('__SUBAGENT_TIMEOUT__');
    }, timeoutMs);
    pending.set(windowId, (text) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(text);
    });
  });
}

/**
 * 运行一个子代理。
 * @param parentProfileId 父窗口 profile id（决定 partition）
 * @param agentName 代理名
 * @param task 任务描述
 * @param systemPrompt 代理系统提示（正文）
 * @param tools 允许的工具（可选，空=全部）
 * @param timeoutMs 超时
 * @returns 子代理最终文本
 */
export async function runAgent(opts: {
  parentProfileId: string;
  parentWindowId: number;
  agentName: string;
  task: string;
  systemPrompt: string;
  tools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
}): Promise<string> {
  if (!_createWindow || !_profileManager) throw new Error('子代理依赖未注入');
  const timeoutMs = opts.timeoutMs || 600000; // 默认 10 分钟

  // 取父窗口的项目目录 + providerId（用于构建工具系统提示）
  const parentCtx = windowState.getWindowContext(opts.parentWindowId);
  const parentStore = parentCtx ? parentCtx.sessionStore : null;
  const projectDir = parentStore ? parentStore.state.selectedProjectDir : null;
  const providerId = (parentCtx && parentCtx.providerId) || 'deepseek';

  // 创建子代理窗口（复用父 partition）
  const parent = _profileManager.getProfileById(opts.parentProfileId);
  if (!parent) throw new Error('父 profile 不存在: ' + opts.parentProfileId);
  const subProfile = _profileManager.createSubagentProfile(parent, opts.agentName);
  subProfile.subagentConfig = {
    agentName: opts.agentName,
    task: opts.task,
    systemPrompt: opts.systemPrompt,
    tools: opts.tools || null,
    maxTurns: opts.maxTurns || null,
  };
  const windowId = _createWindow(subProfile);

  // 关键：把父窗口的项目目录写入子代理窗口的 sessionStore，
  // 否则子代理执行工具（execute-js 从 ctx.sessionStore.state.selectedProjectDir 取）
  // 时 projectDir 为 null，相对路径/初始化状态都会错。
  try {
    const subCtx = windowState.getWindowContext(windowId);
    if (subCtx && subCtx.sessionStore && projectDir) {
      subCtx.sessionStore.state.selectedProjectDir = projectDir;
    }
  } catch (_) { /* ignore */ }

  // 构建工具系统提示（复用 buildPrompt；含工具 API/列表/说明）
  try {
    const built = buildPrompt({ providerId, selectedDir: projectDir, isCompaction: false });
    if (built && built.prompt) promptCache.set(windowId, built.prompt);
  } catch (err: any) {
    console.error('[子代理] 构建提示词失败:', err.message);
  }

  try {
    const text = await waitForDone(windowId, timeoutMs);
    if (text === '__SUBAGENT_TIMEOUT__') throw new Error('子代理执行超时');
    return text;
  } finally {
    // 关闭子代理窗口
    try {
      const ctx = windowState.getWindowContext(windowId);
      if (ctx && ctx.win && !ctx.win.isDestroyed()) ctx.win.close();
    } catch (_) { /* ignore */ }
  }
}

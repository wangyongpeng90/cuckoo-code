/**
 * DSH 事件桥（主进程侧，C3）。
 *
 * 把主进程收到的 AI 事件（来自 bridge 的 harness-event-report）
 * 转成 DSH 标准事件名，广播给所有已加载的 DSH 插件的 EventBus。
 *
 * 事件映射（与 PR#36 bridge 层一致，但这是主进程实现）：
 *   harness stream   → agent/assistant-stream
 *   harness assistant-done → session/event + agent/turn-end
 *   harness task-idle → agent/task-idle
 *   harness tool-start → tool/call
 *   harness tool-end  → tool/result
 */
import { EventBus } from '../runtime/events.js';

/** 活跃插件的 EventBus（每个已加载 DSH 插件一个） */
const activeBuses = new Set<EventBus>();

/** 注册（插件加载时调用） */
function registerBus(bus: EventBus): void { activeBuses.add(bus); }
/** 注销（插件卸载时调用） */
function unregisterBus(bus: EventBus): void { activeBuses.delete(bus); }

/** 向所有活跃插件广播一个 DSH 事件 */
function broadcastDshEvent(event: string, ...args: any[]): void {
  for (const bus of activeBuses) {
    try { bus.emit(event, ...args); } catch (_) { /* ignore */ }
  }
}

/**
 * [261125-bmsfsh] 阶段 4：把「可拦截事件」按 waterfall 语义跑一遍。
 *
 * DSH 的 `system-prompt/assemble` / `agent/pre-step` / `tools/pre-execute` 是**瀑布**：
 * 每个监听器收到 `(value, ...args, next)`，调 `next()` 取下游结果，返回自己的加工结果。
 * 插件（如 dsh-purge）靠它改写系统提示词、拦截发送。
 *
 * 多个插件按注册顺序串起来，任一环节抛错只跳过该环节（不让整条链死掉——
 * dsh-purge 自己也在 handler 里 catch，这个容错语义要对齐）。
 *
 * @param event 事件名
 * @param value 初始值
 * @param rest  其余参数（原样透传给每个监听器）
 * @returns 链尾的最终值
 */
async function waterfallDshEvent(event: string, value: any, ...rest: any[]): Promise<any> {
  const listeners: Array<(v: any, ...a: any[]) => any> = [];
  for (const bus of activeBuses) {
    try {
      const got = (bus as any).listeners ? (bus as any).listeners(event) : [];
      for (const fn of got) if (typeof fn === 'function') listeners.push(fn);
    } catch (_) { /* ignore */ }
  }
  if (!listeners.length) return value;
  let idx = 0;
  const run = async (current: any): Promise<any> => {
    if (idx >= listeners.length) return current;
    const fn = listeners[idx];
    idx += 1;
    let called = false;
    const next = async (override?: any) => {
      if (called) return override;
      called = true;
      return run(override === undefined ? current : override);
    };
    try {
      const result = await fn(current, ...rest, next);
      return result === undefined ? await next() : result;
    } catch (e: any) {
      console.error('[dsh-event] ' + event + ' 监听器抛错，跳过:', e && e.message ? e.message : e);
      return await next();
    }
  };
  return run(value);
}

/**
 * 把 bridge 上报的 payload（harness-event-report）转成 DSH 事件并广播。
 * @param payload - bridge 上报的 { type, ... }
 */
function dispatchHarnessPayload(payload: any): void {
  if (!payload || typeof payload.type !== 'string') return;
  switch (payload.type) {
    case 'stream':
      broadcastDshEvent('agent/assistant-stream', {
        frame: { think: payload.think || '', text: payload.text || '', finished: !!payload.finished },
      });
      break;
    case 'assistant-done':
      broadcastDshEvent('session/event', { type: 'assistant/message', text: payload.text || '' });
      broadcastDshEvent('agent/turn-end', { text: payload.text || '' });
      break;
    case 'task-idle':
      broadcastDshEvent('agent/task-idle', {});
      break;
    case 'tool-start':
      broadcastDshEvent('tool/call', { code: payload.code || '' });
      break;
    case 'tool-end':
      broadcastDshEvent('tool/result', {
        code: payload.code || '', success: !!payload.success,
        output: payload.output || '', error: payload.error || '',
      });
      break;
    case 'ai-state':
      broadcastDshEvent('agent/state', { generating: !!payload.generating });
      break;
    // [261125-bmsfsh] 阶段 4：会话创建（dsh-purge 监听了 4 处）
    case 'session-created':
      broadcastDshEvent('session/created', {
        id: payload.sessionId || '',
        sessionId: payload.sessionId || '',
        projectDir: payload.projectDir || '',
      });
      break;
    // [261125-bmsfsh] 阶段 4：工具执行前后（dsh-purge 监听了 pre/post-execute）
    case 'tool-pre-execute':
      broadcastDshEvent('tools/pre-execute', {
        name: payload.name || '',
        arguments: payload.arguments,
        sessionId: payload.sessionId || '',
      });
      break;
    case 'tool-post-execute':
      broadcastDshEvent('tools/post-execute', {
        name: payload.name || '',
        arguments: payload.arguments,
        result: payload.result,
        sessionId: payload.sessionId || '',
      });
      break;
    default:
      break;
  }
}

/**
 * [261125-bmsfsh] 同步版瀑布——给 `buildPrompt()` 这类同步调用链用。
 *
 * 局限（诚实记录）：如果监听器返回 Promise，**取不到它的最终值**，只能：
 *   - 用它的同步返回值（若有）
 *   - 否则沿用当前值
 * 所以异步改写提示词的插件（如 dsh-purge 的 `async () => {...}`）在这里
 * **不会完全生效**。要完全支持需把 buildPrompt 改成 async（6 个调用点）。
 * 该限制已记入需求文档「阶段 4 遗留」。
 *
 * @param event 事件名
 * @param value 初始值
 * @param rest  透传给监听器的其余参数
 */
function waterfallDshEventSync(event: string, value: any, ...rest: any[]): any {
  const listeners: Array<(v: any, ...a: any[]) => any> = [];
  for (const bus of activeBuses) {
    try {
      const got = (bus as any).listeners ? (bus as any).listeners(event) : [];
      for (const fn of got) if (typeof fn === 'function') listeners.push(fn);
    } catch (_) { /* ignore */ }
  }
  if (!listeners.length) return value;
  let current = value;
  for (const fn of listeners) {
    let called = false;
    // 同步 next：把当前值往下传是不可能的（下一个监听器还没跑），
    // 这里给一个「返回当前值」的桩，让插件的 `await next()` 至少不炸。
    const next = (override?: any) => {
      if (called) return Promise.resolve(override);
      called = true;
      return Promise.resolve(override === undefined ? current : override);
    };
    try {
      const result = fn(current, ...rest, next);
      if (result && typeof result.then === 'function') {
        // 异步监听器：同步阶段拿不到结果，先沿用当前值，异步结果丢弃（见上方局限）
        void Promise.resolve(result).catch(() => {});
      } else if (result !== undefined) {
        current = result;
      }
    } catch (e: any) {
      console.error('[dsh-event] ' + event + ' 同步监听器抛错，跳过:', e && e.message ? e.message : e);
    }
  }
  return current;
}

export { registerBus, unregisterBus, broadcastDshEvent, waterfallDshEvent, waterfallDshEventSync, dispatchHarnessPayload, activeBuses };

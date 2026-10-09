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
    default:
      break;
  }
}

export { registerBus, unregisterBus, broadcastDshEvent, dispatchHarnessPayload, activeBuses };

/**
 * Cuckoo 插件系统 - 事件桥
 *
 * 把 Cuckoo 已有的事件源，转成 DSH 标准事件名派发给插件：
 *   Cuckoo onInterceptedResponse → DSH 'session/event' + 'agent/turn-end'
 *   Cuckoo onStream             → DSH 'agent/assistant-stream'
 *   Cuckoo onTaskIdle           → DSH 'agent/task-idle'
 *
 * 每个已加载的插件上下文都持有自己的 EventBus，
 * 这里维护"活跃插件列表"，事件到来时逐个派发。
 */
import type { PluginContext } from '../types.js';

/** 活跃插件上下文集合 */
const activeContexts = new Set<PluginContext>();

export function registerContext(ctx: PluginContext): void {
  activeContexts.add(ctx);
}

export function unregisterContext(ctx: PluginContext): void {
  activeContexts.delete(ctx);
}

export function clearContexts(): void {
  activeContexts.clear();
}

export function getActiveContexts(): PluginContext[] {
  return Array.from(activeContexts);
}

/** 向所有活跃插件派发 emit 事件 */
function broadcast(event: string, ...args: any[]): void {
  for (const ctx of activeContexts) {
    const bus = (ctx as any).__bus;
    if (bus && typeof bus.emit === 'function') {
      try {
        bus.emit(event, ...args);
      } catch (err) {
        console.error('[plugin] 派发事件失败 (' + event + '):', err);
      }
    }
  }
}

/**
 * 绑定 Cuckoo 事件源（由 bridge/entry 在初始化时调用）
 * @param src Cuckoo 的事件订阅接口
 */
export interface CuckooEventSource {
  onInterceptedResponse(cb: (text: string, meta: any) => void): () => void;
  onStream(cb: (ev: { think?: string; text?: string; finished?: boolean }) => void): () => void;
  onTaskIdle(cb: () => void): () => void;
  /** 工具调用事件（可选） */
  onToolCall?(cb: (ev: any) => void): () => void;
  /** AI 错误事件（可选） */
  onAiError?(cb: (ev: any) => void): () => void;
}

export function bindCuckooEvents(src: CuckooEventSource): () => void {
  // 纯净模式切换 → 广播 harness/change 给插件（插件据此自己隐/显 DS 视图）
  try {
    const api = (typeof window !== 'undefined') ? (window as any).electronAPI : null;
    if (api && typeof api.onHarnessModeChanged === 'function') {
      api.onHarnessModeChanged((data: any) => broadcast('harness/change', data || {}));
    }
  } catch (_) { /* ignore */ }
  const d1 = src.onInterceptedResponse((text, meta) => {
    const tokenUsage = meta && meta.tokenUsage ? meta.tokenUsage : null;
    // DSH 标准事件：session/event（持久事实）+ agent/turn-end（控制）
    broadcast('session/event', {
      type: 'assistant/message',
      text,
      tokenUsage,
      raw: meta,
    });
    broadcast('agent/turn-end', { text, tokenUsage });
  });

  const d2 = src.onStream((ev) => {
    // DSH 标准事件：agent/assistant-stream（逐字流）
    broadcast('agent/assistant-stream', {
      frame: { think: ev.think || '', text: ev.text || '', finished: !!ev.finished },
    });
  });

  const d3 = src.onTaskIdle(() => {
    broadcast('agent/task-idle', {});
  });

  // 工具调用（可选事件源）
  let d4: (() => void) | null = null;
  if (typeof src.onToolCall === 'function') {
    d4 = src.onToolCall((ev: any) => {
      // DSH 标准事件：tool/call + tool/result
      if (ev && ev.phase === 'start') {
        broadcast('tool/call', { code: ev.code });
      } else if (ev && ev.phase === 'end') {
        broadcast('tool/result', {
          code: ev.code,
          success: !!ev.success,
          output: ev.output,
          error: ev.error,
        });
      }
    });
  }

  // AI 错误（可选事件源）
  let d5: (() => void) | null = null;
  if (typeof src.onAiError === 'function') {
    d5 = src.onAiError((ev: any) => {
      broadcast('agent/error', ev || {});
    });
  }

  return () => {
    d1(); d2(); d3();
    if (d4) d4();
    if (d5) d5();
  };
}

export { broadcast };


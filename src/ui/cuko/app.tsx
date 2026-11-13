
// 全局错误捕获，防止白屏
window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div style="color:red; padding: 20px; font-family: monospace; white-space: pre-wrap;"><h2>运行时崩溃</h2>${e.message}

${e.error?.stack || ''}</div>`;
});
window.addEventListener('unhandledrejection', (e) => {
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div style="color:red; padding: 20px; font-family: monospace; white-space: pre-wrap;"><h2>Promise 异常</h2>${e.reason?.message || e.reason}

${e.reason?.stack || ''}</div>`;
});

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
  type ExternalStoreThreadListAdapter,
} from '@assistant-ui/react';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { ThreadList } from '@/components/assistant-ui/elements/thread-list.aui';
import { SettingsModal } from '@/ui/shell/scripts/pages/settings-react';

// ============ 类型定义 ============
interface Config { url: string; token: string; model: string; }
const DEFAULT_CONFIG: Config = { url: 'http://127.0.0.1:3000', token: '', model: '' };
interface CukoModel { id: string; name: string; }
interface Usage { input_tokens: number; output_tokens: number; total_tokens: number; }
type Msg = ThreadMessageLike & { think?: string; usage?: Usage; };

declare global {
  interface Window {
    cukoAPI: {
      getConfig: () => Promise<Record<string, string>>;
      saveConfig: (config: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
      listSessions: () => Promise<Array<{ id: string; title: string; provider_session_id?: string; updated_at: string }>>;
      createSession: (sessionId: string) => Promise<{ success: boolean }>;
      renameSession: (sessionId: string, title: string) => Promise<{ success: boolean }>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      updateProviderId: (sessionId: string, providerId: string) => Promise<{ success: boolean }>;
      getMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; think: string; usage_json: string }>>;
      saveMessage: (msg: any) => Promise<{ success: boolean }>;
    };
  }
}

function extractText(content: AppendMessage['content']): string {
  const parts = Array.isArray(content) ? content : [];
  return parts.filter((p: any) => p && p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('\n');
}

const ERROR_MESSAGES: Record<string, string> = {
  authentication_required: '需要登录，请先在浏览器中打开并登录对应 AI 服务。',
  provider_unavailable: 'Provider 不可用，请检查桥接软件和浏览器扩展是否正常运行。',
  rate_limit_exceeded: '请求过于频繁，请稍后再试。',
  invalid_request: '请求参数不合法。',
  request_timeout: '请求超时，请重试。',
  internal_error: 'Provider 内部错误，请稍后重试。',
};
function friendlyError(code: string, message: string): string {
  const friendly = ERROR_MESSAGES[code];
  return friendly ? friendly + (message ? '（' + message + '）' : '') : (message || code);
}

// ============ 设置弹窗 ============
// ============ 主应用 ============
function ChatApp() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // 会话状态
  const [threads, setThreads] = useState<Array<{ id: string; title: string; provider_session_id?: string; updated_at: string }>>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string>('');
  const [providerSessionId, setProviderSessionId] = useState<string>('');
  
  // 消息状态
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 初始化：加载配置、会话列表
  useEffect(() => {
    window.cukoAPI.getConfig().then((raw) => {
      setConfig({ url: raw.url || DEFAULT_CONFIG.url, token: raw.token || '', model: raw.model || '' });
    }).catch(() => {});

    refreshThreads();
  }, []);

  // 刷新会话列表
  const refreshThreads = async () => {
    const list = await window.cukoAPI.listSessions();
    setThreads(list);
    if (list.length > 0 && !currentThreadId) {
      switchThread(list[0].id);
    } else if (list.length === 0) {
      switchNewThread();
    }
  };

  // 切换会话
  const switchThread = async (id: string) => {
    setCurrentThreadId(id);
    const dbMsgs = await window.cukoAPI.getMessages(id);
    const loadedMsgs: Msg[] = dbMsgs.map(m => {
      const base: Msg = {
        id: m.id,
        role: m.role as any,
        content: m.content,
        think: m.think || undefined,
        usage: m.usage_json ? JSON.parse(m.usage_json) : undefined,
      };
      // status 仅允许用于 assistant 消息
      if (m.role === 'assistant') {
        
      }
      return base;
    });
    setMessages(loadedMsgs);
    
    const session = threads.find(t => t.id === id);
    // 如果找不到，可能是刚创建的，查一下
    if (session) {
      setProviderSessionId(session.provider_session_id || '');
    } else {
      const list = await window.cukoAPI.listSessions();
      const s = list.find(x => x.id === id);
      setProviderSessionId(s?.provider_session_id || '');
    }
  };

  // 新建会话
  const switchNewThread = async () => {
    const newId = crypto.randomUUID();
    await window.cukoAPI.createSession(newId);
    setCurrentThreadId(newId);
    setMessages([]);
    setProviderSessionId('');
    await refreshThreads();
  };

  // 删除会话
  const deleteThread = async (id: string) => {
    await window.cukoAPI.deleteSession(id);
    if (currentThreadId === id) {
      setCurrentThreadId('');
      setMessages([]);
    }
    await refreshThreads();
  };

  // 重命名会话
  const renameThread = async (id: string, title: string) => {
    await window.cukoAPI.renameSession(id, title);
    await refreshThreads();
  };

  const saveConfig = async (next: Config) => {
    await window.cukoAPI.saveConfig({ url: next.url, token: next.token, model: next.model });
    setConfig(next);
    setSettingsOpen(false);
  };

  // 发送消息
  const onNew = useCallback(async (append: AppendMessage) => {
    const text = extractText(append.content);
    if (!text) return;

    let activeThreadId = currentThreadId;
    if (!activeThreadId) {
      // 如果没有当前会话，自动建一个
      activeThreadId = crypto.randomUUID();
      try {
        await window.cukoAPI.createSession(activeThreadId);
        setCurrentThreadId(activeThreadId);
        refreshThreads();
      } catch (e: any) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ 创建会话失败: ' + e.message, id: crypto.randomUUID() }]);
        return;
      }
    }

    if (!config.url || !config.model) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text, id: crypto.randomUUID() },
        { role: 'assistant', content: '⚠️ 尚未配置中转地址或模型，请先在左侧设置中填写。', id: crypto.randomUUID() },
      ]);
      return;
    }

    const userId = crypto.randomUUID();
    const userMsg: Msg = { role: 'user', content: text, id: userId };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Msg = { role: 'assistant', content: '', id: assistantId, status: { type: 'running' } };
    
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsRunning(true);

    // 落库 user 消息
    window.cukoAPI.saveMessage({ id: userId, sessionId: activeThreadId, role: 'user', content: text });

    // 如果当前标题是 New Chat，顺便改个名
    const currentThread = threads.find(t => t.id === activeThreadId);
    if (currentThread && currentThread.title === 'New Chat') {
      const newTitle = text.slice(0, 15) + (text.length > 15 ? '...' : '');
      await window.cukoAPI.renameSession(activeThreadId, newTitle);
      refreshThreads();
    }

    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch: Partial<Msg>) => {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
    };

    let finalContent = '';
    let finalThink = '';
    let finalUsage: Usage | undefined;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
      if (config.token) headers.Authorization = 'Bearer ' + config.token;

      const body: Record<string, any> = {
        cuckSessionId: activeThreadId,
        requestId,
        model: config.model,
        input: [{ type: 'text', text }],
      };
      if (providerSessionId) body.providerSessionId = providerSessionId;

      const response = await fetch(config.url.replace(/\/+$/, '') + '/v1/responses', {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let errText = 'HTTP ' + response.status;
        try { const t = await response.text(); if (t) errText += ': ' + t; } catch {}
        throw new Error(errText);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;

      const handleEvent = (eventName: string, data: string) => {
        if (sawDone) return;
        if (eventName === 'message') {
          try {
            const payload = JSON.parse(data);
            if (payload.providerSessionId && payload.providerSessionId !== providerSessionId) {
              setProviderSessionId(payload.providerSessionId);
              window.cukoAPI.updateProviderId(activeThreadId, payload.providerSessionId);
            }

            let delta = '';
            if (Array.isArray(payload.output)) {
              delta = payload.output.map((x: any) => typeof x === 'string' ? x : (x?.text || '')).join('');
            } else if (typeof payload.output === 'string') {
              delta = payload.output;
            }
            const thinkDelta = typeof payload.think === 'string' ? payload.think : '';

            if (delta) finalContent += delta;
            if (thinkDelta) finalThink += thinkDelta;

            if (delta || thinkDelta) {
              setMessages((prev) => prev.map((m) => {
                if (m.id !== assistantId) return m;
                return {
                  ...m,
                  content: (m.content as string) + delta,
                  think: thinkDelta ? (m.think || '') + thinkDelta : m.think,
                };
              }));
            }
          } catch { /* ignore */ }
        } else if (eventName === 'done') {
          sawDone = true;
          try {
            const payload = JSON.parse(data);
            finalUsage = payload.usage;
            patchAssistant({ usage: finalUsage, status: { type: 'complete', reason: 'stop' } });
          } catch {
            patchAssistant({ status: { type: 'complete', reason: 'stop' } });
          }
        } else if (eventName === 'error') {
          sawDone = true;
          try {
            const payload = JSON.parse(data);
            const msg = friendlyError(payload.code || 'internal_error', payload.message || '');
            finalContent += '\n\n⚠️ ' + msg;
            patchAssistant({ content: finalContent, status: { type: 'incomplete', reason: 'error' } });
          } catch {
            finalContent += '\n\n⚠️ ' + data;
            patchAssistant({ content: finalContent, status: { type: 'incomplete', reason: 'error' } });
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
          }
          if (dataLines.length) handleEvent(eventName, dataLines.join('\n'));
        }
      }

      if (!sawDone) patchAssistant({ status: { type: 'complete', reason: 'stop' } });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        finalContent += '\n\n（已停止）';
        patchAssistant({ content: finalContent, status: { type: 'incomplete', reason: 'cancelled' } });
      } else {
        finalContent += '\n\n⚠️ ' + (err?.message || '请求失败');
        patchAssistant({ content: finalContent, status: { type: 'incomplete', reason: 'error' } });
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      // 落库 assistant 消息
      window.cukoAPI.saveMessage({
        id: assistantId,
        sessionId: activeThreadId,
        role: 'assistant',
        content: finalContent,
        think: finalThink,
        usage: finalUsage,
      });
      refreshThreads();
    }
  }, [config, currentThreadId, providerSessionId, threads]);

  const onCancel = useCallback(async () => {
    abortRef.current?.abort();
  }, []);

  // 组装 ThreadList Adapter
  const threadListAdapter: ExternalStoreThreadListAdapter = {
    threadId: currentThreadId,
    threads: threads.map(t => ({ id: t.id, status: 'regular', threadId: t.id, title: t.title })),
    onSwitchToThread: (id) => switchThread(id),
    onSwitchToNewThread: () => switchNewThread(),
    onRename: (id, title) => renameThread(id, title),
    onDelete: (id) => deleteThread(id),
  };

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    onNew,
    onCancel,
    adapters: { threadList: threadListAdapter },
    convertMessage: (m: Msg) => {
      let content = Array.isArray(m.content) ? [...m.content] : [{ type: 'text', text: (m.content || '') as string }];
      if (m.think) content = [{ type: 'reasoning', text: m.think } as any, ...content];
      return { ...m, content, metadata: { ...(m.metadata || {}), custom: { usage: m.usage } } } as any;
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="grid h-dvh max-h-dvh grid-cols-[260px_1fr] bg-background text-foreground dark overflow-hidden">
        <div className="flex flex-col min-h-0 border-r bg-sidebar overflow-hidden">
          <div className="flex-1 overflow-y-auto p-2">
            <ThreadList />
          </div>
          <div className="border-t p-2">
            <button onClick={() => setSettingsOpen(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <span className="text-muted-foreground">⚙️</span> 设置
            </button>
          </div>
        </div>
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <Thread />
        </div>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </AssistantRuntimeProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<ChatApp />);
}

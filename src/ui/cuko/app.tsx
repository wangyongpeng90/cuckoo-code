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
interface Config {
  providerId: string;
  modelId: string;
}

interface CukoModel {
  model_id: string;
  name: string;
}

interface CukoProvider {
  id: string;
  name: string;
  base_url: string;
  api_key?: string;
  models: CukoModel[];
}

interface Usage { input_tokens: number; output_tokens: number; total_tokens: number; }
type Msg = ThreadMessageLike & { think?: string; usage?: Usage; };

declare global {
  interface Window {
    cukoAPI: {
      listProviders: () => Promise<CukoProvider[]>;
      getActive: () => Promise<{ providerId?: string, modelId?: string }>;
      setActive: (providerId: string, modelId: string) => Promise<{ success: boolean }>;
      listSessions: () => Promise<Array<{ id: string; title: string; provider_id: string; model_id: string; provider_session_id?: string; updated_at: string }>>;
      createSession: (sessionId: string, providerId?: string, modelId?: string) => Promise<{ success: boolean }>;
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
  provider_unavailable: 'Provider 不可用，请检查服务端和浏览器扩展是否正常运行。',
  rate_limit_exceeded: '请求过于频繁，请稍后再试。',
  invalid_request: '请求参数不合法。',
  request_timeout: '请求超时，请重试。',
  internal_error: 'Provider 内部错误，请稍后重试。',
};
function friendlyError(code: string, message: string): string {
  const friendly = ERROR_MESSAGES[code];
  return friendly ? friendly + (message ? '（' + message + '）' : '') : (message || code);
}

// ============ 模型选择器组件 ============
function ModelSelector({ providers, config, setConfig, disabled }: { providers: CukoProvider[]; config: Config; setConfig: (c: Config) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentProvider = providers.find(p => p.id === config.providerId);
  const currentModel = currentProvider?.models.find(m => m.model_id === config.modelId);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:text-foreground'}`}
      >
        <span>{currentModel ? (currentModel.name || currentModel.model_id) : '选择模型'}</span>
        <span className="text-[10px] opacity-70">Default</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}><path d="m18 15-6-6-6 6"/></svg>
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none z-50 flex flex-col overflow-hidden">
          <div className="border-b px-3 py-2.5 text-xs flex flex-col gap-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">模型</span>
              <span className="text-muted-foreground">{currentModel?.name || currentModel?.model_id || '未选择'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">Provider</span>
              <span className="text-muted-foreground">{currentProvider?.name || '未选择'}</span>
            </div>
          </div>
          
          <div className="p-2 border-b">
            <input
              type="text"
              placeholder="搜索模型..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md bg-accent/50 px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-accent transition-colors"
            />
          </div>

          <div className="max-h-60 overflow-y-auto p-2">
            {providers.map(provider => {
              const filtered = provider.models.filter(m => (m.name || m.model_id).toLowerCase().includes(search.toLowerCase()));
              if (filtered.length === 0) return null;
              
              return (
                <div key={provider.id} className="mb-2 last:mb-0">
                  <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {provider.name}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filtered.map(m => {
                      const isSelected = config.providerId === provider.id && config.modelId === m.model_id;
                      return (
                        <button
                          key={m.model_id}
                          type="button"
                          onClick={() => {
                            setConfig({ providerId: provider.id, modelId: m.model_id });
                            setOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground transition-colors group"
                        >
                          <span className="truncate">{m.name || m.model_id}</span>
                          {isSelected && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M20 6 9 17l-5-5"/></svg>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 主应用 ============
function ChatApp() {
  const [providers, setProviders] = useState<CukoProvider[]>([]);
  const [config, setConfig] = useState<Config>({ providerId: '', modelId: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // 会话状态
  const [threads, setThreads] = useState<Array<{ id: string; title: string; provider_id: string; model_id: string; provider_session_id?: string; updated_at: string }>>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string>('');
  const [providerSessionId, setProviderSessionId] = useState<string>('');
  
  // 消息状态
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 更新模型选择并保存为全局默认，同时更新当前空会话的绑定
  const handleConfigUpdate = async (newConfig: Config) => {
    setConfig(newConfig);
    if (window.cukoAPI) {
      await window.cukoAPI.setActive(newConfig.providerId, newConfig.modelId);
      // 如果当前会话是空的，顺便把它的绑定也更新了
      if (currentThreadId && messages.length === 0) {
        // 因为 updateSessionModel 在 preload 暴露了，直接用
        await (window.cukoAPI as any).updateSessionModel(currentThreadId, newConfig.providerId, newConfig.modelId);
        refreshThreads();
      }
    }
  };

  // 设置面板关闭时重新加载 Provider 列表
  useEffect(() => {
    if (!settingsOpen && window.cukoAPI) {
      window.cukoAPI.listProviders().then((list: any[]) => setProviders(list)).catch(() => {});
    }
  }, [settingsOpen]);

  // 初始化
  useEffect(() => {
    async function init() {
      if (!window.cukoAPI) return;
      const list = await window.cukoAPI.listProviders();
      setProviders(list);

      const active = await window.cukoAPI.getActive();
      if (active && active.providerId && active.modelId) {
        setConfig({ providerId: active.providerId, modelId: active.modelId });
      } else if (list.length > 0 && list[0].models.length > 0) {
        const defaultConfig = { providerId: list[0].id, modelId: list[0].models[0].model_id };
        setConfig(defaultConfig);
        await window.cukoAPI.setActive(defaultConfig.providerId, defaultConfig.modelId);
      }
      
      refreshThreads();
    }
    init();
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
      return {
        id: m.id,
        role: m.role as any,
        content: m.content,
        think: m.think || undefined,
        usage: m.usage_json ? JSON.parse(m.usage_json) : undefined,
        ...(m.role === 'assistant' ? { status: { type: 'complete' as const, reason: 'stop' } } : {}),
      };
    });
    setMessages(loadedMsgs);
    
    // 读取该会话绑定的模型
    const session = threads.find(t => t.id === id) || (await window.cukoAPI.listSessions()).find(x => x.id === id);
    if (session) {
      setProviderSessionId(session.provider_session_id || '');
      if (session.provider_id && session.model_id) {
        setConfig({ providerId: session.provider_id, modelId: session.model_id });
      }
    }
  };

  // 新建会话
  const switchNewThread = async () => {
    const newId = crypto.randomUUID();
    await window.cukoAPI.createSession(newId, config.providerId || undefined, config.modelId || undefined);
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

  // 发送消息
  const onNew = useCallback(async (append: AppendMessage) => {
    const text = extractText(append.content);
    if (!text) return;

    let activeThreadId = currentThreadId;
    if (!activeThreadId) {
      activeThreadId = crypto.randomUUID();
      try {
        await window.cukoAPI.createSession(activeThreadId, config.providerId, config.modelId);
        setCurrentThreadId(activeThreadId);
        refreshThreads();
      } catch (e: any) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ 创建会话失败: ' + e.message, id: crypto.randomUUID() }]);
        return;
      }
    }

    // 获取当前选中的 Provider 和 Model
    const provider = providers.find(p => p.id === config.providerId);
    if (!provider || !config.modelId) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text, id: crypto.randomUUID() },
        { role: 'assistant', content: '⚠️ 尚未选择模型，请先配置。', id: crypto.randomUUID() },
      ]);
      return;
    }

    const activeUrl = provider.base_url;
    const activeToken = provider.api_key || '';
    const activeModel = config.modelId;

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
      if (activeToken) headers.Authorization = 'Bearer ' + activeToken;

      const body: Record<string, any> = {
        cuckSessionId: activeThreadId,
        requestId,
        model: activeModel,
        input: [{ type: 'text', text }],
      };
      if (providerSessionId) body.providerSessionId = providerSessionId;

      const response = await fetch(activeUrl.replace(/\/+$/, '') + '/v1/responses', {
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
  }, [config, currentThreadId, providerSessionId, threads, providers]);

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

  // 只要会话里有消息，就禁止切换模型
  const isModelLocked = messages.length > 0 || isRunning;

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
          <Thread components={{
            ComposerExtra: () => <ModelSelector providers={providers} config={config} setConfig={handleConfigUpdate} disabled={isModelLocked} />
          }} />
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

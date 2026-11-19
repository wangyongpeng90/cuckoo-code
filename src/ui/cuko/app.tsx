/**
 * [261109-8ms69z-cuko-api] Cuko 独立窗口主应用（包含多轮循环与自定义 UI 组件）
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  useAuiState,
  type ThreadMessageLike,
  type AppendMessage,
  type ExternalStoreThreadListAdapter,
  type ReasoningMessagePartComponent,
  type ToolCallMessagePartComponent,
  type AttachmentAdapter,
} from '@assistant-ui/react';
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from '@/components/assistant-ui/elements/reasoning.aui';
import { MarkdownText } from '@/components/assistant-ui/elements/markdown-text';
import { AttachmentUI } from '@/components/assistant-ui/elements/attachment.aui';
import { useAttachmentState } from '@/components/assistant-ui/elements/attachment-state';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { SessionTree } from '@/ui/cuko/session-tree';
import { SessionIdDialog } from '@/ui/cuko/session-id-dialog';
import { SystemPromptDialog } from '@/ui/cuko/system-prompt-dialog';
import { ModelSwitchDialog } from '@/ui/cuko/model-switch-dialog';
import { buildCompressHistory } from '@/ui/cuko/compress-history';
import { RequestLogDialog } from '@/ui/cuko/request-log-dialog';
import { parseStoredContent, serializeUserMessage, toUserAttachment, type UserAttachment } from '@/ui/cuko/persisted-content';
import { SettingsModal } from '@/ui/shell/scripts/pages/settings-react';
import {
  ToolFallbackRoot,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallback,
} from '@/components/assistant-ui/elements/tool-fallback.aui';
import { CollapsibleTrigger } from '@/components/assistant-ui/elements/collapsible-root';
import { ChevronDownIcon, CheckIcon, XCircleIcon, LoaderIcon, FileText, SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============ 类型定义 ============
interface Config {
  providerId: string;
  modelId: string;
}

interface CukoModel {
  id: string;
  name: string;
}

interface CukoProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
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
      listSessions: () => Promise<Array<{ id: string; title: string; provider_id: string; model_id: string; project_dir?: string; provider_session_id?: string; archived?: number; updated_at: string }>>;
      createSession: (sessionId: string, providerId?: string, modelId?: string, projectDir?: string) => Promise<{ success: boolean }>;
      renameSession: (sessionId: string, title: string) => Promise<{ success: boolean }>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      updateProviderId: (sessionId: string, providerId: string) => Promise<{ success: boolean }>;
      updateSessionModel: (sessionId: string, providerId: string, modelId: string) => Promise<{ success: boolean }>;
      updateSessionProject: (sessionId: string, projectDir: string) => Promise<{ success: boolean; error?: string }>;
      archiveSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
      unarchiveSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
      archiveWorkspace: (path: string) => Promise<{ success: boolean; error?: string }>;
      unarchiveWorkspace: (path: string) => Promise<{ success: boolean; error?: string }>;
      listWorkspaces: () => Promise<Array<{ path: string; name: string; archived?: number }>>;
      addWorkspace: (path: string, name: string) => Promise<{ success: boolean; error?: string }>;
      renameWorkspace: (path: string, name: string) => Promise<{ success: boolean; error?: string }>;
      openWorkspaceFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
      getActiveWorkspace: () => Promise<string | null>;
      setActiveWorkspace: (path: string) => Promise<{ success: boolean; error?: string }>;
      selectDirectory: () => Promise<{ success: boolean; dir?: string; canceled?: boolean }>;
      buildSystemPrompt: (projectDir: string) => Promise<{ success: boolean; segments?: string[]; error?: string }>;
      executeJs: (code: string, projectDir: string) => Promise<{ success: boolean; output?: string; error?: string }>;
      pickResultPhrase: (n: number) => Promise<{ success: boolean; phrase?: string; error?: string }>;
      getMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; think: string; usage_json: string }>>;
      getSystemPrompt: (sessionId: string) => Promise<{ success: boolean; prompt?: string; error?: string }>;
      saveMessage: (msg: any) => Promise<{ success: boolean }>;
      saveAttachments: (sessionId: string, messageId: string, files: any[]) => Promise<{ success: boolean; attachments?: any[]; error?: string }>;
      readAttachment: (relPath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      // 后台运行（主进程执行，窗口关掉也继续）
      startRun: (params: { sessionId: string; input: any[] }) => Promise<{ success: boolean; runId?: string; error?: string }>;
      switchModel: (params: { sessionId: string; providerId: string; modelId: string; history: Array<{ type: string; text: string }> }) => Promise<{
        success: boolean;
        error?: string;
        providerSessionId?: string;
        reply?: { id: string; content: string; think?: string; usage?: any };
        hasToolBlocks?: boolean;
      }>;
      continueAfterSwitch: (params: { sessionId: string; assistantId: string }) => Promise<{
        success: boolean;
        runId?: string;
        skipped?: boolean;
        error?: string;
      }>;
      cancelRun: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
      getRuns: () => Promise<Array<any>>;
      getRequestLogs: () => Promise<Array<any>>;
      clearRequestLogs: () => Promise<{ success: boolean }>;
      subscribeRuns: () => Promise<{ success: boolean; runs?: any[] }>;
      onRunEvent: (cb: (event: any) => void) => void;
    };
  }
}

/** 附件大小上限（原始字节） */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      // "data:<mime>;base64,xxxx" → 取逗号后的部分
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });

/**
 * Cuko 附件适配器：本地文件直接读成 base64，随 input 一起发给 Stateful Provider。
 * 协议：{ type: "file", filename, mimeType, data }（见需求档案 261109-8ms69z）
 */
const CukoAttachmentAdapter: AttachmentAdapter = {
  // 注意：必须是 "*" 而不是 "*/*"。assistant-ui 的 fileMatchesAccept 只对 "*" 特判放行，
  // "*/*" 会被拆成 generalType="*"，导致任何文件都匹配失败（表现为选完文件毫无反应）。
  accept: '*',
  async add({ file }) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        id: crypto.randomUUID(),
        type: 'file',
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        file,
        status: {
          type: 'incomplete',
          reason: 'error',
          message: '文件超过 10MB 上限',
        },
      };
    }
    return {
      id: crypto.randomUUID(),
      type: 'file',
      name: file.name,
      contentType: file.type || 'application/octet-stream',
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  },
  async remove() {
    // 本地文件，无需清理远端资源
  },
  async send(attachment) {
    const data = await readFileAsBase64(attachment.file);
    return {
      id: attachment.id,
      type: 'file',
      name: attachment.name,
      contentType: attachment.contentType,
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          filename: attachment.name,
          mimeType: attachment.contentType || 'application/octet-stream',
          data,
        } as any,
      ],
    };
  },
};

function extractText(content: AppendMessage['content']): string {
  const parts = Array.isArray(content) ? content : [];
  return parts.filter((p: any) => p && p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('\n');
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
  const currentModel = currentProvider?.models.find(m => m.id === config.modelId);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:text-foreground'}`}
      >
        <span>{currentModel ? (currentModel.name || currentModel.id) : '选择模型'}</span>
        <span className="text-[10px] opacity-70">Default</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}><path d="m18 15-6-6-6 6"/></svg>
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none z-50 flex flex-col overflow-hidden">
          <div className="border-b px-3 py-2.5 text-xs flex flex-col gap-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">模型</span>
              <span className="text-muted-foreground">{currentModel?.name || currentModel?.id || '未选择'}</span>
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
              const filtered = provider.models.filter(m => (m.name || m.id).toLowerCase().includes(search.toLowerCase()));
              if (filtered.length === 0) return null;
              
              return (
                <div key={provider.id} className="mb-2 last:mb-0">
                  <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {provider.name}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filtered.map(m => {
                      const isSelected = config.providerId === provider.id && config.modelId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setConfig({ providerId: provider.id, modelId: m.id });
                            setOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground transition-colors group"
                        >
                          <span className="truncate">{m.name || m.id}</span>
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

// ============ 工作区选择器组件 ============
interface Workspace { path: string; name: string; }

function WorkspaceSelector({ workspaces, activeWorkspace, onSelect, onAdd }: {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSelect: (ws: Workspace) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const label = activeWorkspace ? activeWorkspace.name : '选择工作区';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span className="max-w-[120px] truncate">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}><path d="m18 15-6-6-6 6"/></svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none z-50 flex flex-col overflow-hidden">
          <div className="max-h-60 overflow-y-auto p-1.5">
            {workspaces.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">暂无工作区</div>
            )}
            {workspaces.map(ws => {
              const isSelected = activeWorkspace?.path === ws.path;
              return (
                <button
                  key={ws.path}
                  type="button"
                  onClick={() => { onSelect(ws); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-left hover:bg-accent hover:text-accent-foreground transition-colors group"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                  <span className="flex-1 truncate" title={ws.path}>{ws.name}</span>
                  {isSelected && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><path d="M20 6 9 17l-5-5"/></svg>}
                </button>
              );
            })}
          </div>
          <div className="border-t p-1.5">
            <button
              type="button"
              onClick={() => { onAdd(); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              <span>添加工作区...</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CukoReasoning: ReasoningMessagePartComponent = () => {
  const isStreaming = useAuiState((s) => s.message.status?.type === 'running');
  
  return (
    <ReasoningRoot streaming={isStreaming} autoOpen={true} className="my-2">
      <ReasoningTrigger active={isStreaming} />
      <ReasoningContent aria-busy={isStreaming}>
        <ReasoningText>
          <MarkdownText />
        </ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

const CukoUsage: React.FC = () => {
  // selector 只返回原始数字，避免每次生成新对象触发 getSnapshot 警告/无限重渲染
  const totalTokens = useAuiState((s) => {
    const msgs = s.thread.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const u = (msgs[i] as any)?.metadata?.custom?.usage as Usage | undefined;
      if (u && typeof u.total_tokens === 'number') return u.total_tokens;
    }
    return 0;
  });

  if (!totalTokens) return null;
  const k = (totalTokens / 1000).toFixed(2);
  return (
    <div className="text-center text-xs text-muted-foreground/70 select-none">
      上下文 {k} k
    </div>
  );
};

/**
 * 用户消息里的附件项（Cuko 专用，通过 Thread 的 UserAttachment 插槽注入）：
 * 图片显示缩略图（点开可看原图），其他文件显示文件名卡片。
 */
const CukoUserAttachment: React.FC = () => {
  const { isImage, src, name } = useAttachmentState();
  if (isImage || src) return <AttachmentUI />;
  return (
    <div
      className="bg-muted/70 border-border/60 flex max-w-[240px] items-center gap-2 rounded-lg border px-2.5 py-1.5"
      title={name}
    >
      <FileText className="text-muted-foreground size-4 shrink-0" />
      <span className="truncate text-xs">{name}</span>
    </div>
  );
};

const CukoToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  isError,
  status,
}) => {
  const isRunning = status?.type === 'running';
  
  // 解析 argsText 提取多个工具调用
  const tools = React.useMemo(() => {
    const list: Array<{ name: string; arg: string }> = [];
    if (!argsText) return list;
    // 匹配 await xxx('...') 或 await xxx("...")
    const re = /await\s+([a-zA-Z_$][\w$]*)\s*\(\s*(['"\`])(.*?)\2/g;
    let match;
    while ((match = re.exec(argsText)) !== null) {
      list.push({ name: match[1], arg: match[3] });
    }
    // 兜底：如果没匹配到带字符串参数的，匹配所有 await xxx(
    if (list.length === 0) {
      const re2 = /await\s+([a-zA-Z_$][\w$]*)\s*\(/g;
      while ((match = re2.exec(argsText)) !== null) {
        list.push({ name: match[1], arg: '' });
      }
    }
    return list;
  }, [argsText]);

  return (
    <ToolFallbackRoot className="my-2 w-full max-w-[800px]">
      <CollapsibleTrigger className="group/trigger relative flex w-full flex-col items-start gap-1 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted/50 data-[state=open]:rounded-b-none data-[state=open]:border-b-transparent">
        {tools.length > 0 ? tools.map((t, i) => (
          <div key={i} className="flex w-full items-center gap-2 text-muted-foreground">
            {isRunning ? (
              <LoaderIcon className="size-3.5 shrink-0 animate-spin" />
            ) : isError ? (
              <XCircleIcon className="size-3.5 shrink-0" />
            ) : (
              <CheckIcon className="size-3.5 shrink-0" />
            )}
            <span className="flex-1 truncate text-left font-mono text-xs">
              <b className="text-foreground font-medium">{t.name}</b> <span className="opacity-80 ml-1">{t.arg}</span>
            </span>
          </div>
        )) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="font-mono text-xs">Tool: {toolName}</span>
          </div>
        )}
        <div className="absolute right-3 top-2.5 opacity-50 transition-transform group-data-[state=open]/trigger:rotate-180">
          <ChevronDownIcon className="size-4" />
        </div>
      </CollapsibleTrigger>
      <ToolFallbackContent className="rounded-b-lg border border-t-0 border-border/40 bg-muted/10 p-3">
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={argsText} className="mb-3 max-h-[300px] overflow-y-auto custom-scrollbar" />
        <ToolFallbackResult result={result} className="max-h-[300px] overflow-y-auto custom-scrollbar" />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

/** 把主程序的明暗主题投影到 Cuko 页面（Tailwind 变量 + 壳层 --ck-* 变量） */
const applyCukoTheme = (dark: boolean) => {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  // 设置弹窗等壳层组件用的是 --ck-* 变量，由 body[data-ck-dark] 切换
  document.body.toggleAttribute('data-ck-dark', dark);
};

/**
 * 跟随主程序的 深色 / 浅色 / 跟随系统 设置。
 * Cuko 窗口不在主窗口上下文里，收不到主题广播，需要自己 theme-subscribe；
 * 首帧由 index.html 里的内联脚本按 prefers-color-scheme 处理。
 */
function useCukoTheme() {
  useEffect(() => {
    const shell = (window as any).shellAPI;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const applySnapshot = (snap: any) => {
      if (!snap || !snap.active) return;
      applyCukoTheme(snap.active.colorScheme === 'dark');
    };
    const onMediaChange = (e: MediaQueryListEvent) => applyCukoTheme(e.matches);

    try { shell?.themeSubscribe?.(); } catch { /* ignore */ }
    try { shell?.onThemeChanged?.(applySnapshot); } catch { /* ignore */ }
    Promise.resolve(shell?.themeGet?.())
      .then((r: any) => { if (r && r.success && r.snapshot) applySnapshot(r.snapshot); })
      .catch(() => {});
    mq.addEventListener('change', onMediaChange);

    return () => {
      mq.removeEventListener('change', onMediaChange);
    };
  }, []);
}

// ============ 主应用 ============
function ChatApp() {
  useCukoTheme();
  const [providers, setProviders] = useState<CukoProvider[]>([]);
  const [config, setConfig] = useState<Config>({ providerId: '', modelId: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // 会话状态
  const [threads, setThreads] = useState<Array<{ id: string; title: string; provider_id: string; model_id: string; project_dir?: string; provider_session_id?: string; archived?: number; updated_at: string }>>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string>('');
  const currentThreadIdRef = useRef<string>('');
  const setThreadId = useCallback((id: string) => {
    currentThreadIdRef.current = id;
    setCurrentThreadId(id);
  }, []);
  // 修改会话 ID 弹窗（方案 A：只改库里的值，下次请求生效）
  const [sessionIdEditing, setSessionIdEditing] = useState<{ threadId: string; title: string; value: string } | null>(null);
  // 查看首轮注入的系统提示词
  const [systemPromptView, setSystemPromptView] = useState<{ threadId: string; title: string } | null>(null);
  // 切换模型确认（有历史消息时需要先把历史压缩发给新模型）
  const [pendingModelSwitch, setPendingModelSwitch] = useState<Config | null>(null);
  // 主进程请求日志（DevTools 里看不到）
  const [requestLogOpen, setRequestLogOpen] = useState(false);
  
  // 消息状态
  const [messages, setMessages] = useState<Msg[]>([]);
  // 正在后台运行的会话（可能同时多个）；当前会话是否在跑由它派生
  const [runningSessions, setRunningSessions] = useState<string[]>([]);
  const isRunning = runningSessions.includes(currentThreadId);

  // 工作区状态
  // 工作区状态（持久化）
  const [workspaces, setWorkspaces] = useState<Array<{ path: string; name: string; archived?: number }>>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<{ path: string; name: string } | null>(null);

  const loadWorkspaces = async () => {
    try {
      const list = await (window.cukoAPI as any).listWorkspaces();
      setWorkspaces(list);
      const activePath = await (window.cukoAPI as any).getActiveWorkspace();
      if (activePath) {
        const found = list.find((w: any) => w.path === activePath);
        if (found) { setActiveWorkspace(found); return; }
      }
      if (list.length > 0) setActiveWorkspace(list[0]);
    } catch (e) { console.error('加载工作区失败', e); }
  };

  const handleSelectWorkspace = async (ws: { path: string; name: string }) => {
    setActiveWorkspace(ws);
    try {
      await (window.cukoAPI as any).setActiveWorkspace(ws.path);
      // 同步把当前会话迁移到所选工作区（持久化），否则左侧树仍显示在旧项目下
      const tid = currentThreadIdRef.current;
      if (tid) {
        await (window.cukoAPI as any).updateSessionProject(tid, ws.path);
        await refreshThreads();
      }
    } catch (e) { console.error(e); }
  };

  const handleAddWorkspace = async () => {
    try {
      const res = await (window.cukoAPI as any).selectDirectory();
      if (!res.success || !res.dir) return;
      const parts = String(res.dir).replace(/[\\/]+$/, '').split(/[\\/]/);
      const name = parts[parts.length - 1] || res.dir;
      await (window.cukoAPI as any).addWorkspace(res.dir, name);
      await (window.cukoAPI as any).setActiveWorkspace(res.dir);
      await loadWorkspaces();
    } catch (e) { console.error('选择目录失败', e); }
  };

  const handleOpenWorkspaceFolder = async (path: string) => {
    try {
      await (window.cukoAPI as any).openWorkspaceFolder(path);
    } catch (e) { console.error('打开文件夹失败', e); }
  };

  const handleArchiveWorkspace = async (path: string, archived: boolean) => {
    try {
      if (archived) await (window.cukoAPI as any).unarchiveWorkspace(path);
      else await (window.cukoAPI as any).archiveWorkspace(path);
      await loadWorkspaces();
    } catch (e) { console.error('归档工作区失败', e); }
  };

  const handleRenameWorkspace = async (path: string, name: string) => {
    try {
      await (window.cukoAPI as any).renameWorkspace(path, name);
      await loadWorkspaces();
    } catch (e) { console.error('重命名工作区失败', e); }
  };

  // 应用模型配置（无历史 / 确认切换成功后）
  const applyModelConfig = async (newConfig: Config) => {
    setConfig(newConfig);
    if (window.cukoAPI) {
      try { await window.cukoAPI.setActive(newConfig.providerId, newConfig.modelId); } catch { /* ignore */ }
    }
  };

  // 更新模型选择：空会话直接切；有历史消息先弹窗确认
  const handleConfigUpdate = async (newConfig: Config) => {
    if (!newConfig || !newConfig.providerId || !newConfig.modelId) return;
    if (newConfig.providerId === config.providerId && newConfig.modelId === config.modelId) return;
    // 系统提示词留档不算「对话」，只有真正的消息才触发压缩确认
    if (messages.some((m) => m.role !== 'system')) {
      setPendingModelSwitch(newConfig);
      return;
    }
    await applyModelConfig(newConfig);
    if (window.cukoAPI && currentThreadId) {
      await (window.cukoAPI as any).updateSessionModel(currentThreadId, newConfig.providerId, newConfig.modelId);
      refreshThreads();
    }
  };

  // 确认切换：压缩历史 → 发给新模型（type: compress）→ 成功后才落新绑定
  const confirmModelSwitch = async () => {
    const next = pendingModelSwitch;
    if (!next) return;
    if (!currentThreadId) {
      await applyModelConfig(next);
      setPendingModelSwitch(null);
      return;
    }
    const history = buildCompressHistory(messages as any);
    const res = await window.cukoAPI.switchModel({
      sessionId: currentThreadId,
      providerId: next.providerId,
      modelId: next.modelId,
      history,
    });
    if (!res || !res.success) throw new Error(res?.error || '切换失败');
    // 压缩请求也是一次 /v1/responses：模型返回的正文要显示出来
    const reply = res.reply;
    if (reply && (reply.content || reply.think)) {
      setMessages((prev) => (prev.some((m) => m.id === reply.id)
        ? prev
        : [...prev, {
            id: reply.id,
            role: 'assistant',
            content: reply.content,
            think: reply.think || undefined,
            usage: reply.usage,
            status: { type: 'complete', reason: 'stop' },
          } as Msg]));
    }
    await applyModelConfig(next);
    setPendingModelSwitch(null);
    refreshThreads();
    // 压缩回复里可能带 cuckoo 工具块：继续执行工具，并把结果发给新模型
    if (reply && res.hasToolBlocks && currentThreadId) {
      const sid = currentThreadId;
      setRunningSessions((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
      try {
        const cont = await window.cukoAPI.continueAfterSwitch({ sessionId: sid, assistantId: reply.id });
        if (!cont || !cont.success || cont.skipped) {
          setRunningSessions((prev) => prev.filter((id) => id !== sid));
          if (!cont?.success) {
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: '⚠️ 工具执行启动失败: ' + (cont?.error || '未知错误'),
            } as Msg]);
          }
        }
      } catch (e: any) {
        setRunningSessions((prev) => prev.filter((id) => id !== sid));
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '⚠️ 工具执行启动失败: ' + (e?.message || '未知错误'),
        } as Msg]);
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
        const defaultConfig = { providerId: list[0].id, modelId: list[0].models[0].id };
        setConfig(defaultConfig);
        await window.cukoAPI.setActive(defaultConfig.providerId, defaultConfig.modelId);
      }
      
      await loadWorkspaces();
      refreshThreads();
    }
    init();
  }, []);

  // 刷新会话列表
  const refreshThreads = async () => {
    const list = await window.cukoAPI.listSessions();
    setThreads(list);
    if (list.length > 0 && !currentThreadIdRef.current) {
      switchThread(list[0].id);
    } else if (list.length === 0) {
      switchNewThread();
    }
  };

  // 切换会话
  const switchThread = async (id: string) => {
    setThreadId(id);
    const [dbMsgs, runs] = await Promise.all([
      window.cukoAPI.getMessages(id),
      Promise.resolve(window.cukoAPI.getRuns?.()).catch(() => [] as any[]),
    ]);
    const loadedMsgs: Msg[] = dbMsgs.map(m => {
      // role='system'：首轮注入的系统提示词留档，原样展示（聊天页有专门的折叠块）
      if (m.role === 'system') {
        return { id: m.id, role: 'system', content: m.content } as Msg;
      }
      // content 可能是纯文本、tool-call 数组，或带附件的 `{ v:1, ... }`
      const stored = parseStoredContent(m.content, m.id);
      return {
        id: m.id,
        role: m.role as any,
        content: stored.content,
        ...(stored.attachments ? { attachments: stored.attachments } : {}),
        think: m.think || undefined,
        usage: m.usage_json ? JSON.parse(m.usage_json) : undefined,
        ...(m.role === 'assistant' ? { status: { type: 'complete' as const, reason: 'stop' } } : {}),
      };
    });
    // 该会话正在后台跑：把尚未落库的进行中消息补进列表（窗口重开 / 切回来）
    const run = (Array.isArray(runs) ? runs : []).find((r: any) => r && r.sessionId === id);
    if (run) {
      const has = (mid: string) => loadedMsgs.some((m) => m.id === mid);
      if (run.phase === 'streaming' && run.assistantId && !has(run.assistantId)) {
        loadedMsgs.push({
          id: run.assistantId,
          role: 'assistant',
          content: run.content || '',
          think: run.think || undefined,
          usage: run.usage,
          status: { type: 'running' },
        } as Msg);
      }
      if (run.toolMessageId && Array.isArray(run.toolParts) && !has(run.toolMessageId)) {
        loadedMsgs.push({
          id: run.toolMessageId,
          role: 'assistant',
          content: run.toolParts,
          status: { type: 'running' },
        } as Msg);
      }
    }
    setMessages(loadedMsgs);
    setRunningSessions((Array.isArray(runs) ? runs : []).map((r: any) => r.sessionId));
    
    // 读取该会话绑定的模型与所属工作区
    const session = threads.find(t => t.id === id) || (await window.cukoAPI.listSessions()).find(x => x.id === id);
    if (session) {
      if (session.provider_id && session.model_id) {
        setConfig({ providerId: session.provider_id, modelId: session.model_id });
      }
      // 同步输入框下方的工作区展示，避免显示上一个会话的工作区
      const dir = (session as any).project_dir || '';
      if (dir) {
        const ws = workspaces.find((w) => w.path === dir);
        setActiveWorkspace(ws || { path: dir, name: dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir });
        try { await (window.cukoAPI as any).setActiveWorkspace(dir); } catch (e) { console.error(e); }
      } else {
        setActiveWorkspace(null);
      }
    }
  };

  // 新建会话（可指定项目目录；不传则用当前 activeWorkspace）
  const switchNewThread = async (projectDir?: string) => {
    const newId = crypto.randomUUID();
    const targetDir = projectDir || activeWorkspace?.path || undefined;
    await (window.cukoAPI as any).createSession(newId, config.providerId || undefined, config.modelId || undefined, targetDir);
    if (projectDir && projectDir !== activeWorkspace?.path) {
      const ws = workspaces.find((w) => w.path === projectDir);
      if (ws) setActiveWorkspace(ws);
      try { await (window.cukoAPI as any).setActiveWorkspace(projectDir); } catch (e) { console.error(e); }
    }
    setThreadId(newId);
    setMessages([]);
    await refreshThreads();
  };

  // 删除会话
  const deleteThread = async (id: string) => {
    await window.cukoAPI.deleteSession(id);
    if (currentThreadIdRef.current === id) {
      setThreadId('');
      setMessages([]);
    }
    await refreshThreads();
  };

  // 重命名会话
  const renameThread = async (id: string, title: string) => {
    await window.cukoAPI.renameSession(id, title);
    await refreshThreads();
  };

  // 打开「系统提示词」弹窗
  const openSystemPrompt = (id: string) => {
    const t = threads.find((x) => x.id === id);
    setSystemPromptView({ threadId: id, title: t?.title || '未命名会话' });
  };

  // 打开「修改会话 ID」弹窗
  const openSessionIdDialog = (id: string) => {
    const t = threads.find((x) => x.id === id);
    setSessionIdEditing({
      threadId: id,
      title: t?.title || '未命名会话',
      value: t?.provider_session_id || '',
    });
  };

  // 保存 providerSessionId：只改库值，当前会话同步内存态，下一次请求生效
  const saveSessionId = async (value: string) => {
    const editing = sessionIdEditing;
    if (!editing) return;
    const res = await window.cukoAPI.updateProviderId(editing.threadId, value);
    if (res && res.success === false) throw new Error('写入数据库失败');
    setSessionIdEditing(null);
    await refreshThreads();
  };

  // 发送消息：落库用户消息 + 启动主进程后台运行；循环本身不在渲染进程
  const onNew = useCallback(async (append: AppendMessage) => {
    const text = extractText(append.content);
    const hasAttachments = Array.isArray((append as any).attachments) && (append as any).attachments.length > 0;
    if (!text && !hasAttachments) return;

    let activeThreadId = currentThreadId;
    if (!activeThreadId) {
      activeThreadId = crypto.randomUUID();
      try {
        await (window.cukoAPI as any).createSession(activeThreadId, config.providerId, config.modelId, activeWorkspace?.path || undefined);
        setThreadId(activeThreadId);
        refreshThreads();
      } catch (e: any) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ 创建会话失败: ' + e.message, id: crypto.randomUUID() }]);
        return;
      }
    }

    const userId = crypto.randomUUID();
    // 附件先落盘（消息展示用）；同一份 base64 也作为 Provider 请求内容
    const fileParts: Array<{ filename: string; mimeType: string; data: string }> = [];
    const appendAtts = (append as any).attachments;
    if (Array.isArray(appendAtts)) {
      for (const att of appendAtts) {
        if (!att || !Array.isArray(att.content)) continue;
        for (const p of att.content) {
          if (!p) continue;
          if (p.type === 'file' && typeof p.data === 'string') {
            fileParts.push({
              filename: p.filename || att.name || 'attachment',
              mimeType: p.mimeType || att.contentType || 'application/octet-stream',
              data: p.data,
            });
          } else if (p.type === 'image' && typeof p.image === 'string') {
            const m = /^data:([^;]+);base64,(.*)$/.exec(p.image);
            if (m) fileParts.push({ filename: p.filename || 'image', mimeType: m[1], data: m[2] });
          }
        }
      }
    }

    const savedAttachments: UserAttachment[] = [];
    if (fileParts.length > 0) {
      try {
        const res = await window.cukoAPI.saveAttachments(activeThreadId, userId, fileParts);
        if (res?.success && Array.isArray(res.attachments)) {
          res.attachments.forEach((a: any, i: number) => {
            savedAttachments.push(toUserAttachment(userId, i, { filename: a.filename, mimeType: a.mimeType, data: a.path }));
          });
        } else {
          console.error('保存附件失败', res?.error || '未知错误');
        }
      } catch (e) { console.error('保存附件失败', e); }
    }

    // 有附件时 content 存 JSON（text + 附件相对路径），无附件保持纯文本以兼容历史消息
    const persistedContent = serializeUserMessage(text, savedAttachments);
    const userMsg: Msg = {
      role: 'user',
      content: text.trim() ? text : [],
      id: userId,
      ...(savedAttachments.length > 0 ? { attachments: savedAttachments } : {}),
    };
    setMessages((prev) => [...prev, userMsg]);
    setRunningSessions((prev) => (prev.includes(activeThreadId) ? prev : [...prev, activeThreadId]));
    window.cukoAPI.saveMessage({ id: userId, sessionId: activeThreadId, role: 'user', content: persistedContent });

    // 如果当前标题是 New Chat，顺便改个名
    const currentThread = threads.find(t => t.id === activeThreadId);
    if (currentThread && currentThread.title === 'New Chat') {
      const titleSource = text.trim() || (hasAttachments ? '附件对话' : '');
      const newTitle = titleSource.slice(0, 15) + (titleSource.length > 15 ? '...' : '');
      await window.cukoAPI.renameSession(activeThreadId, newTitle);
      refreshThreads();
    }

    // Provider 请求内容：系统提示词由主进程按需注入，这里只给文本 + 附件
    // input 元素保持 text/file；用户输入 / 工具结果由主进程在请求外层标 type
    const inputParts: any[] = [];
    if (text.trim()) inputParts.push({ type: 'text', text });
    for (const p of fileParts) {
      inputParts.push({ type: 'file', filename: p.filename, mimeType: p.mimeType, data: p.data });
    }

    try {
      const res = await window.cukoAPI.startRun({ sessionId: activeThreadId, input: inputParts });
      if (!res?.success) {
        setRunningSessions((prev) => prev.filter((id) => id !== activeThreadId));
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ ' + (res?.error || '启动失败'), id: crypto.randomUUID() }]);
      }
    } catch (e: any) {
      setRunningSessions((prev) => prev.filter((id) => id !== activeThreadId));
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ ' + (e?.message || '启动失败'), id: crypto.randomUUID() }]);
    }
  }, [config, currentThreadId, threads, activeWorkspace]);

  // 订阅主进程的运行事件：窗口重开 / 切回会话时继续追增量
  useEffect(() => {
    const api = window.cukoAPI as any;
    if (!api?.onRunEvent) return;

    const isCurrent = (sid: string) => currentThreadIdRef.current === sid;
    const statusOf = (status: string) =>
      status === 'cancelled'
        ? ({ type: 'incomplete', reason: 'cancelled' } as const)
        : status === 'error'
          ? ({ type: 'incomplete', reason: 'error' } as const)
          : ({ type: 'complete', reason: 'stop' } as const);

    api.onRunEvent((ev: any) => {
      if (!ev || !ev.sessionId) return;
      const sid: string = ev.sessionId;

      switch (ev.type) {
        case 'run-start': {
          setRunningSessions((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
          if (!isCurrent(sid)) break;
          setMessages((prev) => (prev.some((m) => m.id === ev.assistantId)
            ? prev
            : [...prev, { role: 'assistant', content: '', id: ev.assistantId, status: { type: 'running' } } as Msg]));
          break;
        }
        case 'delta': {
          if (!isCurrent(sid)) break;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === ev.assistantId)) {
              return [...prev, { role: 'assistant', content: ev.delta || '', id: ev.assistantId, status: { type: 'running' } } as Msg];
            }
            return prev.map((m) => {
              if (m.id !== ev.assistantId) return m;
              return {
                ...m,
                content: (m.content as string) + (ev.delta || ''),
                think: ev.thinkDelta ? ((m.think || '') + ev.thinkDelta) : m.think,
              };
            });
          });
          break;
        }
        case 'round-complete': {
          if (!isCurrent(sid)) break;
          setMessages((prev) => prev.map((m) => (m.id === ev.assistantId
            ? {
                ...m,
                content: typeof ev.content === 'string' ? ev.content : m.content,
                think: ev.think || undefined,
                usage: ev.usage || m.usage,
                status: statusOf(ev.status),
              }
            : m)));
          break;
        }
        case 'tool-start': {
          if (!isCurrent(sid)) break;
          setMessages((prev) => (prev.some((m) => m.id === ev.toolMessageId)
            ? prev
            : [...prev, { role: 'assistant', id: ev.toolMessageId, content: ev.parts || [], status: { type: 'running' } } as Msg]));
          break;
        }
        case 'tool-update':
        case 'tool-complete': {
          if (!isCurrent(sid)) break;
          setMessages((prev) => prev.map((m) => (m.id === ev.toolMessageId
            ? {
                ...m,
                content: ev.parts || [],
                ...(ev.type === 'tool-complete' ? { status: statusOf('complete') } : {}),
              }
            : m)));
          break;
        }
        case 'run-complete': {
          setRunningSessions((prev) => prev.filter((id) => id !== sid));
          if (ev.status === 'error' && ev.error && isCurrent(sid)) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant' && typeof last.content === 'string' && last.content.includes(ev.error)) return prev;
              return [...prev, { role: 'assistant', content: '⚠️ ' + ev.error, id: crypto.randomUUID() } as Msg];
            });
          }
          refreshThreads();
          break;
        }
        default:
          break;
      }
    });

    // 首次挂载：订阅并把在跑的快照同步到 runningSessions（窗口刚打开时）
    Promise.resolve(api.subscribeRuns?.())
      .then((r: any) => {
        if (r && Array.isArray(r.runs)) setRunningSessions(r.runs.map((x: any) => x.sessionId));
      })
      .catch(() => {});
  }, []);

  const onCancel = useCallback(async () => {
    await window.cukoAPI.cancelRun(currentThreadIdRef.current);
  }, []);

  // 组装 ThreadList Adapter
  const threadListAdapter: ExternalStoreThreadListAdapter = {
    threadId: currentThreadId,
    threads: threads
      .filter((t) => !t.archived)
      .map((t) => ({ id: t.id, status: 'regular' as const, threadId: t.id, title: t.title, custom: { projectDir: t.project_dir || '', providerSessionId: t.provider_session_id || '' } })),
    archivedThreads: threads
      .filter((t) => !!t.archived)
      .map((t) => ({ id: t.id, status: 'archived' as const, threadId: t.id, title: t.title, custom: { projectDir: t.project_dir || '', providerSessionId: t.provider_session_id || '' } })),
    onSwitchToThread: (id) => switchThread(id),
    onSwitchToNewThread: () => switchNewThread(),
    onRename: (id, title) => renameThread(id, title),
    onDelete: (id) => deleteThread(id),
    onArchive: async (id) => { await (window.cukoAPI as any).archiveSession(id); await refreshThreads(); },
    onUnarchive: async (id) => { await (window.cukoAPI as any).unarchiveSession(id); await refreshThreads(); },
  };

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    onNew,
    onCancel,
    adapters: { threadList: threadListAdapter, attachments: CukoAttachmentAdapter },
    convertMessage: (m: Msg) => {
      let content = Array.isArray(m.content) ? [...m.content] : [{ type: 'text', text: (m.content || '') as string }];
      if (m.think) content = [{ type: 'reasoning', text: m.think } as any, ...content];
      return { ...m, content, metadata: { ...(m.metadata || {}), custom: { usage: m.usage } } } as any;
    },
  });

  // 只在进行中禁止切模型（有历史时会弹窗确认并压缩发送）
  const modelSwitchLocked = isRunning;
  // 没有配置任何模型时，模型选择器位置改成「设置模型」入口
  const hasAnyModel = providers.some((p) => Array.isArray(p.models) && p.models.length > 0);
  // 弹窗里展示的目标模型名
  const pendingSwitchTarget = pendingModelSwitch
    ? (() => {
        const provider = providers.find((p) => p.id === pendingModelSwitch.providerId);
        const model = provider?.models.find((m) => m.id === pendingModelSwitch.modelId);
        return [provider?.name, model ? (model.name || model.id) : pendingModelSwitch.modelId].filter(Boolean).join(' / ');
      })()
    : '';

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="grid h-dvh max-h-dvh grid-cols-[260px_1fr] bg-background text-foreground overflow-hidden">
        <div className="flex flex-col min-h-0 border-r bg-sidebar overflow-hidden">
          <div className="p-2 pb-0">
            <button
              onClick={() => switchNewThread()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-3 py-1.5 text-sm transition-colors hover:bg-muted/60"
            >
              <span className="text-base leading-none">+</span> 新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <SessionTree
              threads={threads}
              workspaces={workspaces}
              activeWorkspacePath={activeWorkspace?.path}
              onRenameWorkspace={handleRenameWorkspace}
              onOpenWorkspaceFolder={handleOpenWorkspaceFolder}
              onNewThreadInWorkspace={switchNewThread}
              onArchiveWorkspace={handleArchiveWorkspace}
              onEditSessionId={openSessionIdDialog}
              onViewSystemPrompt={openSystemPrompt}
              runningSessionIds={runningSessions}
            />
          </div>
          <div className="border-t p-2">
            <button
              onClick={() => setRequestLogOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <span className="text-muted-foreground">🧾</span> 请求日志
            </button>
            <button onClick={() => setSettingsOpen(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <span className="text-muted-foreground">⚙️</span> 设置
            </button>
          </div>
        </div>
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <Thread components={{
            Reasoning: CukoReasoning,
            ComposerFooter: CukoUsage,
            UserAttachment: CukoUserAttachment,
            virtualize: true,
            ToolFallback: CukoToolFallback,
            ComposerExtra: () => (
              <div className="flex items-center gap-1">
                <WorkspaceSelector
                  workspaces={workspaces}
                  activeWorkspace={activeWorkspace}
                  onSelect={handleSelectWorkspace}
                  onAdd={handleAddWorkspace}
                />
                {hasAnyModel ? (
                  <ModelSelector providers={providers} config={config} setConfig={handleConfigUpdate} disabled={modelSwitchLocked} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    title="先去设置里添加模型提供商"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors"
                  >
                    <SettingsIcon className="size-3.5" />
                    设置模型
                  </button>
                )}
              </div>
            )
          }} />
        </div>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {sessionIdEditing && (
        <SessionIdDialog
          sessionTitle={sessionIdEditing.title}
          initialValue={sessionIdEditing.value}
          onCancel={() => setSessionIdEditing(null)}
          onSave={saveSessionId}
        />
      )}
      {systemPromptView && (
        <SystemPromptDialog
          sessionId={systemPromptView.threadId}
          sessionTitle={systemPromptView.title}
          onClose={() => setSystemPromptView(null)}
        />
      )}
      {pendingModelSwitch && (
        <ModelSwitchDialog
          targetLabel={pendingSwitchTarget}
          messageCount={messages.filter((m) => m.role !== 'system').length}
          onCancel={() => setPendingModelSwitch(null)}
          onConfirm={confirmModelSwitch}
        />
      )}
      {requestLogOpen && <RequestLogDialog onClose={() => setRequestLogOpen(false)} />}
    </AssistantRuntimeProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<ChatApp />);
}

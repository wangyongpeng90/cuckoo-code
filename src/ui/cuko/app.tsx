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
import { ChevronDownIcon, CheckIcon, XCircleIcon, LoaderIcon, FileText } from 'lucide-react';
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
      saveMessage: (msg: any) => Promise<{ success: boolean }>;
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

/** Cuko 附件存的是相对路径；data:/blob:/http(s) 都不是本地路径 */
const isDiskAttachPath = (data: unknown): data is string =>
  typeof data === 'string' && !/^(?:data|blob):/i.test(data) && !/^(?:https?:)?\/\//i.test(data);

/**
 * 把一条附件元数据转成 assistant-ui 的 CompleteAttachment。
 * 注意：图片必须看 mimeType 判定（file part 会被映射成 type: "document"），
 * 否则缩略图尺寸与预览弹窗都不会按图片处理。
 */
function toUserAttachment(msgId: string, index: number, part: { filename?: string; mimeType?: string; data: string }) {
  const mimeType = part.mimeType || 'application/octet-stream';
  const filename = part.filename || 'attachment-' + (index + 1);
  return {
    id: msgId + '-att-' + index,
    type: mimeType.startsWith('image/') ? ('image' as const) : ('document' as const),
    name: filename,
    contentType: mimeType,
    content: [{ type: 'file' as const, filename, mimeType, data: part.data }],
    status: { type: 'complete' as const },
  };
}

/** 从代码块里提取所有被调用的工具名（去重） */
function extractToolNames(code: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = /await\s+([a-zA-Z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    if (!seen.has(name)) { seen.add(name); names.push(name); }
  }
  return names;
}

/** 从代码块里提取第一个字符串参数作为预览 */
function extractFirstArg(code: string, toolName: string): string {
  try {
    const re = new RegExp(toolName + '\\s*\\(\\s*([\'"\`])([\\s\\S]*?)\\1');
    const m = re.exec(code);
    if (m && m[2]) {
      const s = m[2];
      return s.length > 60 ? s.slice(0, 60) + '…' : s;
    }
  } catch { /* ignore */ }
  return '';
}

/** 从 AI 回复中提取 ```cuckoo 代码块 */
function extractCuckooBlocks(text: string): string[] {
  const blocks: string[] = [];
  if (!text) return blocks;
  const lines = text.split('\n');
  let inBlock = false;
  let lang = '';
  let buf: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('```')) {
      if (!inBlock) {
        inBlock = true;
        lang = t.slice(3).trim().toLowerCase();
        buf = [];
      } else {
        inBlock = false;
        const code = buf.join('\n').trim();
        if (code && lang === 'cuckoo') blocks.push(code);
        buf = [];
        lang = '';
      }
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
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

// ============ 主应用 ============
function ChatApp() {
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
  const [providerSessionId, setProviderSessionId] = useState<string>('');
  
  // 消息状态
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
    const dbMsgs = await window.cukoAPI.getMessages(id);
    const loadedMsgs: Msg[] = dbMsgs.map(m => {
      let content: any = m.content;
      let attachments: ReturnType<typeof toUserAttachment>[] | undefined;
      // 工具卡片消息：content 是 JSON 数组（tool-call part）
      if (typeof m.content === 'string' && m.content.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(m.content);
          if (Array.isArray(parsed) && parsed.length > 0) {
            content = parsed;
          }
        } catch { /* 非 JSON，保留原文本 */ }
      } else if (typeof m.content === 'string' && m.content.trim().startsWith('{')) {
        // 带附件的用户消息：{ v:1, text, attachments:[{filename,mimeType,path}] }
        try {
          const parsed = JSON.parse(m.content);
          if (parsed && parsed.v === 1 && Array.isArray(parsed.attachments)) {
            content = typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : [];
            attachments = parsed.attachments
              .filter((a: any) => isDiskAttachPath(a?.path))
              .map((a: any, i: number) => toUserAttachment(m.id, i, { filename: a.filename, mimeType: a.mimeType, data: a.path }));
          }
        } catch { /* 普通文本恰好像 JSON，忽略 */ }
      }
      // 兼容中间格式：content 数组里直接混着 file part（data 是相对路径）
      if (!attachments && Array.isArray(content)) {
        const stored = content.filter((p: any) => p && p.type === 'file' && isDiskAttachPath(p.data));
        if (stored.length > 0) {
          attachments = stored.map((p: any, i: number) => toUserAttachment(m.id, i, {
            filename: p.filename, mimeType: p.mimeType, data: p.data,
          }));
          content = content.filter((p: any) => p && p.type !== 'file');
        }
      }
      return {
        id: m.id,
        role: m.role as any,
        content,
        ...(attachments ? { attachments } : {}),
        think: m.think || undefined,
        usage: m.usage_json ? JSON.parse(m.usage_json) : undefined,
        ...(m.role === 'assistant' ? { status: { type: 'complete' as const, reason: 'stop' } } : {}),
      };
    });
    setMessages(loadedMsgs);
    
    // 读取该会话绑定的模型与所属工作区
    const session = threads.find(t => t.id === id) || (await window.cukoAPI.listSessions()).find(x => x.id === id);
    if (session) {
      setProviderSessionId(session.provider_session_id || '');
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
    setProviderSessionId('');
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

  // 发送消息
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

    const provider = providers.find(p => p.id === config.providerId);
    if (!provider || !config.modelId) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text, id: crypto.randomUUID() },
        { role: 'assistant', content: '⚠️ 尚未选择模型，请先配置。', id: crypto.randomUUID() },
      ]);
      return;
    }

    const activeUrl = provider.baseUrl;
    const activeToken = provider.apiKey || '';
    const activeModel = config.modelId;

    const userId = crypto.randomUUID();
    // 附件先落盘：<userData>/cuko-attachments/<会话id>/<消息id>/<序号>.<ext>
    // 消息里只记相对路径，图片由 useAttachmentSrc 异步读盘渲染缩略图
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

    const savedAttachments: ReturnType<typeof toUserAttachment>[] = [];
    if (fileParts.length > 0) {
      try {
        const res = await (window.cukoAPI as any).saveAttachments(activeThreadId, userId, fileParts);
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
    const persistedContent = savedAttachments.length > 0
      ? JSON.stringify({
          v: 1,
          text,
          attachments: savedAttachments.map((a) => ({
            filename: a.name,
            mimeType: a.contentType || '',
            path: (a.content[0] as any).data,
          })),
        })
      : text;
    const userMsg: Msg = {
      role: 'user',
      content: text.trim() ? text : [],
      id: userId,
      ...(savedAttachments.length > 0 ? { attachments: savedAttachments } : {}),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsRunning(true);
    window.cukoAPI.saveMessage({ id: userId, sessionId: activeThreadId, role: 'user', content: persistedContent });

    // 如果当前标题是 New Chat，顺便改个名
    const currentThread = threads.find(t => t.id === activeThreadId);
    if (currentThread && currentThread.title === 'New Chat') {
      const titleSource = text.trim() || (hasAttachments ? '附件对话' : '');
      const newTitle = titleSource.slice(0, 15) + (titleSource.length > 15 ? '...' : '');
      await window.cukoAPI.renameSession(activeThreadId, newTitle);
      refreshThreads();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    let currentProviderSessionId = providerSessionId;

    // 构建首轮 input（系统提示词分段 + 用户消息 + 附件）
    const inputParts: Array<any> = [];
    if (!currentProviderSessionId && activeWorkspace?.path) {
      try {
        const sysRes = await (window.cukoAPI as any).buildSystemPrompt(activeWorkspace.path);
        if (sysRes && sysRes.success && Array.isArray(sysRes.segments)) {
          for (const seg of sysRes.segments) {
            if (seg && seg.trim()) inputParts.push({ type: 'text', text: seg });
          }
        }
      } catch (e) {
        console.error('组装系统提示词失败', e);
      }
    }
    if (text.trim()) inputParts.push({ type: 'text', text });

    // 附件：assistant-ui 把已发送附件放在 append.attachments（CompleteAttachment[]），
    // 每个附件自带 content（file/image part 数组），转成 Provider 协议
    // { type: "file", filename, mimeType, data }
    const rawParts: any[] = [];
    const appendAttachments = (append as any).attachments;
    if (Array.isArray(appendAttachments)) {
      for (const att of appendAttachments) {
        if (att && Array.isArray(att.content)) rawParts.push(...att.content);
      }
    }
    for (const p of rawParts) {
      if (!p) continue;
      if (p.type === 'file' && typeof p.data === 'string') {
        inputParts.push({
          type: 'file',
          filename: p.filename || 'attachment',
          mimeType: p.mimeType || 'application/octet-stream',
          data: p.data,
        });
      } else if (p.type === 'image' && typeof p.image === 'string') {
        // image part 的 image 字段是 data URL，拆出 base64 与 mime
        const m = /^data:([^;]+);base64,(.*)$/.exec(p.image);
        inputParts.push({
          type: 'file',
          filename: p.filename || 'image',
          mimeType: m ? m[1] : 'image/png',
          data: m ? m[2] : p.image,
        });
      }
    }

    let currentInput = inputParts;

    try {
      // 无上限轮数：只要 AI 继续输出 cuckoo 代码块就持续执行工具
      for (;;) {
        // 每轮创建独立 assistant 消息
        const assistantId = crypto.randomUUID();
        const assistantMsg: Msg = { role: 'assistant', content: '', id: assistantId, status: { type: 'running' } };
        setMessages((prev) => [...prev, assistantMsg]);

        const patchAssistant = (patch: Partial<Msg>) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
        };

        const requestId = crypto.randomUUID();
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
        if (activeToken) headers.Authorization = 'Bearer ' + activeToken;

        const body: Record<string, any> = {
          cuckSessionId: activeThreadId,
          requestId,
          model: activeModel,
          input: currentInput,
        };
        if (currentProviderSessionId) body.providerSessionId = currentProviderSessionId;

        let roundContent = '';
        let roundThink = '';
        let roundUsage: Usage | undefined;
        let sawDone = false;

        try {
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

          const handleEvent = (eventName: string, data: string) => {
            if (sawDone) return;
            if (eventName === 'message') {
              try {
                const payload = JSON.parse(data);
                if (payload.providerSessionId && payload.providerSessionId !== currentProviderSessionId) {
                  currentProviderSessionId = payload.providerSessionId;
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
                if (delta) roundContent += delta;
                if (thinkDelta) roundThink += thinkDelta;
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
                roundUsage = payload.usage;
                // done 帧里也可能携带 providerSessionId（首帧没给时的兜底）
                if (payload.providerSessionId && payload.providerSessionId !== currentProviderSessionId) {
                  currentProviderSessionId = payload.providerSessionId;
                  setProviderSessionId(payload.providerSessionId);
                  window.cukoAPI.updateProviderId(activeThreadId, payload.providerSessionId);
                }
                patchAssistant({ usage: roundUsage, status: { type: 'complete', reason: 'stop' } });
              } catch {
                patchAssistant({ status: { type: 'complete', reason: 'stop' } });
              }
            } else if (eventName === 'error') {
              sawDone = true;
              try {
                const payload = JSON.parse(data);
                const msg = friendlyError(payload.code || 'internal_error', payload.message || '');
                roundContent += '\n\n⚠️ ' + msg;
                patchAssistant({ content: roundContent, status: { type: 'incomplete', reason: 'error' } });
              } catch {
                roundContent += '\n\n⚠️ ' + data;
                patchAssistant({ content: roundContent, status: { type: 'incomplete', reason: 'error' } });
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
            roundContent += '\n\n（已停止）';
            patchAssistant({ content: roundContent, status: { type: 'incomplete', reason: 'cancelled' } });
          } else {
            roundContent += '\n\n⚠️ ' + (err?.message || '请求失败');
            patchAssistant({ content: roundContent, status: { type: 'incomplete', reason: 'error' } });
          }
        }

        // 落库本轮 assistant 消息
        window.cukoAPI.saveMessage({
          id: assistantId,
          sessionId: activeThreadId,
          role: 'assistant',
          content: roundContent,
          think: roundThink,
          usage: roundUsage,
        });

        // 只有正常收到 done 帧才检测并执行工具；中断/出错不执行
        if (!sawDone) break;

        // 检测 cuckoo 代码块
        const blocks = extractCuckooBlocks(roundContent);
        if (blocks.length === 0) break;

        console.log('[Cuko] 检测到 ' + blocks.length + ' 个 cuckoo 代码块，开始执行');

        // 所有代码块合并到同一条消息中
        const results: Array<{ success: boolean; output?: string; error?: string }> = [];
        const toolMsgId = crypto.randomUUID();
        let combinedParts: any[] = [];

        setMessages((prev) => [...prev, {
          role: 'assistant',
          id: toolMsgId,
          content: [],
          status: { type: 'running' as const, reason: 'stop' as const },
        }]);

        for (const code of blocks) {
          const toolCallId = crypto.randomUUID();
          const toolNames = extractToolNames(code);
          const toolName = toolNames.length === 0 ? 'cuckoo' : toolNames.join(' + ');

          // 先加个占位
          const currentPart = {
            type: 'tool-call' as const,
            toolCallId,
            toolName,
            args: {},
            argsText: code,
            result: undefined,
          };
          combinedParts.push(currentPart);

          setMessages((prev) => prev.map((m) => {
            if (m.id !== toolMsgId) return m;
            return { ...m, content: [...combinedParts] };
          }));

          let r: { success: boolean; output?: string; error?: string };
          try {
            r = await (window.cukoAPI as any).executeJs(code, activeWorkspace?.path || '');
          } catch (e: any) {
            r = { success: false, error: e.message || '执行失败' };
          }
          results.push(r);

          // 更新该 part 的结果
          combinedParts = combinedParts.map(p => p.toolCallId === toolCallId ? {
            ...p,
            result: r.success ? (r.output || '') : (r.error || ''),
            isError: !r.success,
          } : p);

          setMessages((prev) => prev.map((m) => {
            if (m.id !== toolMsgId) return m;
            return { ...m, content: [...combinedParts] };
          }));
        }

        // 最终落库
        window.cukoAPI.saveMessage({
          id: toolMsgId,
          sessionId: activeThreadId,
          role: 'assistant',
          content: JSON.stringify(combinedParts),
        });

        // 更新状态为完成
        setMessages((prev) => prev.map((m) => {
          if (m.id !== toolMsgId) return m;
          return { ...m, status: { type: 'complete' as const, reason: 'stop' as const } };
        }));

        // 拼下一轮 input：第一元素是回复语，后续每元素一个脚本结果
        let phrase = `执行了 ${results.length} 个脚本`;
        try {
          const phraseRes = await (window.cukoAPI as any).pickResultPhrase(results.length);
          if (phraseRes && phraseRes.success && phraseRes.phrase) phrase = phraseRes.phrase;
        } catch { /* ignore */ }

        currentInput = [
          { type: 'text' as const, text: phrase },
          ...results.map((r) => ({
            type: 'text' as const,
            text: r.success ? (r.output || '(脚本执行完成，无输出)') : '错误原因: ' + (r.error || '未知错误'),
          })),
        ];
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      refreshThreads();
    }
  }, [config, currentThreadId, providerSessionId, threads, providers, activeWorkspace]);

  const onCancel = useCallback(async () => {
    abortRef.current?.abort();
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

  // 只要会话里有消息，就禁止切换模型
  const isModelLocked = messages.length > 0 || isRunning;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="grid h-dvh max-h-dvh grid-cols-[260px_1fr] bg-background text-foreground dark overflow-hidden">
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
            />
          </div>
          <div className="border-t p-2">
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
            ToolFallback: CukoToolFallback,
            ComposerExtra: () => (
              <div className="flex items-center gap-1">
                <WorkspaceSelector
                  workspaces={workspaces}
                  activeWorkspace={activeWorkspace}
                  onSelect={handleSelectWorkspace}
                  onAdd={handleAddWorkspace}
                />
                <ModelSelector providers={providers} config={config} setConfig={handleConfigUpdate} disabled={isModelLocked} />
              </div>
            )
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

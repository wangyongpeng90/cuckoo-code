/**
 * [261109-8ms69z-cuko-api] 请求日志面板
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 请求已经改由主进程发出，渲染进程 DevTools 的 Network 看不到；
 * 这里展示主进程记录的最近 100 次请求（对话轮次 / 切模型压缩）。
 *
 * [261123-q4h7tn-cuko-openai] 像开发者工具的网络面板一样显示原始报文：
 * 请求头（密钥打码）/ 请求体原文 / 响应原文。列表只放摘要（协议、重试、命中率、条数），
 * 原文在点开时按需读取；主进程只保留最近 20 条请求的原文。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface RequestLogEntry {
  id: string;
  ts: string;
  kind: 'run' | 'compress';
  sessionId: string;
  model: string;
  url: string;
  type?: string;
  protocol?: 'cuko' | 'openai';
  attempt?: number;
  maxAttempts?: number;
  inputCount: number;
  inputChars: number;
  inputNewCount?: number;
  inputNewChars?: number;
  usage?: any;
  providerSessionId?: string;
  status: 'pending' | 'ok' | 'error';
  httpStatus?: number;
  error?: string;
  durationMs?: number;
  hasRaw?: boolean;
  rawReleased?: boolean;
}

interface RawData {
  method?: string;
  url?: string;
  httpStatus?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseText?: string;
  responseTruncated?: boolean;
  rawReleased?: boolean;
}

export interface RequestLogDialogProps {
  onClose: () => void;
}

const RELEASED_TEXT = '原文已释放（只保留最近 20 条请求的原文）';

const formatTime = (ts: string) => {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return ts;
  }
};

const statusLabel = (entry: RequestLogEntry) => {
  if (entry.status === 'ok') return '完成';
  if (entry.status === 'error') return '失败';
  return '进行中';
};

const statusClass = (entry: RequestLogEntry) => {
  if (entry.status === 'ok') return 'text-emerald-500';
  if (entry.status === 'error') return 'text-destructive';
  return 'text-muted-foreground';
};

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 缓存命中率（0~100 取整）；接口没给命中数时返回 undefined */
const hitPercent = (usage: any): number | undefined => {
  const read = num(usage?.cache_read_tokens);
  const miss = num(usage?.cache_miss_tokens);
  if (read === undefined || miss === undefined || read + miss <= 0) return undefined;
  return Math.round((read / (read + miss)) * 100);
};

const tokenText = (value: unknown) => {
  const n = num(value);
  return n === undefined ? '-' : String(n);
};

const usageText = (usage: any) => {
  if (!usage || typeof usage !== 'object') return '';
  const hit = hitPercent(usage);
  return [
    '输入 ' + tokenText(usage.input_tokens),
    '输出 ' + tokenText(usage.output_tokens),
    '缓存命中 ' + tokenText(usage.cache_read_tokens),
    '未命中 ' + tokenText(usage.cache_miss_tokens),
    hit === undefined ? '' : '命中率 ' + hit + '%',
  ].filter(Boolean).join(' · ');
};

/** 第 2 次及以后的尝试显示「第 2/4 次」 */
const retryText = (entry: RequestLogEntry) =>
  entry.attempt && entry.attempt > 1 ? ' · 第 ' + entry.attempt + '/' + (entry.maxAttempts || entry.attempt) + ' 次' : '';

/** OpenAI 协议：本轮新增的条数 / 字数 */
const newText = (entry: RequestLogEntry) =>
  entry.protocol === 'openai' && typeof entry.inputNewCount === 'number'
    ? '（本轮 +' + entry.inputNewCount + ' 项 / +' + (entry.inputNewChars ?? 0) + ' 字）'
    : '';

const prettyJson = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const sizeText = (text: string) => {
  const n = text.length;
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k 字符' : n + ' 字符';
};

const headersText = (raw: RawData, entry: RequestLogEntry) =>
  [
    (raw.method || 'POST') + ' ' + (raw.url || entry.url),
    ...Object.entries(raw.requestHeaders || {}).map(([k, v]) => k + ': ' + v),
  ].join('\n');

const RawBlock: React.FC<{ title: string; text: string; extra?: React.ReactNode; onCopy: () => void }> = ({ title, text, extra, onCopy }) => (
  <div>
    <div className="text-muted-foreground flex items-center gap-2">
      <span className="text-foreground font-medium">{title}</span>
      <span>{sizeText(text)}</span>
      <span className="flex-1" />
      {extra}
      <button
        type="button"
        onClick={onCopy}
        className="border-border hover:bg-muted rounded border px-2 py-0.5 text-[10px] transition-colors"
      >
        复制
      </button>
    </div>
    <pre className="border-border/40 bg-background mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border p-2 font-mono text-[11px]">
      {text || '（空）'}
    </pre>
  </div>
);

export const RequestLogDialog: React.FC<RequestLogDialogProps> = ({ onClose }) => {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [error, setError] = useState('');
  const [tip, setTip] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawData | null>(null);
  const [bodyMode, setBodyMode] = useState<'raw' | 'pretty'>('raw');
  const mountedRef = useRef(true);
  const expandedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const api = (window as any).cukoAPI;
    try {
      const list = await api?.getRequestLogs?.();
      if (mountedRef.current && Array.isArray(list)) setLogs(list);
      // 展开的那一条：顺带刷新原文（进行中的请求能看到响应一点点长出来）
      const id = expandedRef.current;
      if (id && api?.getRequestLogRaw) {
        const r = await api.getRequestLogRaw(id);
        if (mountedRef.current && expandedRef.current === id) setRaw(r || { rawReleased: true });
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || '读取请求日志失败');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const timer = window.setInterval(load, 1500);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => {
    const next = expandedRef.current === id ? null : id;
    expandedRef.current = next;
    setExpandedId(next);
    setRaw(null);
    if (next) load();
  };

  const clear = async () => {
    const api = (window as any).cukoAPI;
    try {
      await api?.clearRequestLogs?.();
      setLogs([]);
      expandedRef.current = null;
      setExpandedId(null);
      setRaw(null);
    } catch (e: any) {
      setError(e?.message || '清空失败');
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setTip('已复制' + label);
    window.setTimeout(() => {
      if (mountedRef.current) setTip('');
    }, 2000);
  };

  const modeButton = (mode: 'raw' | 'pretty', label: string) => (
    <button
      type="button"
      onClick={() => setBodyMode(mode)}
      className={'rounded px-2 py-0.5 text-[10px] transition-colors ' + (bodyMode === mode ? 'bg-muted text-foreground' : 'hover:bg-muted')}
    >
      {label}
    </button>
  );

  return (
    <div
      className="text-foreground fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="请求日志"
        className="bg-background flex max-h-[86vh] w-full max-w-4xl flex-col rounded-xl border p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">请求日志</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              主进程发出的最近 100 次请求，点开看原始报文（最近 20 条保留原文）
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tip && <span className="text-xs text-emerald-500">{tip}</span>}
            <button
              type="button"
              onClick={clear}
              className="border-border text-foreground hover:bg-muted h-8 rounded-md border bg-transparent px-3 text-xs transition-colors"
            >
              清空
            </button>
          </div>
        </div>

        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

        <div className="mt-3 min-h-[160px] flex-1 overflow-auto rounded-lg border">
          {logs.length === 0 ? (
            <p className="text-muted-foreground p-3 text-xs">还没有请求记录。发一条消息或切换模型后会出现在这里。</p>
          ) : (
            <div className="divide-border/60 divide-y">
              {logs.map((entry) => {
                const expanded = expandedId === entry.id;
                const hit = hitPercent(entry.usage);
                const body = raw?.requestBody || '';
                return (
                  <div key={entry.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggle(entry.id)}
                      className="hover:bg-muted/40 flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                    >
                      <span className="text-muted-foreground w-16 shrink-0 tabular-nums">{formatTime(entry.ts)}</span>
                      <span className="bg-muted w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px]">
                        {entry.kind === 'compress' ? '压缩' : '对话'}
                      </span>
                      {entry.protocol && (
                        <span className="text-muted-foreground w-12 shrink-0 text-center text-[10px]">
                          {entry.protocol === 'openai' ? 'OpenAI' : 'Cuko'}
                        </span>
                      )}
                      <span className={'w-10 shrink-0 ' + statusClass(entry)}>{statusLabel(entry)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {entry.model}
                        {entry.protocol !== 'openai' && entry.type ? ' · type=' + entry.type : ''}
                        {retryText(entry)}
                        {entry.httpStatus ? ' · HTTP ' + entry.httpStatus : ''}
                      </span>
                      {hit !== undefined && (
                        <span className={'shrink-0 tabular-nums ' + (hit > 0 ? 'text-emerald-500' : 'text-amber-500')}>
                          命中 {hit}%
                        </span>
                      )}
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {entry.inputCount} 项 / {entry.inputChars} 字{newText(entry)}
                      </span>
                      <span className="text-muted-foreground w-14 shrink-0 text-right tabular-nums">
                        {typeof entry.durationMs === 'number' ? entry.durationMs + 'ms' : '…'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="bg-muted/20 border-border/40 space-y-3 border-t px-3 py-2 text-[11px]">
                        {entry.error && <div className="text-destructive break-all">{entry.error}</div>}
                        {entry.usage && <div className="break-all">用量：{usageText(entry.usage)}</div>}
                        {!raw ? (
                          <div className="text-muted-foreground">{entry.rawReleased ? RELEASED_TEXT : '读取原文中…'}</div>
                        ) : raw.rawReleased ? (
                          <div className="text-muted-foreground">{RELEASED_TEXT}</div>
                        ) : (
                          <>
                            <RawBlock
                              title="请求头"
                              text={headersText(raw, entry)}
                              onCopy={() => copy(headersText(raw, entry), '请求头')}
                            />
                            <RawBlock
                              title="请求体"
                              text={bodyMode === 'pretty' ? prettyJson(body) : body}
                              extra={<>{modeButton('raw', '原文')}{modeButton('pretty', '格式化')}</>}
                              onCopy={() => copy(body, '请求体原文')}
                            />
                            <RawBlock
                              title={'响应' + (raw.httpStatus ? '（HTTP ' + raw.httpStatus + '）' : '')}
                              text={(raw.responseText || '') + (raw.responseTruncated ? '\n…（响应太长，只保留前 200 万字符）' : '')}
                              onCopy={() => copy(raw.responseText || '', '响应原文')}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-xs transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

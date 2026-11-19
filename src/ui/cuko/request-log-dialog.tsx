/**
 * [261109-8ms69z-cuko-api] 请求日志面板
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 请求已经改由主进程发出，渲染进程 DevTools 的 Network 看不到；
 * 这里展示主进程记录的最近 100 次请求（对话轮次 / 切模型压缩）。
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
  inputCount: number;
  inputChars: number;
  inputPreview: Array<{ type: string; text: string }>;
  providerSessionId?: string;
  status: 'pending' | 'ok' | 'error';
  httpStatus?: number;
  error?: string;
  durationMs?: number;
}

export interface RequestLogDialogProps {
  onClose: () => void;
}

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

export const RequestLogDialog: React.FC<RequestLogDialogProps> = ({ onClose }) => {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const api = (window as any).cukoAPI;
    try {
      const list = await api?.getRequestLogs?.();
      if (mountedRef.current && Array.isArray(list)) setLogs(list);
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

  const clear = async () => {
    const api = (window as any).cukoAPI;
    try {
      await api?.clearRequestLogs?.();
      setLogs([]);
      setExpandedId(null);
    } catch (e: any) {
      setError(e?.message || '清空失败');
    }
  };

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
        className="bg-background flex max-h-[82vh] w-full max-w-3xl flex-col rounded-xl border p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">请求日志</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              主进程发出的最近 100 次请求（页面 DevTools 里看不到）
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            className="border-border text-foreground hover:bg-muted h-8 shrink-0 rounded-md border bg-transparent px-3 text-xs transition-colors"
          >
            清空
          </button>
        </div>

        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

        <div className="mt-3 min-h-[160px] flex-1 overflow-auto rounded-lg border">
          {logs.length === 0 ? (
            <p className="text-muted-foreground p-3 text-xs">还没有请求记录。发一条消息或切换模型后会出现在这里。</p>
          ) : (
            <div className="divide-border/60 divide-y">
              {logs.map((entry) => {
                const expanded = expandedId === entry.id;
                return (
                  <div key={entry.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                      className="hover:bg-muted/40 flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                    >
                      <span className="text-muted-foreground w-16 shrink-0 tabular-nums">{formatTime(entry.ts)}</span>
                      <span className="bg-muted w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px]">
                        {entry.kind === 'compress' ? '压缩' : '对话'}
                      </span>
                      <span className={`w-10 shrink-0 ${statusClass(entry)}`}>{statusLabel(entry)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {entry.model}
                        {entry.type ? ' · type=' + entry.type : ''}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {entry.inputCount} 项 / {entry.inputChars} 字
                      </span>
                      <span className="text-muted-foreground w-14 shrink-0 text-right tabular-nums">
                        {typeof entry.durationMs === 'number' ? entry.durationMs + 'ms' : '…'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="bg-muted/20 border-border/40 space-y-2 border-t px-3 py-2 text-[11px]">
                        <div className="text-muted-foreground break-all">
                          {entry.url}
                          {entry.httpStatus ? ' · HTTP ' + entry.httpStatus : ''}
                          {entry.providerSessionId ? ' · session=' + entry.providerSessionId : ''}
                        </div>
                        {entry.error && <div className="text-destructive break-all">{entry.error}</div>}
                        {entry.inputPreview.map((part, index) => (
                          <div key={index} className="border-border/40 rounded border p-2">
                            <span className="text-muted-foreground">[{part.type}] </span>
                            <span className="whitespace-pre-wrap break-words">{part.text}</span>
                          </div>
                        ))}
                        {entry.inputCount > entry.inputPreview.length && (
                          <div className="text-muted-foreground">
                            其余 {entry.inputCount - entry.inputPreview.length} 项未展示（预览只保留前 10 项）
                          </div>
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

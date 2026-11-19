/**
 * [261109-8ms69z-cuko-api] 查看会话首轮注入的系统提示词
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 */
import React, { useEffect, useState } from 'react';

export interface SystemPromptDialogProps {
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
}

export const SystemPromptDialog: React.FC<SystemPromptDialogProps> = ({
  sessionId,
  sessionTitle,
  onClose,
}) => {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const api = (window as any).cukoAPI;
    Promise.resolve(api?.getSystemPrompt?.(sessionId))
      .then((r: any) => {
        if (cancelled) return;
        if (r && r.success) setPrompt(r.prompt || '');
        else setError(r?.error || '读取失败');
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || '读取失败');
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选择文本');
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
        aria-label="系统提示词"
        className="bg-background flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border p-5 shadow-xl"
      >
        <h2 className="text-sm font-medium">系统提示词</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs" title={sessionTitle}>
          会话「{sessionTitle}」首轮注入的完整提示词
        </p>

        <div className="bg-muted/20 mt-3 min-h-[120px] flex-1 overflow-auto rounded-lg border p-3">
          {error ? (
            <p className="text-destructive text-xs">{error}</p>
          ) : prompt === null ? (
            <p className="text-muted-foreground text-xs">加载中…</p>
          ) : prompt ? (
            <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">{prompt}</pre>
          ) : (
            <p className="text-muted-foreground text-xs leading-relaxed">
              该会话还没有注入过系统提示词。只有「首次对话 + 已绑定工作区」时才会注入；
              首轮没选工作区、或会话由 Provider 侧续接时，这里会是空的。
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-muted-foreground/70 text-xs">{prompt ? prompt.length + ' 字符' : ''}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copy}
              disabled={!prompt}
              className="border-border text-foreground hover:bg-muted h-8 rounded-md border bg-transparent px-3 text-xs transition-colors disabled:opacity-50"
            >
              {copied ? '已复制' : '复制'}
            </button>
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
    </div>
  );
};

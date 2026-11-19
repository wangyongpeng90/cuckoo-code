/**
 * [261109-8ms69z-cuko-api] 切换模型确认弹窗
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 有历史消息时切模型，需要把历史对话发给新模型重建上下文，
 * 这些 token 对新模型都是未命中缓存的，先让用户确认。
 */
import React, { useEffect, useState } from 'react';

export interface ModelSwitchDialogProps {
  targetLabel: string;
  messageCount: number;
  onCancel: () => void;
  /** 抛错会在弹窗里内联展示 */
  onConfirm: () => Promise<void>;
}

export const ModelSwitchDialog: React.FC<ModelSwitchDialogProps> = ({
  targetLabel,
  messageCount,
  onCancel,
  onConfirm,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e: any) {
      setError(e?.message || '切换失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div
      className="text-foreground fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="切换模型"
        className="bg-background w-full max-w-md rounded-xl border p-5 shadow-xl"
      >
        <h2 className="text-sm font-medium">切换模型</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          即将切换到「{targetLabel}」
        </p>

        <div className="border-border/60 bg-muted/20 mt-3 rounded-lg border p-3 text-xs leading-relaxed">
          <p>
            当前会话已有 <span className="text-foreground font-medium">{messageCount}</span> 条消息。
            切换后，系统会把历史对话发送给新模型以重建上下文。
          </p>
          <p className="mt-2">
            这些内容对新模型都是<span className="text-foreground font-medium">未命中缓存的 token</span>，
            可能产生较大消耗（AI 的思考内容与部分工具执行结果会被省略）。
          </p>
        </div>

        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="border-border text-foreground hover:bg-muted h-8 rounded-md border bg-transparent px-3 text-xs transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-xs transition-colors disabled:opacity-50"
          >
            {busy ? '同步历史中…' : '确认切换'}
          </button>
        </div>
      </div>
    </div>
  );
};

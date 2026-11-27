/**
 * [261127-w3pd8n] 没有可用模型时的提示弹窗：去设置模型 / 取消（输入框内容保留）
 * 详细设计见 docs/requirements/261127-w3pd8n-cuko-default-workspace.md
 */
import React, { useEffect } from 'react';

export interface ModelRequiredDialogProps {
  /** 原因（一句话） */
  reason: string;
  /** 主进程返回的原始错误（和原因不同时才显示） */
  detail?: string | undefined;
  onCancel: () => void;
  onOpenSettings: () => void;
}

export const ModelRequiredDialog: React.FC<ModelRequiredDialogProps> = ({ reason, detail, onCancel, onOpenSettings }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const showDetail = !!detail && detail !== reason;

  return (
    <div
      className="text-foreground fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="需要先设置模型" className="bg-background w-full max-w-md rounded-xl border p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium">需要先设置模型</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 rounded-md px-1.5 text-base leading-none"
          >
            ×
          </button>
        </div>

        <div className="border-border/60 bg-muted/20 mt-3 rounded-lg border p-3 text-xs leading-relaxed">
          <p className="text-foreground">{reason}</p>
          <p className="mt-2">可以在输入框下方的模型选择器里切换，或去设置里添加 / 修改模型。你输入的内容会保留在输入框里。</p>
          {showDetail && <p className="text-muted-foreground mt-2 break-all">详情：{detail}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-border text-foreground hover:bg-muted h-8 rounded-md border bg-transparent px-3 text-xs transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-xs transition-colors"
          >
            去设置模型
          </button>
        </div>
      </div>
    </div>
  );
};

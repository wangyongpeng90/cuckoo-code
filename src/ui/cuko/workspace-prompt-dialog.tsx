/**
 * [261127-w3pd8n-cuko-default-workspace] 未选项目目录时的提示弹窗
 * 发送时当前会话没绑定项目目录就弹出：选择项目目录 / 使用默认目录并发送 / 取消（输入框内容保留）。
 * 详细设计见 docs/requirements/261127-w3pd8n-cuko-default-workspace.md
 */
import React, { useEffect, useState } from 'react';

export interface WorkspacePromptDialogProps {
  /** 默认目录完整路径（还没取到时为空串） */
  defaultDir: string;
  loadError?: string | undefined;
  onCancel: () => void;
  /** 选文件夹并发送；选文件夹时取消则正常返回，弹窗保留 */
  onChooseDir: () => Promise<void>;
  onUseDefault: () => Promise<void>;
}

export const WorkspacePromptDialog: React.FC<WorkspacePromptDialogProps> = ({
  defaultDir,
  loadError,
  onCancel,
  onChooseDir,
  onUseDefault,
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

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const shownError = error || loadError || '';

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
        aria-label="没有选择项目目录"
        className="bg-background w-full max-w-md rounded-xl border p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium">没有选择项目目录</h2>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 rounded-md px-1.5 text-base leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">当前会话还没有绑定项目目录。</p>

        <div className="border-border/60 bg-muted/20 mt-3 rounded-lg border p-3 text-xs leading-relaxed">
          <p>不选择的话，会默认放到你电脑的：</p>
          <p className="text-foreground mt-1.5 font-mono break-all select-text">
            {defaultDir || (loadError ? '（获取失败）' : '正在获取…')}
          </p>
          <p className="mt-2">AI 读写文件、执行命令都在这个目录里进行。也可以选择你自己的项目目录。</p>
        </div>

        {shownError && <p className="text-destructive mt-2 text-xs">{shownError}</p>}

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
            disabled={busy || !defaultDir}
            onClick={() => run(onUseDefault)}
            className="border-border text-foreground hover:bg-muted h-8 rounded-md border bg-transparent px-3 text-xs transition-colors disabled:opacity-50"
          >
            使用默认目录并发送
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(onChooseDir)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-xs transition-colors disabled:opacity-50"
          >
            {busy ? '处理中…' : '选择项目目录…'}
          </button>
        </div>
      </div>
    </div>
  );
};

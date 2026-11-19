/**
 * [261109-8ms69z-cuko-api] 修改会话的 providerSessionId
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 行为（方案 A）：只改数据库里的值，下一次请求生效；不改写历史消息、
 * 不重建当前上下文。清空后，下一次请求会重新注入系统提示词，由
 * Stateful Provider 开启新的会话状态。
 */
import React, { useEffect, useRef, useState } from 'react';

export interface SessionIdDialogProps {
  sessionTitle: string;
  initialValue: string;
  onCancel: () => void;
  /** 抛错即视为保存失败，弹窗内联提示，不用 alert */
  onSave: (value: string) => Promise<void>;
}

export const SessionIdDialog: React.FC<SessionIdDialogProps> = ({
  sessionTitle,
  initialValue,
  onCancel,
  onSave,
}) => {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(value.trim());
    } catch (e: any) {
      setError(e?.message || '保存失败，请重试');
      setSaving(false);
    }
  };

  // 注意：这个弹窗渲染在 `text-foreground` 根容器之外（与 SettingsModal 同级），
  // 必须自己带上 text-foreground，否则深色模式下会继承浏览器默认的黑色文字。
  return (
    <div
      className="text-foreground fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="修改会话 ID"
        className="bg-background w-full max-w-md rounded-xl border p-5 shadow-xl"
      >
        <h2 className="text-sm font-medium">修改会话 ID</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs" title={sessionTitle}>
          会话「{sessionTitle}」的 Provider 会话标识
        </p>

        <input
          ref={inputRef}
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="留空 = 下次请求重新开始"
          spellCheck={false}
          className="bg-background text-foreground placeholder:text-muted-foreground border-border focus-visible:ring-ring/50 mt-4 h-9 w-full rounded-md border px-3 font-mono text-xs outline-none focus-visible:ring-1"
        />

        <p className="text-muted-foreground/80 mt-2 text-xs leading-relaxed">
          只修改记录值，下一次请求生效；历史消息和当前上下文不会被改写。
          清空后，下一次请求会重新注入系统提示词。
        </p>

        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="border-border text-foreground hover:bg-muted h-8 rounded-md border bg-transparent px-3 text-xs transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-xs transition-colors disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

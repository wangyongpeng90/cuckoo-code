/**
 * [261126-q7mxk2-cuko-message-queue] 输入框上方的排队区
 *
 * 数据来自主进程推送的队列快照（插话通道在前、普通排队在后）。
 * 不用 ComposerPrimitive.Queue：它把两条通道合成一个列表，分不出哪条是插话；条目也没有编辑方法。
 * 详细设计见 docs/requirements/261126-q7mxk2-cuko-message-queue.md
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, ListOrderedIcon, SquarePenIcon, Trash2Icon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CukoQueueDockItem {
  id: string;
  text: string;
}

export interface CukoQueueDockValue {
  items: CukoQueueDockItem[];
  steerItems: CukoQueueDockItem[];
  paused: boolean;
  isRunning: boolean;
  /** 提示文字（为空不显示） */
  notice: string;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  /** 回复中 = 插话；空闲 / 暂停 = 立即发送 */
  onSteer: (id: string) => void;
  /** 取消插话：放回普通排队最前 */
  onUnsteer: (id: string) => void;
  onDismissNotice: () => void;
}

const NOOP = () => {};

export const CukoQueueDockContext = React.createContext<CukoQueueDockValue>({
  items: [],
  steerItems: [],
  paused: false,
  isRunning: false,
  notice: '',
  onEdit: NOOP,
  onRemove: NOOP,
  onSteer: NOOP,
  onUnsteer: NOOP,
  onDismissNotice: NOOP,
});

const iconBtn =
  'text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40';

const QueueRow: React.FC<{ item: CukoQueueDockItem; steer: boolean; value: CukoQueueDockValue }> = ({ item, steer, value }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(item.text);
    setEditing(true);
  };
  const cancel = () => {
    setDraft(item.text);
    setEditing(false);
  };
  const save = () => {
    if (!draft.trim()) return;
    if (draft !== item.text) value.onEdit(item.id, draft);
    setEditing(false);
  };

  const steerDisabled = value.isRunning && steer;
  const steerTitle = value.isRunning
    ? (steer ? '已在插话通道（点「将插话 ×」可取消）' : '插话：本轮工具执行完后和工具结果一起发出；本轮没调工具则这一轮结束后马上发')
    : '立即发送' + (value.paused ? '（并恢复队列）' : '');

  return (
    <li className="group flex items-start gap-2 px-3 py-1.5 text-sm">
      {editing ? (
        <>
          <textarea
            ref={inputRef}
            value={draft}
            rows={Math.min(6, Math.max(1, draft.split('\n').length))}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
            }}
            className="bg-background focus-visible:ring-ring/50 min-w-0 flex-1 resize-none rounded-md border border-border px-2 py-1 text-sm outline-none focus-visible:ring-2"
            aria-label="编辑排队消息"
          />
          <button type="button" className={iconBtn} onClick={save} disabled={!draft.trim()} title="保存（Enter）" aria-label="保存排队消息">
            <CheckIcon className="size-3.5" />
          </button>
          <button type="button" className={iconBtn} onClick={cancel} title="取消（Esc）" aria-label="取消编辑">
            <XIcon className="size-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="text-foreground/80 min-w-0 flex-1 truncate leading-6" title={item.text}>
            {item.text}
          </span>
          {steer && (
            <button
              type="button"
              onClick={() => value.onUnsteer(item.id)}
              title="取消插话（放回普通排队最前）"
              aria-label="取消插话"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] leading-4 text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
            >
              将插话
              <XIcon className="size-3" />
            </button>
          )}
          <button type="button" className={iconBtn} onClick={startEdit} title="编辑" aria-label="编辑排队消息">
            <SquarePenIcon className="size-3.5" />
          </button>
          <button type="button" className={iconBtn} onClick={() => value.onRemove(item.id)} title="删除" aria-label="删除排队消息">
            <Trash2Icon className="size-3.5" />
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={() => value.onSteer(item.id)}
            disabled={steerDisabled}
            title={steerTitle}
            aria-label={value.isRunning ? '插话发送这条排队消息' : '立即发送这条排队消息'}
          >
            <ArrowUpIcon className="size-3.5" />
          </button>
        </>
      )}
    </li>
  );
};

export const CukoQueueDock: React.FC = () => {
  const value = React.useContext(CukoQueueDockContext);
  const [collapsed, setCollapsed] = useState(false);
  const rows = [
    ...value.steerItems.map((item) => ({ item, steer: true })),
    ...value.items.map((item) => ({ item, steer: false })),
  ];
  if (rows.length === 0 && !value.notice) return null;

  return (
    <div data-slot="cuko-queue-dock" className="-mb-2 flex w-full flex-col gap-1.5">
      {value.notice && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <span className="min-w-0 flex-1 leading-5">{value.notice}</span>
          <button type="button" className={cn(iconBtn, 'size-5')} onClick={value.onDismissNotice} aria-label="关闭提示">
            <XIcon className="size-3" />
          </button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="bg-muted/30 overflow-hidden rounded-xl border border-border/60">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
          >
            <ListOrderedIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="font-medium">{rows.length} 条排队消息</span>
            {value.isRunning && (
              <span className="text-muted-foreground text-xs">本轮结束后依次发送 · 点 ↑ 插话</span>
            )}
            {value.paused && !value.isRunning && (
              <span className="text-xs text-amber-600 dark:text-amber-400">已暂停 · 点 ↑ 立即发送，或发新消息恢复</span>
            )}
            <ChevronDownIcon className={cn('text-muted-foreground ml-auto size-4 shrink-0 transition-transform', collapsed && '-rotate-90')} />
          </button>
          {!collapsed && (
            <ul className="flex max-h-48 flex-col overflow-y-auto border-t border-border/50">
              {rows.map((r) => (
                <QueueRow key={r.item.id} item={r.item} steer={r.steer} value={value} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

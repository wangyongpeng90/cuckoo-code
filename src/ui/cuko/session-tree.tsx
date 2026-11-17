/**
 * [261109-8ms69z-cuko-api] Cuko 侧边栏会话树
 * 两层结构：项目（工作区）→ 会话。项目层为普通 UI，会话层复用 assistant-ui 的
 * ThreadListItemByIndexProvider + ThreadListItem，保证切换/重命名等行为不变。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ThreadListItemByIndexProvider, useAuiState } from '@assistant-ui/react';
import { ThreadListItem } from '@/components/assistant-ui/elements/thread-list.aui';
import { DropdownMenu } from 'radix-ui';
import {
  ArchiveIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SessionTreeThread {
  id: string;
  title: string;
  project_dir?: string;
  archived?: number;
}

export interface SessionTreeWorkspace {
  path: string;
  name: string;
  archived?: number;
}

interface SessionTreeProps {
  threads: SessionTreeThread[];
  workspaces: SessionTreeWorkspace[];
  activeWorkspacePath?: string;
  onRenameWorkspace?: (path: string, name: string) => Promise<void> | void;
  onOpenWorkspaceFolder?: (path: string) => Promise<void> | void;
  onNewThreadInWorkspace?: (path: string) => Promise<void> | void;
  onArchiveWorkspace?: (path: string, archived: boolean) => Promise<void> | void;
}

const UNASSIGNED = '__unassigned__';

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

interface Group {
  key: string;
  label: string;
  items: Array<{ index: number; id: string }>;
  archivedItems: Array<{ index: number; id: string }>;
}

const MENU_ITEM_CLASS =
  'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none';

const ProjectMenu: React.FC<{
  onRename: () => void;
  onOpenFolder: () => void;
  onNewThread: () => void;
  onArchive: () => void;
  archived?: boolean;
}> = ({ onRename, onOpenFolder, onNewThread, onArchive, archived }) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="data-[state=open]:bg-accent absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        aria-label="项目操作"
      >
        <MoreHorizontalIcon className="size-3.5" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        side="right"
        align="start"
        sideOffset={6}
        className="bg-popover text-popover-foreground z-50 min-w-36 overflow-hidden rounded-xl border p-1.5 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={onRename}>
          <PencilIcon className="size-4" />
          重命名项目
        </DropdownMenu.Item>
        <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={onOpenFolder}>
          <FolderOpenIcon className="size-4" />
          打开文件夹
        </DropdownMenu.Item>
        <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={onNewThread}>
          <PlusIcon className="size-4" />
          新建对话
        </DropdownMenu.Item>
        <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={onArchive}>
          <ArchiveIcon className="size-4" />
          {archived ? '取消归档' : '归档项目'}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

const ProjectRenameInput: React.FC<{
  initial: string;
  onDone: (name: string | null) => void;
}> = ({ initial, onDone }) => {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const next = value.trim();
    onDone(next && next !== initial ? next : null);
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onDone(null);
  };

  return (
    <input
      ref={ref}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      className="h-6 min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 text-xs outline-none"
    />
  );
};

export const SessionTree: React.FC<SessionTreeProps> = ({
  threads,
  workspaces,
  activeWorkspacePath,
  onRenameWorkspace,
  onOpenWorkspaceFolder,
  onNewThreadInWorkspace,
  onArchiveWorkspace,
}) => {
  // threadIds 与 adapter.threads 顺序一致，索引即 ByIndexProvider 需要的 index
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedArchived, setCollapsedArchived] = useState<Set<string>>(new Set());
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const nameByPath = new Map(workspaces.map((w) => [w.path, w.name]));
    const map = new Map<string, Group>();

    threads.forEach((t) => {
      const dir = (t.project_dir || '').trim();
      const key = dir || UNASSIGNED;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          label: dir ? (nameByPath.get(dir) || basename(dir)) : '未指定工作区',
          items: [],
          archivedItems: [],
        };
        map.set(key, g);
      }
      // 归档会话的 index 属于 archivedThreadIds，活跃会话属于 threadIds
      if (t.archived) {
        const index = archivedThreadIds.indexOf(t.id);
        if (index >= 0) g.archivedItems.push({ index, id: t.id });
      } else {
        const index = threadIds.indexOf(t.id);
        if (index >= 0) g.items.push({ index, id: t.id });
      }
    });

    // 空工作区也要显示（用户选了目录但还没建会话）；已归档项目不在此区渲染
    workspaces.forEach((w) => {
      if (!w.archived && !map.has(w.path)) {
        map.set(w.path, { key: w.path, label: w.name || basename(w.path), items: [], archivedItems: [] });
      }
    });

    const list = Array.from(map.values()).filter((g) => g.key !== UNASSIGNED || g.items.length > 0 || g.archivedItems.length > 0);
    // 有会话的组在前，未指定工作区垫底
    list.sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      return (b.items.length + b.archivedItems.length) - (a.items.length + a.archivedItems.length);
    });
    return list;
  }, [threads, workspaces, threadIds, archivedThreadIds]);

  const archivedProjects = useMemo(
    () => workspaces.filter((w) => !!w.archived),
    [workspaces],
  );

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleArchivedSessions = (key: string) => {
    setCollapsedArchived((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        const isUnassigned = g.key === UNASSIGNED;
        const isRenaming = renamingKey === g.key;
        return (
          <div key={g.key} className="flex flex-col">
            <div
              className={cn(
                'group relative flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                activeWorkspacePath && activeWorkspacePath === g.key && 'text-foreground',
              )}
            >
              {isRenaming ? (
                <ProjectRenameInput
                  initial={g.label}
                  onDone={async (name) => {
                    setRenamingKey(null);
                    if (name && !isUnassigned && onRenameWorkspace) {
                      await onRenameWorkspace(g.key, name);
                    }
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    title={isUnassigned ? undefined : g.key}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <ChevronRightIcon
                      className={cn('size-3.5 shrink-0 transition-transform', !isCollapsed && 'rotate-90')}
                    />
                    <FolderIcon className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{g.label}</span>
                    <span className="shrink-0 tabular-nums opacity-60 group-hover:opacity-0">
                      {g.items.length}
                    </span>
                  </button>
                  {!isUnassigned && (
                    <ProjectMenu
                      onRename={() => setRenamingKey(g.key)}
                      onOpenFolder={() => onOpenWorkspaceFolder?.(g.key)}
                      onNewThread={() => onNewThreadInWorkspace?.(g.key)}
                      onArchive={() => onArchiveWorkspace?.(g.key, false)}
                    />
                  )}
                </>
              )}
            </div>

            {!isCollapsed && (
              <div className="ms-2 flex flex-col gap-0.5 border-s border-border/40 ps-1.5 pt-0.5">
                {g.items.length === 0 && g.archivedItems.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground/60">暂无会话</div>
                ) : (
                  g.items.map((it) => (
                    <ThreadListItemByIndexProvider key={it.id} index={it.index} archived={false}>
                      <ThreadListItem />
                    </ThreadListItemByIndexProvider>
                  ))
                )}

                {g.archivedItems.length > 0 && (() => {
                  const archivedOpen = !collapsedArchived.has(g.key);
                  return (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => toggleArchivedSessions(g.key)}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                      >
                        <ChevronRightIcon
                          className={cn('size-3 shrink-0 transition-transform', archivedOpen && 'rotate-90')}
                        />
                        <span className="flex-1 truncate">已归档 ({g.archivedItems.length})</span>
                      </button>
                      {archivedOpen && (
                        <div className="ms-2 flex flex-col gap-0.5 border-s border-border/30 ps-1.5">
                          {g.archivedItems.map((it) => (
                            <ThreadListItemByIndexProvider key={it.id} index={it.index} archived={true}>
                              <ThreadListItem />
                            </ThreadListItemByIndexProvider>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {archivedProjects.length > 0 && (
        <div className="mt-2 flex flex-col border-t border-border/40 pt-2">
          <button
            type="button"
            onClick={() => setArchivedProjectsOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <ChevronRightIcon
              className={cn('size-3.5 shrink-0 transition-transform', archivedProjectsOpen && 'rotate-90')}
            />
            <span className="flex-1 truncate">已归档项目 ({archivedProjects.length})</span>
          </button>
          {archivedProjectsOpen && (
            <div className="ms-2 flex flex-col gap-0.5 border-s border-border/40 ps-1.5">
              {archivedProjects.map((w) => (
                <div
                  key={w.path}
                  className="group relative flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                >
                  <FolderIcon className="size-3.5 shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1 truncate opacity-70" title={w.path}>
                    {w.name || basename(w.path)}
                  </span>
                  <ProjectMenu
                    onRename={() => {}}
                    onOpenFolder={() => onOpenWorkspaceFolder?.(w.path)}
                    onNewThread={() => onNewThreadInWorkspace?.(w.path)}
                    onArchive={() => onArchiveWorkspace?.(w.path, true)}
                    archived={true}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

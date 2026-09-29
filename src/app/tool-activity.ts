/**
 * 工具活动历史（主进程内存态，按窗口隔离）
 * bridge executor 上报「执行中/完成」两阶段条目（同 id 更新），
 * 壳页面任务面板经 IPC 拉取全量 / 接收增量转发。
 * 等价于旧 overlay commandHistory：纯内存、上限 50、窗口关闭即丢。
 * 本模块不依赖 Electron，可在 Node 环境直接单测。
 */

export interface ToolActivityEntry {
  id: string;
  command: string;
  success: boolean;
  canceled: boolean;
  output: string;
  timestamp: number;
  /** running = 执行中（output 为空）；done = 已结束 */
  status: 'running' | 'done';
}

const MAX_ENTRIES = 50;

const histories = new Map<number, ToolActivityEntry[]>();

/** 同 id 覆盖更新，新条目插入最前，超出上限裁掉最旧；返回归一化副本（供 IPC 层转发壳页面），非法条目返回 null */
function upsertEntry(windowId: number, entry: ToolActivityEntry): ToolActivityEntry | null {
  if (!entry || typeof entry.id !== 'string' || !entry.id) return null;
  let list = histories.get(windowId);
  if (!list) {
    list = [];
    histories.set(windowId, list);
  }
  const idx = list.findIndex((e) => e.id === entry.id);
  const copy: ToolActivityEntry = {
    id: entry.id,
    command: typeof entry.command === 'string' ? entry.command : '',
    success: entry.success === true,
    canceled: entry.canceled === true,
    output: typeof entry.output === 'string' ? entry.output : '',
    timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    status: entry.status === 'running' ? 'running' : 'done',
  };
  if (idx >= 0) list[idx] = copy;
  else list.unshift(copy);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  return copy;
}

/** 取窗口历史（新→旧），返回副本避免外部改到内部状态 */
function getHistory(windowId: number): ToolActivityEntry[] {
  const list = histories.get(windowId);
  return list ? list.slice() : [];
}

function clearHistory(windowId: number): void {
  histories.delete(windowId);
}

/** 窗口关闭时清掉对应历史（内存不泄漏） */
function removeWindowHistory(windowId: number): void {
  histories.delete(windowId);
}

export { upsertEntry, getHistory, clearHistory, removeWindowHistory, MAX_ENTRIES };

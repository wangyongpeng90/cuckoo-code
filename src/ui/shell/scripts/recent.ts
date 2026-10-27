/**
 * 底部状态栏「最近使用」快捷工具。
 * 记录最近点击的 技能/MCP/子代理（最多 5 条），点击效果与对应页面卡片一致。
 * 存 localStorage（本窗口独立持久化）。
 */
import { api, escapeHtml } from './shared.js';

export type RecentType = 'skill' | 'mcp' | 'agent' | 'snippet';

export interface RecentItem {
  type: RecentType;
  /** 显示名 */
  name: string;
  ts: number;
  /** snippet：触发用的内容 */
  payload?: string;
  /** snippet：是否自动发送 */
  autoSend?: boolean;
}

const KEY = 'cuckoo-shell-recent-tools';
const MAX = 5;

/** 追加到输入框的文案（与各页面一致） */
function snippetText(type: RecentType, name: string): string {
  if (type === 'skill') return '请使用 ' + name + ' 技能';
  if (type === 'mcp') return '请使用 ' + name + ' 这个 MCP';
  if (type === 'agent') return '请使用 ' + name + ' 子代理';
  return name; // snippet：直接是内容
}

function typeLabel(type: RecentType): string {
  if (type === 'skill') return '技能';
  if (type === 'mcp') return 'MCP';
  if (type === 'agent') return '子代理';
  return '提示词';
}

export function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: any) => x && (x.type === 'skill' || x.type === 'mcp' || x.type === 'agent' || x.type === 'snippet') && typeof x.name === 'string');
  } catch (_) {
    return [];
  }
}

function saveRecent(list: RecentItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) { /* ignore */ }
}

/** 记录一次使用（同类型同名去重后置顶），最多 MAX 条 */
export function addRecent(type: RecentType, name: string, extra?: { payload?: string; autoSend?: boolean }): void {
  if (!name) return;
  let list = loadRecent().filter((x) => !(x.type === type && x.name === name));
  const item: RecentItem = { type, name, ts: Date.now() };
  if (extra && typeof extra.payload === 'string') item.payload = extra.payload;
  if (extra && typeof extra.autoSend === 'boolean') item.autoSend = extra.autoSend;
  list.unshift(item);
  if (list.length > MAX) list = list.slice(0, MAX);
  saveRecent(list);
  renderRecent();
  // React 状态栏监听（feat/shell-react）：广播变更
  try { window.dispatchEvent(new CustomEvent('cuckoo-recent-changed')); } catch (_) { /* ignore */ }
}

/** 订阅最近使用变更（React 用） */
export function onRecentChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('cuckoo-recent-changed', handler);
  return () => window.removeEventListener('cuckoo-recent-changed', handler);
}

/** 渲染底部状态栏的最近使用条 */
export function renderRecent(): void {
  const box = document.getElementById('sb-recent');
  if (!box) return;
  const list = loadRecent();
  if (list.length === 0) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '<span class="sb-recent-label">最近</span>' + list.map((it) => {
    const cls = 'sb-chip sb-chip-' + it.type;
    const tip = typeLabel(it.type) + '：' + it.name + '（点击追加到输入框）';
    return '<span class="' + cls + '" data-type="' + it.type + '" data-name="' + escapeHtml(it.name) + '" title="' + escapeHtml(tip) + '">' +
      escapeHtml(it.name) + '</span>';
  }).join('');
  box.querySelectorAll('.sb-chip').forEach((el: any) => {
    el.addEventListener('click', async () => {
      const type = el.dataset.type as RecentType;
      const name = el.dataset.name;
      // 注意：点击底部快捷按钮【只执行动作】，不重新排序（排序只在侧边栏点击卡片时发生）
      if (type === 'snippet') {
        // 快捷提示词：触发（和点卡片一样）
        const it = list.find((x) => x.type === 'snippet' && x.name === name);
        if (it && it.payload && api.triggerSnippet) {
          try { await api.triggerSnippet(it.payload, it.autoSend !== false); } catch (_) { /* ignore */ }
        }
      } else {
        if (api.appendSnippet) {
          try { await api.appendSnippet(snippetText(type, name)); } catch (_) { /* ignore */ }
        }
      }
    });
  });
}

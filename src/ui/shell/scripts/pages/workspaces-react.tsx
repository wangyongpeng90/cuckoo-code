/**
 * 工作区（会话）页（React 版）
 *
 * 迁移自 pages/workspaces.ts（430 行）：
 * - 按项目目录分组（活跃/归档）
 * - 会话项（子代理 / 压缩历史 展开）
 * - 重命名 / 归档 / 导航
 * - 组操作（新建对话 / 归档项目）
 * - 项目悬停卡片
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api, ckPrompt } from '../shared.js';

interface Session { sessionId: string; projectDir?: string; title?: string; createdAt?: string; updatedAt?: string; kind?: string; parentId?: string; agentName?: string; superseded?: boolean; archived?: boolean; }

function baseName(dir: string): string { if (!dir) return '未指定工作区'; const parts = String(dir).replace(/[\\/]+$/, '').split(/[\\/]/); return parts[parts.length - 1] || dir; }
function relTime(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t; const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + '分钟前';
  const hr = Math.floor(min / 60); if (hr < 24) return hr + '小时前';
  const day = Math.floor(hr / 24); if (day < 30) return day + '天前';
  const mon = Math.floor(day / 30); if (mon < 12) return mon + '个月前';
  return Math.floor(mon / 12) + '年前';
}
function fmtCreatedAt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '';
  const p2 = (n: number) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}
function collectHist(byId: Record<string, Session>, s: Session): Session[] {
  const out: Session[] = []; let cur = s.parentId; let guard = 0;
  while (cur && guard++ < 50) { const p = byId[cur]; if (!p || p.kind === 'subagent') break; out.push(p); cur = p.parentId; }
  return out;
}
function latestTs(list: Session[]): number { let max = 0; for (const s of list) { const t = s.updatedAt ? Date.parse(s.updatedAt) : 0; if (Number.isFinite(t) && t > max) max = t; } return max; }
function byTimeDesc(a: Session, b: Session): number { const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0; const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0; return tb - ta; }

const IC = {
  caret: 'M6 3l5 5-5 5', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  plus: 'M12 5v14M5 12h14', rename: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  archive: 'M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  unarchive: 'M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M12 10v6M9 13l3-3 3 3',
  archiveProj: 'M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  unarchiveProj: 'M3 7v5h5M3.5 12a8.5 8.5 0 1 0 2-5.4L3 9',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
};
function Svg({ d, cls }: { d: string; cls?: string }) {
  return createElement('svg', { className: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d }));
}

/** 会话项 */
function WsItem({ s, cur, archived, hasChildren, sub, open, onToggle, onNav, onRename, onArchive, onUnarchive }: any) {
  const label = (s.kind === 'subagent' && s.agentName) ? ('子代理: ' + s.agentName) : (s.title || s.sessionId);
  const time = relTime(s.updatedAt);
  const isCur = s.sessionId === cur;
  return createElement('div', { className: 'ck-ws-item' + (isCur ? ' current' : '') + (sub ? ' sub' : ''), title: s.sessionId, onClick: () => onNav(s.sessionId) },
    hasChildren ? createElement('span', { className: 'ck-ws-expand' + (open ? ' open' : ''), onClick: (e: any) => { e.stopPropagation(); onToggle(s.sessionId); } }, createElement(Svg, { d: IC.caret })) : createElement('span', { className: 'ck-ws-expand ck-ws-expand-hidden' }),
    createElement('span', { className: 'ck-ws-name' }, label),
    time ? createElement('span', { className: 'ck-ws-time' }, time) : null,
    createElement('span', { className: 'ck-ws-acts' },
      createElement('span', { className: 'ck-ws-act', title: '重命名', onClick: (e: any) => { e.stopPropagation(); onRename(s, label); } }, createElement(Svg, { d: IC.rename })),
      archived ? createElement('span', { className: 'ck-ws-act', title: '取消归档', onClick: (e: any) => { e.stopPropagation(); onUnarchive(s.sessionId); } }, createElement(Svg, { d: IC.unarchive }))
        : sub ? null : createElement('span', { className: 'ck-ws-act', title: '归档', onClick: (e: any) => { e.stopPropagation(); onArchive(s.sessionId); } }, createElement(Svg, { d: IC.archive })),
    ),
  );
}

/** 工作区页 */
export function WorkspacesPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [curSessionId, setCurSessionId] = useState<string | null>(null);
  const [curDir, setCurDir] = useState<string | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<string[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [archivedOpen, setArchivedOpen] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<{ dir: string; x: number; y: number } | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    if (!api.listAllSessions) { setSessions([]); return; }
    try {
      if (api.getProjectDir) { try { const pr = await api.getProjectDir(); if (pr && pr.success) setCurDir(pr.dir); } catch (_) {} }
      const r: any = await api.listAllSessions();
      setSessions((r && r.success && Array.isArray(r.sessions)) ? r.sessions : []);
      setCurSessionId((r && r.currentSessionId) || null);
      setArchivedProjects((r && Array.isArray(r.archivedProjects)) ? r.archivedProjects : []);
      setErr(false);
    } catch (_) { setErr(true); setSessions([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 目录/URL/会话变化 → 刷新
  useEffect(() => {
    if (api.onProjectDir) api.onProjectDir((d: string | null) => { setCurDir(d); load(); });
    if (api.onUrlUpdated) { let t: any = null; api.onUrlUpdated(() => { if (t) clearTimeout(t); t = setTimeout(() => load(), 600); }); }
    if (api.onSessionsChanged) api.onSessionsChanged(() => load());
  }, [load]);

  const onNav = useCallback(async (id: string) => { if (api.navigateSession) { try { await api.navigateSession(id); } catch (_) {} } }, []);
  const onRename = useCallback(async (s: Session, cur: string) => {
    if (!api.setSessionTitle) return;
    const name = await ckPrompt({ title: '重命名对话', placeholder: '输入对话名称', value: cur === s.sessionId ? '' : cur });
    if (!name) return;
    try { await api.setSessionTitle(s.sessionId, name); } catch (_) {}
    load();
  }, [load]);
  const onArchive = useCallback(async (id: string) => { if (api.setSessionArchived) { try { await api.setSessionArchived(id, true); } catch (_) {} load(); } }, [load]);
  const onUnarchive = useCallback(async (id: string) => { if (api.setSessionArchived) { try { await api.setSessionArchived(id, false); } catch (_) {} load(); } }, [load]);

  const toggle = (setFn: any, key: string) => setFn((s: Set<string>) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const showTip = useCallback(async (dir: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const sidebar = document.getElementById('ck-sidebar');
    const sbw = sidebar && sidebar.offsetWidth ? sidebar.offsetWidth : 320;
    let x = Math.min(rect.left, Math.max(6, sbw - 260));
    setTip({ dir, x, y: rect.bottom + 6 });
  }, []);

  if (sessions === null) return createElement('div', { className: 'ck-tab ck-tab-active' }, createElement('div', { className: 'ck-list-empty' }, '加载中…'));
  if (err) return createElement('div', { className: 'ck-tab ck-tab-active' }, createElement('div', { className: 'ck-list-empty' }, '加载失败'));

  const byId: Record<string, Session> = {}; for (const s of sessions) byId[s.sessionId] = s;
  const subsByParent: Record<string, Session[]> = {};
  for (const s of sessions) { if (s.kind === 'subagent' && s.parentId) { (subsByParent[s.parentId] = subsByParent[s.parentId] || []).push(s); } }
  const main = sessions.filter((s) => s.kind !== 'subagent' && !s.superseded);
  const groups: Record<string, { active: Session[]; archived: Session[] }> = {};
  for (const s of main) { const d = s.projectDir || ''; if (!groups[d]) groups[d] = { active: [], archived: [] }; if (s.archived) groups[d].archived.push(s); else groups[d].active.push(s); }

  const renderConv = (s: Session, archived: boolean): any => {
    const hist = collectHist(byId, s);
    const chainIds = [s.sessionId].concat(hist.map((x) => x.sessionId));
    const subs: Session[] = []; for (const cid of chainIds) { const arr = subsByParent[cid]; if (arr) for (const x of arr) subs.push(x); }
    const hasChildren = subs.length > 0 || hist.length > 0;
    const open = expandedNodes.has(s.sessionId);
    const out: any[] = [createElement(WsItem, { key: s.sessionId, s, cur: curSessionId, archived, hasChildren, open, onToggle: (id: string) => toggle(setExpandedNodes, id), onNav, onRename, onArchive, onUnarchive })];
    if (hasChildren && open) {
      const kids: any[] = [];
      if (subs.length) {
        const k = s.sessionId + ':sub'; const so = expandedSubs.has(k);
        kids.push(createElement('div', { key: k, className: 'ck-ws-subgroup-title' + (so ? ' open' : ''), onClick: () => toggle(setExpandedSubs, k) }, '子代理（' + subs.length + '）'));
        if (so) kids.push(...subs.map((x) => createElement(WsItem, { key: x.sessionId, s: x, cur: curSessionId, archived: false, hasChildren: false, sub: true, open: false, onToggle: () => {}, onNav, onRename, onArchive, onUnarchive })));
      }
      if (hist.length) {
        const k = s.sessionId + ':hist'; const ho = expandedSubs.has(k);
        kids.push(createElement('div', { key: k, className: 'ck-ws-subgroup-title' + (ho ? ' open' : ''), onClick: () => toggle(setExpandedSubs, k) }, '压缩历史（' + hist.length + '）'));
        if (ho) kids.push(...hist.map((x) => createElement(WsItem, { key: x.sessionId, s: x, cur: curSessionId, archived: false, hasChildren: false, sub: true, open: false, onToggle: () => {}, onNav, onRename, onArchive, onUnarchive })));
      }
      out.push(createElement('div', { key: s.sessionId + ':kids', className: 'ck-ws-children' }, kids));
    }
    return out;
  };

  const dirs = Object.keys(groups).sort((a, b) => latestTs(groups[a].active.concat(groups[a].archived)) - latestTs(groups[b].active.concat(groups[b].archived)) === 0 ? 0 : latestTs(groups[b].active.concat(groups[b].archived)) - latestTs(groups[a].active.concat(groups[a].archived)));

  const renderGroup = (dir: string): any => {
    const g = groups[dir];
    g.active.sort(byTimeDesc); g.archived.sort(byTimeDesc);
    const isOpen = dir === curDir || expandedDirs.has(dir);
    const isArchOpen = archivedOpen.has(dir);
    return createElement('div', { key: dir, className: 'ck-ws-group' + (isOpen ? ' open' : ''), 'data-dir': dir },
      createElement('div', { className: 'ck-ws-group-title', title: dir || '未指定工作区', onClick: () => toggle(setExpandedDirs, dir), onMouseEnter: (e: any) => { if (dir) showTip(dir, e.currentTarget); }, onMouseLeave: () => setTip(null) },
        createElement(Svg, { d: IC.caret, cls: 'ck-ws-caret' }),
        createElement(Svg, { d: IC.folder, cls: 'ck-ws-folder' }),
        createElement('span', { className: 'ck-ws-gname' }, baseName(dir)),
        // [022] 空目录（未指定工作区）不渲染操作按钮——不是真实目录，新建/归档无意义
        dir ? createElement('span', { className: 'ck-ws-gacts' },
          createElement('span', { className: 'ck-ws-gact', title: '用该项目新建对话', onClick: async (e: any) => { e.stopPropagation(); if (api.newConversationForProject) { try { await api.newConversationForProject(dir); } catch (_) {} } } }, createElement(Svg, { d: IC.plus })),
          archivedProjects.includes(dir)
            ? createElement('span', { className: 'ck-ws-gact', title: '取消归档', onClick: async (e: any) => { e.stopPropagation(); if (api.setProjectArchived) { try { await api.setProjectArchived(dir, false); } catch (_) {} load(); } } }, createElement(Svg, { d: IC.unarchiveProj }))
            : createElement('span', { className: 'ck-ws-gact', title: '归档项目', onClick: async (e: any) => { e.stopPropagation(); if (api.setProjectArchived) { try { await api.setProjectArchived(dir, true); } catch (_) {} load(); } } }, createElement(Svg, { d: IC.archiveProj })),
        ) : null,
      ),
      createElement('div', { className: 'ck-ws-items' },
        ...g.active.flatMap((s) => renderConv(s, false)),
        g.archived.length ? createElement('div', { key: 'arch', className: 'ck-ws-archived' + (isArchOpen ? ' open' : ''), 'data-dir': dir },
          createElement('div', { className: 'ck-ws-archived-title', onClick: () => toggle(setArchivedOpen, dir) }, '已归档 ' + g.archived.length + ' 对话'),
          createElement('div', { className: 'ck-ws-archived-items' }, ...g.archived.flatMap((s) => renderConv(s, true))),
        ) : null,
      ),
    );
  };

  const activeDirs = dirs.filter((d) => !archivedProjects.includes(d));
  const archivedDirs = dirs.filter((d) => archivedProjects.includes(d));

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, '工作区'),
      createElement('button', { className: 'ck-icon-btn', title: '刷新', onClick: load }, createElement(Svg, { d: IC.refresh })),
    ),
    createElement('div', { className: 'ck-list' },
      sessions.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '暂无会话')
        : createElement('div', { style: { display: 'contents' } },
            ...activeDirs.map(renderGroup),
            archivedDirs.length ? createElement('div', { key: 'archivedProjects', className: 'ck-ws-archived-projects' + (expandedProjects ? ' open' : '') },
              createElement('div', { className: 'ck-ws-archived-projects-title', onClick: () => setExpandedProjects(!expandedProjects) }, '已归档 ' + archivedDirs.length + ' 项目'),
              createElement('div', { className: 'ck-ws-archived-projects-items' }, ...archivedDirs.map(renderGroup)),
            ) : null,
          ),
    ),
    tip ? createElement('div', { className: 'ck-ws-tip', style: { display: 'block', position: 'fixed', top: tip.y, left: tip.x, zIndex: 10000 } },
      createElement('div', { className: 'ck-tip-name' }, baseName(tip.dir)),
      createElement('div', { className: 'ck-tip-path' }, tip.dir),
      createElement('div', { className: 'ck-tip-time' }, ''),
    ) : null,
  );
}

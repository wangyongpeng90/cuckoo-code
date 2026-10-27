/**
 * 窗口列表页（React 版）
 *
 * 迁移自 pages/windows.ts：
 * - 窗口列表（分组 + 未分组）
 * - 新建窗口 / 新建窗口组 / 刷新
 * - 窗口卡片（打开/删除/默认打开）
 * - 组操作（转移/管理/删除）+ 组管理弹窗
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api, ckConfirm, ckPrompt } from '../shared.js';
import { useHideAiView } from '../use-hide-ai-view.js';

interface Profile { id: string; name: string; providerId?: string; autoOpen?: boolean; }
interface Group { id: string; name: string; windowIds?: string[]; lastWindowId?: string; lastSessionId?: string; }

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: 'linear-gradient(135deg, #4d6bfe, #3b5bdb)',
  claude: 'linear-gradient(135deg, #d97757, #c05a3a)',
  chatgpt: 'linear-gradient(135deg, #10a37f, #0d8a6b)',
};

const I = {
  plus: 'M12 5v14M5 12h14',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
};
function Svg({ d, cls }: { d: string; cls?: string }) {
  return createElement('svg', { className: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d }));
}

/** 窗口卡片 */
function WinItem({ p, providerMap, onOpen, onDelete, onToggleAuto }: { p: Profile; providerMap: Record<string, string>; onOpen: () => void; onDelete: () => void; onToggleAuto: (v: boolean) => void }) {
  const pname = providerMap[p.providerId || ''] || '未选平台';
  const initial = (p.name || '?').trim().charAt(0).toUpperCase();
  const avatarStyle = PROVIDER_COLORS[p.providerId || ''] || '';
  const auto = p.autoOpen === true;
  return createElement('div', { className: 'ck-win-item', onClick: onOpen },
    createElement('div', { className: 'ck-win-top' },
      createElement('span', { className: 'ck-win-avatar', style: avatarStyle ? { background: avatarStyle } : undefined }, initial),
      createElement('span', { className: 'ck-win-name' }, p.name),
      createElement('span', { className: 'ck-win-del', title: '删除窗口', onClick: (e: any) => { e.stopPropagation(); onDelete(); } }, '✕'),
    ),
    createElement('div', { className: 'ck-win-bottom' },
      createElement('span', { className: 'ck-win-provider' }, pname),
      createElement('label', { className: 'ck-win-check' + (auto ? ' ck-win-check-on' : ''), title: '启动时默认打开', onClick: (e: any) => e.stopPropagation() },
        createElement('input', { type: 'checkbox', checked: auto, onClick: (e: any) => e.stopPropagation(), onChange: (e: any) => onToggleAuto(e.target.checked) }),
        '默认打开',
      ),
    ),
  );
}

/** 组管理弹窗 */
function GroupModal({ group, profiles, onClose, onSaved }: { group: Group; profiles: Profile[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group.name || '');
  const [members, setMembers] = useState<string[]>((group.windowIds || []).slice());
  useHideAiView();
  const byId: Record<string, Profile> = {}; for (const p of profiles) byId[p.id] = p;
  const avail = profiles.filter((p) => !members.includes(p.id));

  const save = useCallback(async () => {
    const anyApi = api as any;
    try {
      const newName = name.trim();
      if (newName && newName !== group.name) await anyApi.wgRename?.(group.id, newName);
      const cur = (group.windowIds || []).slice();
      for (const id of cur) { if (!members.includes(id)) await anyApi.wgRemoveWindow?.(group.id, id); }
      for (const id of members) { if (!cur.includes(id)) await anyApi.wgAddWindow?.(group.id, id); }
      onSaved(); onClose();
    } catch (_) { onClose(); }
  }, [name, members, group, onClose, onSaved]);

  return createElement('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: (e: any) => { if (e.target === e.currentTarget) onClose(); } },
    createElement('div', { style: { background: '#fff', borderRadius: 10, padding: 20, width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)' } },
      createElement('h3', { style: { margin: '0 0 14px' } }, '管理窗口组'),
      createElement('div', { style: { marginBottom: 10 } },
        createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, '组名'),
        createElement('input', { value: name, onChange: (e: any) => setName(e.target.value), autoFocus: true, style: { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box' } }),
      ),
      createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, '组内窗口'),
      createElement('div', { style: { marginBottom: 8 } },
        members.length === 0 ? createElement('div', { style: { color: '#999', fontSize: 12, padding: 4 } }, '（暂无窗口）')
          : members.map((id) => createElement('div', { key: id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', border: '1px solid #eee', borderRadius: 6, marginBottom: 4 } },
              createElement('span', null, byId[id] ? byId[id].name : id),
              createElement('span', { style: { color: '#e55', cursor: 'pointer' }, onClick: () => setMembers(members.filter((x) => x !== id)) }, '✕'),
            )),
      ),
      createElement('select', { onChange: (e: any) => { const id = e.target.value; if (id && !members.includes(id)) { setMembers([...members, id]); e.target.value = ''; } }, style: { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box', marginBottom: 16 } },
        createElement('option', { value: '' }, '（选择要加入的窗口…）'),
        ...avail.map((p) => createElement('option', { key: p.id, value: p.id }, p.name)),
      ),
      createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        createElement('button', { onClick: onClose, style: { padding: '6px 14px', border: '1px solid #ddd', background: '#fff', borderRadius: 6, cursor: 'pointer' } }, '取消'),
        createElement('button', { onClick: save, style: { padding: '6px 14px', border: 'none', background: '#4d6bfe', color: '#fff', borderRadius: 6, cursor: 'pointer' } }, '保存'),
      ),
    ),
  );
}

/** 窗口页 */
export function WindowsPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [providerMap, setProviderMap] = useState<Record<string, string>>({});
  const [err, setErr] = useState(false);
  const [managing, setManaging] = useState<Group | null>(null);

  const load = useCallback(async () => {
    if (!api.listProfiles) { setProfiles([]); return; }
    try {
      const res = await api.listProfiles();
      setProfiles((res && res.success ? res.profiles : []) || []);
      setErr(false);
      const anyApi = api as any;
      try { const pvRes = await anyApi.listProviders?.(); if (pvRes && pvRes.success) { const m: Record<string, string> = {}; for (const p of (pvRes.providers || [])) m[p.id] = p.name; setProviderMap(m); } } catch (_) {}
      try { const gr = await anyApi.wgList?.(); setGroups(gr && gr.success ? (gr.groups || []) : []); } catch (_) { setGroups([]); }
    } catch (_) { setErr(true); setProfiles([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id: string) => { try { await api.openProfileWindow?.(id); } catch (_) {} }, []);
  const del = useCallback(async (p: Profile) => {
    if (!(await ckConfirm('确定删除窗口「' + p.name + '」？此操作不可恢复。'))) return;
    try { const r = await api.deleteProfileWindow?.(p.id); if (r && r.success) load(); } catch (_) {}
  }, [load]);
  const toggleAuto = useCallback(async (p: Profile, v: boolean) => {
    try { const r = await api.setProfileAutoOpen?.(p.id, v); if (!r || !r.success) return; setProfiles((ps) => (ps || []).map((x) => x.id === p.id ? { ...x, autoOpen: v } : x)); } catch (_) {}
  }, []);

  const newWin = useCallback(async () => { try { await api.createProfileWindow?.(); load(); } catch (_) {} }, [load]);
  const newGroup = useCallback(async () => {
    const name = await ckPrompt({ title: '新建窗口组', placeholder: '组名（如：主力账号组）', value: '' });
    if (name === null) return;
    try { await (api as any).wgCreate?.(name.trim() || undefined); load(); } catch (_) {}
  }, [load]);

  const wgSwitch = useCallback(async (g: Group) => {
    const anyApi = api as any;
    if (!anyApi.wgSwitch) return;
    try { const r = await anyApi.wgSwitch(g.id); if (!r || !r.success) alert('切换失败：' + ((r && r.error) || '未知错误')); } catch (e: any) { alert('切换失败：' + (e.message || e)); }
    load();
  }, [load]);
  const wgDel = useCallback(async (g: Group) => {
    if (!(await ckConfirm('确定删除该窗口组？（窗口本身不删）'))) return;
    try { await (api as any).wgDelete?.(g.id); load(); } catch (_) {}
  }, [load]);
  const wgLast = useCallback(async (g: Group) => {
    if (!g.lastWindowId) return;
    try { await api.openProfileWindow?.(g.lastWindowId); if (g.lastSessionId && (api as any).navigateSession) { try { await (api as any).navigateSession(g.lastSessionId); } catch (_) {} } } catch (_) {}
  }, []);

  const list = profiles || [];
  const byId: Record<string, Profile> = {}; for (const p of list) byId[p.id] = p;
  const inGroup = new Set<string>(); for (const g of groups) for (const w of (g.windowIds || [])) inGroup.add(w);
  const ungrouped = list.filter((p) => !inGroup.has(p.id));

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('button', { className: 'ck-btn ck-btn-anim', onClick: newWin }, createElement(Svg, { d: I.plus, cls: 'ck-btn-icon' }), createElement('span', null, '新建窗口')),
      createElement('button', { className: 'ck-icon-btn', title: '刷新列表', onClick: load }, createElement(Svg, { d: I.refresh })),
    ),
    createElement('div', { className: 'ck-actions' },
      createElement('button', { className: 'ck-btn ck-btn-anim', onClick: newGroup }, createElement(Svg, { d: I.grid, cls: 'ck-btn-icon' }), createElement('span', null, '新建窗口组')),
    ),
    createElement('div', { className: 'ck-list' },
      profiles === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : err ? createElement('div', { className: 'ck-list-empty' }, '加载失败')
        : list.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '暂无窗口')
        : [
            ...groups.map((g) => {
              const members = (g.windowIds || []).map((w) => byId[w]).filter(Boolean);
              return createElement('div', { key: g.id, className: 'ck-wg' },
                createElement('div', { className: 'ck-wg-head' },
                  createElement('span', { className: 'ck-wg-name' }, g.name),
                  createElement('span', { className: 'ck-wg-switch', title: '转移当前对话到下一窗口', onClick: () => wgSwitch(g) }, '转移对话'),
                  createElement('span', { className: 'ck-wg-manage', title: '管理组（改名、增删窗口）', onClick: () => setManaging(g) }, '管理'),
                  createElement('span', { className: 'ck-wg-del', title: '删除组', onClick: () => wgDel(g) }, '✕'),
                ),
                g.lastWindowId ? createElement('div', { className: 'ck-wg-last', title: '点击跳到该窗口的最近对话', onClick: () => wgLast(g) }, '最近：' + (byId[g.lastWindowId] ? byId[g.lastWindowId].name : g.lastWindowId)) : null,
                createElement('div', { className: 'ck-wg-body' }, members.map((p) => createElement(WinItem, { key: p.id, p, providerMap, onOpen: () => open(p.id), onDelete: () => del(p), onToggleAuto: (v) => toggleAuto(p, v) }))),
              );
            }),
            ungrouped.length ? createElement('div', { key: 'ungrouped', className: 'ck-wg ck-wg-ungrouped' },
              createElement('div', { className: 'ck-wg-head' }, createElement('span', { className: 'ck-wg-name' }, '未分组')),
              createElement('div', { className: 'ck-wg-body' }, ungrouped.map((p) => createElement(WinItem, { key: p.id, p, providerMap, onOpen: () => open(p.id), onDelete: () => del(p), onToggleAuto: (v) => toggleAuto(p, v) }))),
            ) : null,
          ],
    ),
    managing ? createElement(GroupModal, { group: managing, profiles: list, onClose: () => setManaging(null), onSaved: load }) : null,
  );
}

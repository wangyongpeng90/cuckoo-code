/**
 * 子代理页（React 版）
 *
 * 迁移自 pages/agents.ts：
 * - 列表（用户级 / 项目级分组）
 * - 点击 → 追加"请使用 xxx 子代理"
 * - 编辑（改名）/ 删除
 * - 新建 / 编辑弹窗
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api, ckAlert, ckConfirm } from '../shared.js';
import { addRecent } from '../recent.js';
import { useHideAiView } from '../use-hide-ai-view.js';

interface Agent { name: string; description?: string; source?: string; agentPath: string; }

const I = {
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  del: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  plus: 'M12 5v14M5 12h14',
};
function Svg({ d }: { d: string }) {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d }));
}

/** 新建/编辑弹窗 */
function AgentModal({ editing, onClose, onSaved }: { editing: Agent | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(editing ? editing.name : '');
  const [scope, setScope] = useState('project');
  const isEdit = !!editing;
  useHideAiView();

  const submit = useCallback(async () => {
    if (!name.trim()) { await ckAlert('请填写名称'); return; }
    try {
      if (isEdit) {
        if (!api.renameAgent) return;
        const rr = await api.renameAgent(editing!.agentPath, name.trim());
        if (rr && rr.success) { onSaved(); onClose(); }
        else await ckAlert((rr && rr.error) || '保存失败');
      } else {
        if (!api.createAgentFile) return;
        const r = await api.createAgentFile(name.trim(), scope);
        if (r && r.success) {
          onClose();
          await ckAlert('已创建：' + r.name + '.md\n（已用系统默认程序打开，编辑保存后点「刷新」即可看到）');
          onSaved();
        } else await ckAlert((r && r.error) || '创建失败');
      }
    } catch (e: any) { await ckAlert('操作失败: ' + (e.message || e)); }
  }, [name, scope, isEdit, editing, onClose, onSaved]);

  const openFile = useCallback(async () => {
    if (!editing || !api.openAgentFile) return;
    try { const r = await api.openAgentFile(editing.agentPath); if (r && !r.success) await ckAlert((r && r.error) || '打开失败'); } catch (e: any) { await ckAlert('打开失败: ' + (e.message || e)); }
  }, [editing]);

  return createElement('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: (e: any) => { if (e.target === e.currentTarget) onClose(); } },
    createElement('div', { style: { background: '#fff', borderRadius: 10, padding: 20, width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)' } },
      createElement('h3', { style: { margin: '0 0 14px' } }, isEdit ? '编辑子代理' : '新建子代理'),
      createElement('div', { style: { marginBottom: 10 } },
        createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, '名称'),
        createElement('input', { value: name, onChange: (e: any) => setName(e.target.value), autoFocus: true, style: { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box' } }),
      ),
      !isEdit ? createElement('div', { style: { marginBottom: 10 } },
        createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, '范围'),
        createElement('select', { value: scope, onChange: (e: any) => setScope(e.target.value), style: { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box' } },
          createElement('option', { value: 'project' }, '项目级'),
          createElement('option', { value: 'user' }, '用户级'),
        ),
      ) : null,
      createElement('p', { style: { fontSize: 12, color: '#888' } }, isEdit ? '改名会重命名文件；「打开正文」用系统程序编辑提示词。' : '生成模板后，会用系统默认程序打开，你直接编辑保存即可。'),
      createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 } },
        isEdit ? createElement('button', { onClick: openFile, style: { padding: '6px 14px', border: '1px solid #ddd', background: '#fff', borderRadius: 6, cursor: 'pointer' } }, '打开正文') : null,
        createElement('button', { onClick: onClose, style: { padding: '6px 14px', border: '1px solid #ddd', background: '#fff', borderRadius: 6, cursor: 'pointer' } }, '取消'),
        createElement('button', { onClick: submit, style: { padding: '6px 14px', border: 'none', background: '#4d6bfe', color: '#fff', borderRadius: 6, cursor: 'pointer' } }, isEdit ? '保存名称' : '创建并打开'),
      ),
    ),
  );
}

/** 子代理页 */
export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [modal, setModal] = useState<{ open: boolean; editing: Agent | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    if (!api.listAgents) { setAgents([]); return; }
    try {
      const r = await api.listAgents();
      setAgents((r && r.success ? r.agents : []) || []);
    } catch (_) { setAgents([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const click = useCallback(async (a: Agent) => {
    if (api.appendSnippet) { try { await api.appendSnippet('请使用 ' + a.name + ' 子代理'); } catch (_) {} }
    addRecent('agent', a.name);
  }, []);

  const del = useCallback(async (a: Agent) => {
    if (!(await ckConfirm('确定删除该子代理文件？此操作不可恢复。'))) return;
    const anyApi = api as any;
    if (!anyApi.deleteAgentFile) return;
    try {
      const r = await anyApi.deleteAgentFile(a.agentPath);
      if (r && r.success) load(); else await ckAlert((r && r.error) || '删除失败');
    } catch (e: any) { await ckAlert('删除失败: ' + (e.message || e)); }
  }, [load]);

  const list = agents || [];
  const userAgents = list.filter((a) => a.source !== 'project');
  const projAgents = list.filter((a) => a.source === 'project');

  const card = (a: Agent) => createElement('div', { key: a.agentPath, className: 'ck-skill-item ck-agent-item', onClick: () => click(a) },
    createElement('div', { className: 'ck-skill-top' },
      createElement('span', { className: 'ck-skill-name' }, a.name),
      createElement('div', { className: 'ck-agent-actions' },
        createElement('button', { className: 'ck-snip-icon-btn', title: '编辑', onClick: (e: any) => { e.stopPropagation(); setModal({ open: true, editing: a }); } }, createElement(Svg, { d: I.edit })),
        createElement('button', { className: 'ck-snip-icon-btn danger', title: '删除', onClick: (e: any) => { e.stopPropagation(); del(a); } }, createElement(Svg, { d: I.del })),
      ),
    ),
    createElement('div', { className: 'ck-skill-desc' }, a.description || '（无描述）'),
  );

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('button', { className: 'ck-icon-btn', title: '新建', onClick: () => setModal({ open: true, editing: null }) }, createElement(Svg, { d: I.plus })),
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, '子代理'),
      createElement('button', { className: 'ck-icon-btn', title: '刷新', onClick: load }, createElement(Svg, { d: I.refresh })),
    ),
    createElement('div', { className: 'ck-list' },
      agents === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : list.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '未发现子代理', createElement('br'), '（.cuckoo/agents/ 或 ~/.cuckoo/agents/）')
        : [
            userAgents.length ? createElement('div', { key: 'u', className: 'ck-mcp-group-title' }, '用户级') : null,
            ...userAgents.map(card),
            projAgents.length ? createElement('div', { key: 'p', className: 'ck-mcp-group-title' }, '项目级') : null,
            ...projAgents.map(card),
          ],
    ),
    modal.open ? createElement(AgentModal, { editing: modal.editing, onClose: () => setModal({ open: false, editing: null }), onSaved: load }) : null,
  );
}

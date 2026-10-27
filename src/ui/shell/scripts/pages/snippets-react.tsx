/**
 * 提示词（Snippets）页（React 版）
 *
 * 迁移自 pages/snippets.ts：
 * - 列表 + 新建/编辑/删除（弹窗用 React 状态管理）
 * - 点击条目 → 触发提示词
 * - 重新项目初始化 / 新建 / 刷新
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api, ckAlert, ckConfirm } from '../shared.js';
import { addRecent } from '../recent.js';
import { useHideAiView } from '../use-hide-ai-view.js';

interface Snippet { id: string; name: string; content: string; autoSend?: boolean; }

/** 图标 */
const I = {
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  del: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  init: 'M21 12a9 9 0 1 1-3-6.7M21 3v5h-5',
};
function Svg({ d }: { d: string }) {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d }));
}

/** 新建/编辑弹窗 */
function SnipModal({ initial, onSave, onCancel }: { initial: Snippet | null; onSave: (s: { name: string; content: string; autoSend: boolean }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial ? initial.name : '');
  const [content, setContent] = useState(initial ? initial.content : '');
  const [autoSend, setAutoSend] = useState(initial ? initial.autoSend !== false : true);
  useHideAiView();
  return createElement('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: (e: any) => { if (e.target === e.currentTarget) onCancel(); } },
    createElement('div', { style: { background: '#fff', borderRadius: 10, padding: 20, width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)' } },
      createElement('h3', { style: { margin: '0 0 14px' } }, initial ? '编辑提示词' : '新建提示词'),
      createElement('div', { style: { marginBottom: 10 } },
        createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, '名称'),
        createElement('input', { value: name, onChange: (e: any) => setName(e.target.value), style: { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box' }, autoFocus: true }),
      ),
      createElement('div', { style: { marginBottom: 10 } },
        createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, '内容'),
        createElement('textarea', { value: content, onChange: (e: any) => setContent(e.target.value), rows: 5, style: { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box', resize: 'vertical' } }),
      ),
      createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16 } },
        createElement('input', { type: 'checkbox', checked: autoSend, onChange: (e: any) => setAutoSend(e.target.checked) }),
        '自动发送',
      ),
      createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        createElement('button', { onClick: onCancel, style: { padding: '6px 16px', border: '1px solid #ddd', background: '#fff', borderRadius: 6, cursor: 'pointer' } }, '取消'),
        createElement('button', { onClick: () => onSave({ name: name.trim(), content, autoSend }), style: { padding: '6px 16px', border: 'none', background: '#4d6bfe', color: '#fff', borderRadius: 6, cursor: 'pointer' } }, '保存'),
      ),
    ),
  );
}

/** 提示词页 */
export function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [modal, setModal] = useState<{ open: boolean; editing: Snippet | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    if (!api.listSnippets) { setSnippets([]); return; }
    try {
      const res = await api.listSnippets();
      setSnippets((res && res.success && Array.isArray(res.snippets) ? res.snippets : []) || []);
    } catch (_) { setSnippets([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (data: { name: string; content: string; autoSend: boolean }) => {
    if (!data.name) { await ckAlert('请填写名称'); return; }
    if (!data.content.trim()) { await ckAlert('请填写内容'); return; }
    const list = snippets || [];
    let next: Snippet[];
    if (modal.editing) {
      next = list.map((x) => x.id === modal.editing!.id ? { id: x.id, ...data } : x);
    } else {
      next = [...list, { id: 'snip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), ...data }];
    }
    setSnippets(next);
    setModal({ open: false, editing: null });
    if (api.saveSnippets) { try { await api.saveSnippets(next as any); } catch (_) { /* ignore */ } }
  }, [snippets, modal.editing]);

  const del = useCallback(async (s: Snippet) => {
    if (!(await ckConfirm('确定删除提示词「' + s.name + '」？'))) return;
    const next = (snippets || []).filter((x) => x.id !== s.id);
    setSnippets(next);
    if (api.saveSnippets) { try { await api.saveSnippets(next as any); } catch (_) { /* ignore */ } }
  }, [snippets]);

  const trigger = useCallback(async (s: Snippet) => {
    if (!api.triggerSnippet) return;
    try { await api.triggerSnippet(s.content, s.autoSend); } catch (_) { /* ignore */ }
    addRecent('snippet', s.name, { payload: s.content, autoSend: s.autoSend });
  }, []);

  const initProject = useCallback(async () => {
    if (!api.initProject) return;
    try { await api.initProject(); } catch (_) { /* ignore */ }
  }, []);

  const list = snippets || [];

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('button', { className: 'ck-btn ck-btn-anim', onClick: initProject },
        createElement('svg', { className: 'ck-btn-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d: I.init })),
        createElement('span', null, '重新项目初始化'),
      ),
    ),
    createElement('div', { className: 'ck-divider' }),
    createElement('div', { className: 'ck-actions' },
      createElement('button', { className: 'ck-btn ck-btn-anim', onClick: () => setModal({ open: true, editing: null }) },
        createElement('svg', { className: 'ck-btn-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d: I.plus })),
        createElement('span', null, '新建快捷提示词'),
      ),
      createElement('button', { className: 'ck-icon-btn', title: '刷新', onClick: load }, createElement(Svg, { d: I.refresh })),
    ),
    createElement('div', { className: 'ck-list' },
      snippets === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : list.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '还没有提示词，点上方新建')
        : list.map((s) => createElement('div', { key: s.id, className: 'ck-snip-item', onClick: () => trigger(s) },
            createElement('div', { className: 'ck-snip-top' },
              createElement('span', { className: 'ck-snip-name' }, s.name, s.autoSend ? createElement('span', { className: 'ck-snip-badge' }, '自动发送') : null),
              createElement('div', { className: 'ck-snip-actions' },
                createElement('button', { className: 'ck-snip-icon-btn', title: '编辑', onClick: (e: any) => { e.stopPropagation(); setModal({ open: true, editing: s }); } }, createElement(Svg, { d: I.edit })),
                createElement('button', { className: 'ck-snip-icon-btn danger', title: '删除', onClick: (e: any) => { e.stopPropagation(); del(s); } }, createElement(Svg, { d: I.del })),
              ),
            ),
            createElement('span', { className: 'ck-snip-preview' }, s.content),
          )),
    ),
    modal.open ? createElement(SnipModal, { initial: modal.editing, onSave: save, onCancel: () => setModal({ open: false, editing: null }) }) : null,
  );
}

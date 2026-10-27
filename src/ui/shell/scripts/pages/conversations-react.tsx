/**
 * 对话页（React 版）
 *
 * 迁移自 pages/conversations.ts：
 * - 读网页端会话列表（DOM 读取，实时同步）
 * - 切换 / 新建 / 刷新
 * - harness 生成中禁用切换
 */
import { createElement, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../shared.js';

interface ConvSession { href: string; title: string; }

function RefreshIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
    createElement('path', { d: 'M21 3v6h-6' }),
  );
}
function PlusIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    createElement('path', { d: 'M12 5v14M5 12h14' }),
  );
}

/** 对话页 */
export function ConversationsPage() {
  const [sessions, setSessions] = useState<ConvSession[]>([]);
  const [curUrl, setCurUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async (retainOnEmpty?: boolean) => {
    const anyApi = api as any;
    if (!anyApi.listWebSessions) return;
    let res: any = null;
    try { res = await anyApi.listWebSessions(); } catch (_) { res = null; }
    const list: ConvSession[] = (res && res.success && Array.isArray(res.sessions)) ? res.sessions : [];
    const url: string = (res && res.currentUrl) || '';
    if (!list.length) {
      if (retainOnEmpty) return;
      if (loadedRef.current) return; // 已有内容也不清
      return;
    }
    setSessions(list);
    setCurUrl(url);
    loadedRef.current = true;
  }, []);

  useEffect(() => { load(); }, [load]);

  // harness 生成中 → 禁用切换
  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.onHarnessBusy) anyApi.onHarnessBusy((b: boolean) => setBusy(b));
  }, []);

  // 网页导航变化 → 刷新列表
  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.onWebUrlChanged) anyApi.onWebUrlChanged(() => {
      load(true);
      setTimeout(() => load(true), 800);
      setTimeout(() => load(true), 1800);
      setTimeout(() => load(false), 3200);
    });
  }, [load]);

  const onItemClick = useCallback((s: ConvSession) => {
    if (busy) return;
    const anyApi = api as any;
    if (s.href && anyApi.navigateWebSession) {
      anyApi.navigateWebSession(s.href);
      setCurUrl(s.href);
    }
  }, [busy]);

  const onNew = useCallback(async () => {
    const anyApi = api as any;
    if (anyApi.newWebConversation) {
      await anyApi.newWebConversation();
      load(true);
      setTimeout(() => load(true), 800);
      setTimeout(() => load(false), 1800);
    }
  }, [load]);

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('button', { className: 'ck-icon-btn', title: '新对话', onClick: onNew }, createElement(PlusIcon)),
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, '对话'),
      createElement('button', { className: 'ck-icon-btn', title: '刷新', onClick: () => load() }, createElement(RefreshIcon)),
    ),
    createElement('div', { className: 'ck-list' },
      sessions.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '加载中…（若持续为空，请点刷新）')
        : sessions.map((s) => createElement('div', {
            key: s.href,
            className: 'ck-conv-item' + (s.href === curUrl ? ' ck-conv-active' : '') + (busy ? ' ck-conv-disabled' : ''),
            title: s.title,
            onClick: () => onItemClick(s),
          }, createElement('span', { className: 'ck-conv-title' }, s.title))),
    ),
  );
}

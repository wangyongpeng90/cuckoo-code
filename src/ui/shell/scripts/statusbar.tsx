/**
 * 底部状态栏（React 版，feat/shell-react）
 *
 * 迁移自 token.ts（sb-context / sb-tps）+ recent.ts（sb-recent）：
 * - 最近使用（技能/MCP/子代理/提示词）
 * - 对话上下文 token
 * - 输出速度（t/s）
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './shared.js';
import { loadRecent, onRecentChanged, type RecentItem, type RecentType } from './recent.js';

function formatTokenCount(n: number): string {
  if (!isFinite(n) || n < 0) return '0';
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(2) + '万';
  return String(Math.round(n));
}
function typeLabel(type: RecentType): string {
  if (type === 'skill') return '技能';
  if (type === 'mcp') return 'MCP';
  if (type === 'agent') return '子代理';
  return '提示词';
}
function snippetText(type: RecentType, name: string): string {
  if (type === 'skill') return '请使用 ' + name + ' 技能';
  if (type === 'mcp') return '请使用 ' + name + ' 这个 MCP';
  if (type === 'agent') return '请使用 ' + name + ' 子代理';
  return name;
}

/** 最近使用 chip */
function RecentChip({ it }: { it: RecentItem }) {
  const tip = typeLabel(it.type) + '：' + it.name + '（点击追加到输入框）';
  const onClick = useCallback(async () => {
    if (it.type === 'snippet') {
      if (it.payload && api.triggerSnippet) { try { await api.triggerSnippet(it.payload, it.autoSend !== false); } catch (_) {} }
    } else {
      if (api.appendSnippet) { try { await api.appendSnippet(snippetText(it.type, it.name)); } catch (_) {} }
    }
  }, [it]);
  return createElement('span', { className: 'sb-chip sb-chip-' + it.type, title: tip, onClick }, it.name);
}

/** 状态栏 */
function StatusBar() {
  const [context, setContext] = useState(0);
  const [tps, setTps] = useState('');
  const [recent, setRecent] = useState<RecentItem[]>(() => loadRecent());

  // 订阅 token / tps + 挂载时拉取最近一次（避免错过切页前的推送）
  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.onTokenUpdated) anyApi.onTokenUpdated((d: any) => { if (d && typeof d.context === 'number') setContext(d.context); });
    if (anyApi.onTpsUpdated) anyApi.onTpsUpdated((d: any) => { setTps(d && d.tps ? String(d.tps) : ''); });
    if (anyApi.getTokenUsage) {
      anyApi.getTokenUsage().then((r: any) => {
        if (!r || !r.success) return;
        if (r.data && typeof r.data.context === 'number') setContext(r.data.context);
        if (typeof r.tps === 'string') setTps(r.tps);
      }).catch(() => {});
    }
  }, []);

  // 订阅最近使用变更
  useEffect(() => onRecentChanged(() => setRecent(loadRecent())), []);

  return createElement('div', { className: 'statusbar' },
    createElement('div', { className: 'sb-recent' },
      recent.length > 0 ? createElement('span', { className: 'sb-recent-label' }, '最近') : null,
      ...recent.map((it, i) => createElement(RecentChip, { key: it.type + ':' + it.name + ':' + i, it })),
    ),
    createElement('div', { className: 'sb-spacer' }),
    createElement('div', { className: 'sb-item', title: '对话上下文：本会话当前占用的 token 总量' },
      createElement('span', { className: 'sb-label' }, '对话上下文:'),
      createElement('span', { className: 'sb-value' }, formatTokenCount(context)),
    ),
    createElement('div', { className: 'sb-item', title: '模型输出速度：tokens/秒（生成中实时更新，结束后保留最终值）' },
      createElement('span', { className: 'sb-label' }, '输出速度:'),
      createElement('span', { className: 'sb-value' }, tps || '--'),
      createElement('span', { className: 'sb-label' }, 't/s'),
    ),
  );
}

/** 挂载（幂等）：React 接管底部状态栏，旧的原生结构隐藏 */
export function mountStatusBar(): void {
  const old = document.querySelector('.statusbar');
  if (!old) return;
  let host = document.getElementById('ck-statusbar-react');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ck-statusbar-react';
    host.style.cssText = 'display:contents;';
    // 插在旧状态栏之前
    old.parentElement?.insertBefore(host, old);
    // 隐藏旧状态栏
    (old as HTMLElement).style.display = 'none';
  }
  if ((host as any).__root) return;
  const root = createRoot(host);
  (host as any).__root = root;
  root.render(createElement(StatusBar));
}

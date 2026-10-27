/**
 * MCP（连接器）页（React 版）
 *
 * 迁移自 pages/mcp.ts：
 * - 列出 server（用户级 / 项目级分组），显示连接状态 + 工具数
 * - 点击 → 追加"请使用 xxx 这个 MCP"
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api } from '../shared.js';
import { addRecent } from '../recent.js';

interface McpServer { name: string; connected?: boolean; type?: string; toolCount?: number; source?: string; }

/** 刷新按钮图标 */
function RefreshIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
    createElement('path', { d: 'M21 3v6h-6' }),
  );
}

/** MCP 条目 */
function McpItem({ s, onClick }: { s: McpServer; onClick: () => void }) {
  return createElement('div', { className: 'ck-mcp-item', onClick },
    createElement('div', { className: 'ck-mcp-top' },
      createElement('span', { className: 'ck-mcp-dot' + (s.connected ? ' on' : '') }),
      createElement('span', { className: 'ck-mcp-name' }, s.name),
    ),
    createElement('div', { className: 'ck-mcp-bottom' },
      createElement('span', { className: 'ck-mcp-tag' }, s.type || 'stdio'),
      createElement('span', { className: 'ck-mcp-tag' }, (s.toolCount || 0) + ' 工具'),
    ),
  );
}

/** MCP 页 */
export function McpPage() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    const anyApi = api as any;
    if (!anyApi.listMcpServers) { setServers([]); return; }
    try {
      const r = await anyApi.listMcpServers();
      setServers((r && r.success ? r.servers : []) || []);
      setErr(false);
    } catch (_) { setErr(true); setServers([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onItemClick = useCallback(async (name: string) => {
    if (api.appendSnippet) {
      try { await api.appendSnippet('请使用 ' + name + ' 这个 MCP'); } catch (_) { /* ignore */ }
    }
    addRecent('mcp', name);
  }, []);

  const list = servers || [];
  const userServers = list.filter((s) => s.source !== 'project');
  const projServers = list.filter((s) => s.source === 'project');

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, 'MCP（连接器）'),
      createElement('button', { className: 'ck-icon-btn', title: '刷新', onClick: load }, createElement(RefreshIcon)),
    ),
    createElement('div', { className: 'ck-list' },
      servers === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : err ? createElement('div', { className: 'ck-list-empty' }, '加载失败')
        : list.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '未配置 MCP server')
        : [
            userServers.length ? createElement('div', { key: 'u', className: 'ck-mcp-group-title' }, '用户级') : null,
            ...userServers.map((s) => createElement(McpItem, { key: 'u-' + s.name, s, onClick: () => onItemClick(s.name) })),
            projServers.length ? createElement('div', { key: 'p', className: 'ck-mcp-group-title' }, '项目级') : null,
            ...projServers.map((s) => createElement(McpItem, { key: 'p-' + s.name, s, onClick: () => onItemClick(s.name) })),
          ],
    ),
  );
}

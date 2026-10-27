/**
 * 插件页（React 版）
 *
 * 迁移自 pages/plugins.ts（506 行）：
 * - 已安装插件（开关/配置/卸载）
 * - 市场（GitHub topic:cuckoo-plugin）
 * - DSH 插件（npm 安装/启停/卸载）
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api, ckAlert, ckConfirm, ckPrompt } from '../shared.js';

interface InstalledPlugin { id: string; name?: string; description?: string; version?: string; repo?: string; enabled?: boolean; hasConfig?: boolean; contributes?: any; }
interface MarketItem { id: string; description?: string; language?: string; stars?: number; license?: string; archived?: boolean; defaultBranch?: string; pushedAt?: string; updatedAt?: string; }
interface DshPlugin { id: string; name?: string; description?: string; version?: string; enabled?: boolean; }

const I = {
  install: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  update: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  plus: 'M12 5v14M5 12h14',
};
function Svg({ d, cls }: { d: string; cls?: string }) {
  return createElement('svg', { className: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d }));
}

function isNewer(a: any, b: any): boolean {
  if (!a || !b) return false;
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x > y) return true; if (x < y) return false; }
  return false;
}
function hasExec(c: any): boolean { return !!(c && ((c.providers && c.providers.length > 0) || c.mcp || (c.scripts && c.scripts.length > 0))); }
function contribSummary(c: any): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.skills && c.skills.length) parts.push('技能 ' + c.skills.length);
  if (c.agents && c.agents.length) parts.push('代理 ' + c.agents.length);
  if (c.rules && c.rules.length) parts.push('规则 ' + c.rules.length);
  if (c.mcp) parts.push('MCP');
  if (c.providers && c.providers.length) parts.push('可执行 ' + c.providers.length);
  if (c.scripts && c.scripts.length) parts.push('网页脚本 ' + c.scripts.length);
  return parts.join(' · ');
}

/** 元信息行 */
function Meta({ pairs }: { pairs: any[] }) {
  const cells = pairs.filter(Boolean);
  if (!cells.length) return null;
  return createElement('div', { className: 'ck-plugin-meta' },
    cells.map((c, i) => createElement('span', { key: i, style: { display: 'contents' } }, i > 0 ? createElement('span', { className: 'sep' }, '·') : null, createElement('span', null, c))));
}

/** 已安装插件项 */
function InstalledItem({ p, onToggle, onUninstall, onConfig }: { p: InstalledPlugin; onToggle: (v: boolean) => void; onUninstall: () => void; onConfig: () => void }) {
  const exec = hasExec(p.contributes);
  const meta: any[] = [];
  if (p.version) meta.push('v' + p.version);
  if (p.repo) meta.push(p.repo);
  const contrib = contribSummary(p.contributes);
  if (contrib) meta.push(contrib);
  return createElement('div', { className: 'ck-plugin-item' },
    createElement('div', { className: 'ck-plugin-head' },
      createElement('span', { className: 'ck-plugin-name' }, p.name || p.id),
      exec ? createElement('span', { className: 'ck-plugin-badge update', title: '含可执行内容' }, '含可执行') : null,
      createElement('div', { className: 'ck-plugin-switch-row' },
        createElement('span', { className: 'ck-plugin-switch-label' }, p.enabled ? '已启用' : '已禁用'),
        createElement('label', { className: 'ck-switch' },
          createElement('input', { type: 'checkbox', checked: !!p.enabled, onChange: (e: any) => onToggle(e.target.checked) }),
          createElement('span', { className: 'ck-switch-track' }),
        ),
      ),
      createElement('div', { className: 'ck-plugin-actions' },
        p.hasConfig ? createElement('button', { className: 'ck-snip-icon-btn', title: '配置', onClick: onConfig }, '⚙') : createElement('span', { className: 'ck-snip-icon-btn ck-snip-icon-placeholder' }),
        createElement('button', { className: 'ck-snip-icon-btn danger', title: '卸载', onClick: onUninstall }, createElement(Svg, { d: I.trash })),
      ),
    ),
    createElement('div', { className: 'ck-plugin-desc' }, p.description || '（无描述）'),
    createElement(Meta, { pairs: meta }),
  );
}

/** 市场条目 */
function MarketCard({ it, state, remote, onInstall }: { it: MarketItem; state: string; remote: any; onInstall: (upgrade: boolean) => void }) {
  const badges: any[] = [];
  if (it.archived) badges.push(createElement('span', { key: 'a', className: 'ck-plugin-badge archived', title: '仓库已归档，可能不再维护' }, '已归档'));
  if (state === 'installed') badges.push(createElement('span', { key: 'i', className: 'ck-plugin-badge on' }, '已安装'));
  if (state === 'update') badges.push(createElement('span', { key: 'u', className: 'ck-plugin-badge update' }, '可更新'));
  let action: any = null;
  if (state === 'none') action = createElement('button', { className: 'ck-snip-icon-btn', title: '安装', onClick: () => onInstall(false) }, createElement(Svg, { d: I.install }));
  else if (state === 'update') action = createElement('button', { className: 'ck-snip-icon-btn', title: '更新到最新', onClick: () => onInstall(true) }, createElement(Svg, { d: I.update }));
  let req: any = null;
  if (remote && remote.ok) {
    const bits: string[] = [];
    if (remote.version) bits.push('插件 v' + remote.version);
    if (remote.minAppVersion) bits.push('需要 Cuckoo Code ≥ ' + remote.minAppVersion);
    if (bits.length) req = createElement('div', { className: 'ck-plugin-req' }, bits.join(' · '));
  } else if (remote && remote.error) req = createElement('div', { className: 'ck-plugin-req err' }, '读不到 plugin.json：' + remote.error);
  return createElement('div', { className: 'ck-plugin-item' },
    createElement('div', { className: 'ck-plugin-head' },
      createElement('span', { className: 'ck-plugin-name', title: it.id }, it.id),
      ...badges,
      createElement('div', { className: 'ck-plugin-actions' }, action),
    ),
    createElement('div', { className: 'ck-plugin-desc' }, it.description || '（无简介）'),
    createElement(Meta, { pairs: [it.language, it.stars ? '★ ' + it.stars : '', it.license, (it.pushedAt || it.updatedAt || '').slice(0, 10)] }),
    req,
  );
}

/** 插件页 */
export function PluginsPage() {
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [market, setMarket] = useState<MarketItem[]>([]);
  const [marketNotice, setMarketNotice] = useState('');
  const [marketRemote, setMarketRemote] = useState<Record<string, any>>({});
  const [installedMap, setInstalledMap] = useState<Record<string, any>>({});
  const [dsh, setDsh] = useState<DshPlugin[] | null>(null);
  const anyApi = api as any;

  const loadInstalled = useCallback(async () => {
    if (!api.listInstalledPlugins) { setInstalled([]); return; }
    try { const r = await api.listInstalledPlugins(); setInstalled((r && r.success ? r.plugins : []) || []); } catch (_) { setInstalled([]); }
  }, []);

  const loadMarket = useCallback(async (force?: boolean) => {
    if (!anyApi.pluginMarketList) { setMarket([]); return; }
    setMarketNotice('');
    try {
      const r = await anyApi.pluginMarketList({ force: !!force });
      if (!r || !r.success) { setMarket([]); setMarketNotice((r && r.error) || '加载失败'); return; }
      setMarket(r.items || []);
      setInstalledMap((r && r.installed) || {});
      setMarketNotice((r && r.error) || '');
      // 异步补远端 manifest
      const targets = (r.items || []).filter((it: any) => it.defaultBranch).map((it: any) => ({ repo: it.id, branch: it.defaultBranch }));
      if (targets.length && anyApi.pluginMarketRemote) {
        anyApi.pluginMarketRemote(targets).then((rr: any) => { if (rr && rr.success) setMarketRemote(rr.remote || {}); }).catch(() => {});
      }
    } catch (_) { setMarket([]); }
  }, [anyApi]);

  const loadDsh = useCallback(async () => {
    if (typeof anyApi.cuckooPluginList !== 'function') { setDsh([]); return; }
    try { const r = await anyApi.cuckooPluginList(); setDsh((r && r.success ? r.plugins : []) || []); } catch (_) { setDsh([]); }
  }, [anyApi]);

  const loadAll = useCallback(async () => { await loadInstalled(); await loadMarket(false); await loadDsh(); }, [loadInstalled, loadMarket, loadDsh]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const onToggleInstalled = useCallback(async (p: InstalledPlugin, v: boolean) => {
    if (v && hasExec(p.contributes)) {
      const lines: string[] = (p.contributes.providers || []).map((f: string) => '· providers/' + f + '（会被 require 执行）');
      if (p.contributes.mcp) lines.push('· mcp.json 里的 MCP server（会启动子进程）');
      const ok = await ckConfirm('启用「' + (p.name || p.id) + '」？\n\n该插件含可执行内容，启用后会在本机运行第三方代码：\n\n' + lines.join('\n'), '启用插件');
      if (!ok) return;
    }
    if (!api.pluginSetEnabled) return;
    const r: any = await api.pluginSetEnabled(p.id, v);
    if (!r || !r.success) { await ckAlert((r && r.error) || '操作失败'); return; }
    loadInstalled();
  }, [loadInstalled]);

  const onUninstallInstalled = useCallback(async (p: InstalledPlugin) => {
    if (!(await ckConfirm('确定卸载插件「' + p.id + '」？\n\n插件目录与其启用状态都会被删除。', '卸载插件'))) return;
    if (!api.pluginUninstall) return;
    const r: any = await api.pluginUninstall(p.id);
    if (!r || !r.success) { await ckAlert((r && r.error) || '卸载失败'); return; }
    loadAll();
  }, [loadAll]);

  const onConfig = useCallback(async (id: string) => {
    if (typeof anyApi.pluginConfigGet !== 'function') { await ckAlert('配置接口不可用'); return; }
    const r = await anyApi.pluginConfigGet(id);
    if (!r || !r.success) { await ckAlert((r && r.error) || '读取配置失败'); return; }
    const schema = r.schema || {}; const values = r.values || {};
    const keys = Object.keys(schema);
    if (keys.length === 0) { await ckAlert('该插件没有配置项'); return; }
    // 简化：用 prompt 逐项输入（后续可做专门表单）
    const out: any = {};
    for (const k of keys) {
      const f = schema[k] || {};
      if (f.type === 'boolean') {
        const v = await ckConfirm((f.label || k) + ' ？（确定=开，取消=关）', '插件配置');
        out[k] = v;
      } else {
        const def = values[k] !== undefined ? values[k] : (f.default !== undefined ? f.default : '');
        const v = await ckPrompt({ title: (f.label || k), placeholder: f.description || '', value: String(def) });
        if (v === null) return;
        out[k] = f.type === 'number' ? Number(v) : v;
      }
    }
    const sr = await anyApi.pluginConfigSet(id, out);
    if (!sr || !sr.success) { await ckAlert((sr && sr.error) || '保存失败'); return; }
    await ckAlert('已保存。重启或重载后生效（部分插件即时生效）。', '配置已保存');
  }, [anyApi]);

  const onInstallMarket = useCallback(async (it: MarketItem, isUpgrade: boolean) => {
    const remote = marketRemote[it.id];
    const what = isUpgrade ? '更新' : '安装';
    const lines: string[] = [it.id];
    if (it.description) lines.push(it.description);
    if (remote && remote.ok) { if (remote.version) lines.push('版本：v' + remote.version); }
    const ok = await ckConfirm('确定' + what + '该插件？\n\n' + lines.join('\n') + '\n\n装好后默认禁用，需在「已安装」处打开开关才生效。', what + '插件');
    if (!ok) return;
    if (!api.pluginInstall) return;
    const r: any = await api.pluginInstall(it.id, it.defaultBranch || '', !!isUpgrade);
    if (!r || !r.success) { await ckAlert((r && r.error) || (what + '失败'), what + '失败'); return; }
    await ckAlert((r.upgraded ? '已更新：' : '已安装：') + ((r.plugin && r.plugin.name) || it.id), r.upgraded ? '更新完成' : '安装完成');
    loadAll();
  }, [marketRemote, loadAll]);

  const onToggleDsh = useCallback(async (p: DshPlugin, v: boolean) => {
    const r = await anyApi.cuckooPluginToggle(p.id, v);
    if (!r || !r.success) { await ckAlert((r && r.error) || '操作失败'); return; }
    loadDsh();
  }, [anyApi, loadDsh]);

  const onUninstallDsh = useCallback(async (p: DshPlugin) => {
    if (!(await ckConfirm('确定卸载插件「' + p.id + '」？\n（工具需重启后移除）'))) return;
    const r = await anyApi.cuckooPluginUninstall(p.id);
    if (!r || !r.success) { await ckAlert((r && r.error) || '卸载失败'); return; }
    loadDsh();
  }, [anyApi, loadDsh]);

  const onInstallDsh = useCallback(async () => {
    if (typeof anyApi.cuckooPluginInstall !== 'function') return;
    const pkgName = await ckPrompt({ title: '安装 DSH 插件', placeholder: 'npm 包名，如 @scope/dsh-plugin-xxx', value: '' });
    if (!pkgName) return;
    const r = await anyApi.cuckooPluginInstall(pkgName);
    if (!r || !r.success) { await ckAlert((r && r.error) || '安装失败', '安装失败'); return; }
    const tools = (r.tools || []).join(', ');
    await ckAlert('已安装：' + (r.pluginName || r.id) + '\n工具：' + (tools || '(无)') + '\n\n重启应用后工具生效。', '安装完成');
    loadDsh();
  }, [anyApi, loadDsh]);

  const marketState = (it: MarketItem): string => {
    const inst = installedMap[it.id];
    if (!inst) return 'none';
    const remote = marketRemote[it.id];
    if (remote && remote.ok && remote.version) return isNewer(remote.version, inst.version) ? 'update' : 'installed';
    if (it.pushedAt && inst.installedAt) { const p = Date.parse(it.pushedAt); const i = Date.parse(inst.installedAt); if (Number.isFinite(p) && Number.isFinite(i) && p > i) return 'update'; }
    return 'installed';
  };

  const instList = installed || [];
  const dshList = dsh || [];

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    // 已安装
    createElement('div', { className: 'ck-actions' },
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, '已安装插件'),
      createElement('button', { className: 'ck-icon-btn', title: '打开插件目录', onClick: async () => { if (api.pluginOpenDir) { const r: any = await api.pluginOpenDir(); if (r && !r.success) await ckAlert(r.error || '打开目录失败'); } } }, createElement(Svg, { d: I.folder })),
      createElement('button', { className: 'ck-icon-btn', title: '刷新（重新搜索市场）', onClick: () => loadMarket(true) }, createElement(Svg, { d: I.refresh })),
    ),
    createElement('div', { className: 'ck-list' },
      installed === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : instList.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '还没有安装插件', createElement('br'), '从下方市场安装')
        : instList.map((p) => createElement(InstalledItem, { key: p.id, p, onToggle: (v: boolean) => onToggleInstalled(p, v), onUninstall: () => onUninstallInstalled(p), onConfig: () => onConfig(p.id) })),
    ),
    // 市场
    createElement('div', { className: 'ck-actions' },
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, '市场'),
      createElement('span', { className: 'ck-snip-badge', title: '唯一搜索源' }, 'topic:cuckoo-plugin'),
    ),
    createElement('div', { className: 'ck-list' },
      market.length === 0
        ? createElement('div', { className: 'ck-list-empty' }, marketNotice || '暂无插件', createElement('br'), createElement('br'), '给你的仓库打上 ', createElement('b', null, 'cuckoo-plugin'), ' topic，', createElement('br'), '它就会出现在这里')
        : market.map((it) => createElement(MarketCard, { key: it.id, it, state: marketState(it), remote: marketRemote[it.id], onInstall: (u: boolean) => onInstallMarket(it, u) })),
    ),
    // DSH 插件
    createElement('div', { className: 'ck-actions' },
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, 'DSH 插件（npm）'),
      createElement('button', { className: 'ck-icon-btn', title: '打开插件目录', onClick: async () => { if (typeof anyApi.cuckooPluginOpenDir === 'function') { const r = await anyApi.cuckooPluginOpenDir(); if (r && !r.success) await ckAlert(r.error || '打开目录失败'); } } }, createElement(Svg, { d: I.folder })),
      createElement('button', { className: 'ck-icon-btn', title: '安装 DSH 插件（输入 npm 包名）', onClick: onInstallDsh }, createElement(Svg, { d: I.plus })),
    ),
    createElement('div', { className: 'ck-list' },
      dsh === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : dshList.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '暂无 DSH 插件（点 + 安装）')
        : dshList.map((p) => createElement('div', { key: p.id, className: 'ck-list-item' },
            createElement('div', { className: 'ck-list-main' },
              createElement('div', { className: 'ck-list-title' }, p.name || p.id, p.version ? createElement('span', { className: 'ck-plugin-ver' }, 'v' + p.version) : null),
              p.description ? createElement('div', { className: 'ck-list-desc' }, p.description) : null,
              createElement('div', { className: 'ck-plugin-meta' }, createElement('span', null, p.id)),
            ),
            createElement('label', { className: 'ck-switch', title: p.enabled ? '已启用' : '已禁用' },
              createElement('input', { type: 'checkbox', checked: !!p.enabled, onChange: (e: any) => onToggleDsh(p, e.target.checked) }),
              createElement('span', { className: 'ck-switch-track' }),
            ),
            createElement('button', { className: 'ck-icon-btn', title: '卸载', onClick: () => onUninstallDsh(p) }, createElement(Svg, { d: I.trash })),
          )),
    ),
  );
}

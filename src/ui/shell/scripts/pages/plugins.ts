/**
 * 插件页：市场（GitHub topic:cuckoo-plugin 唯一搜索源）+ 已安装（开关/卸载）。
 * 安全边界见 src/plugins/installer.ts：repo/branch 严格校验、解压防路径穿越、
 * 落盘前校验清单、可执行内容需显式启用授权。
 */
// ===== 插件 =====
import { api, ckAlert, ckConfirm, ckPrompt, escapeHtml, escapeAttr } from '../shared.js';

// 市场唯一搜索源是 GitHub topic:cuckoo-plugin。
// 搜索为空就如实显示空状态 —— 不做关键词兜底、不做官方精选清单。
let pluginMarketItems: any[] = [];
let pluginMarketNotice = '';
// repo → 已安装摘要（来自市场接口）；repo → 远端 plugin.json（来自 remote 接口）
let pluginInstalled: Record<string, any> = {};
let pluginRemote: Record<string, any> = {};

const ICON_INSTALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const ICON_UPDATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

export async function loadPlugins(): Promise<void> {
  await loadInstalledPlugins();
  await loadPluginMarket(false);
  await loadCuckooPlugins();
}

function pluginContribSummary(c: any): string {
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

/** 是否含可执行内容（providers / MCP / 网页脚本）—— 决定启用时是否需要警告 */
function pluginHasExec(c: any): boolean {
  if (!c) return false;
  return !!((c.providers && c.providers.length > 0) || c.mcp || (c.scripts && c.scripts.length > 0));
}

/** 版本比较：a 比 b 新则返回 true。非数字段一律当 0，非法输入返回 false。 */
function isNewerVersion(a: any, b: any): boolean {
  if (!a || !b) return false;
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * 市场条目相对已安装版本的状态：'none'（未装）/ 'installed' / 'update'。
 * 优先用远端 plugin.json 的精确版本；拿不到时回退到"仓库在安装之后推送过"的启发式。
 */
function pluginUpdateState(it: any): string {
  const inst = pluginInstalled[it.id];
  if (!inst) return 'none';
  const remote = pluginRemote[it.id];
  if (remote && remote.ok && remote.version) {
    return isNewerVersion(remote.version, inst.version) ? 'update' : 'installed';
  }
  if (it.pushedAt && inst.installedAt) {
    const pushed = Date.parse(it.pushedAt);
    const installed = Date.parse(inst.installedAt);
    if (Number.isFinite(pushed) && Number.isFinite(installed) && pushed > installed) return 'update';
  }
  return 'installed';
}

/** 元信息行（语言 · star · 许可证 · 日期） */
function pluginMetaHtml(pairs: any[]): string {
  const cells: string[] = [];
  pairs.forEach((p) => {
    if (p) cells.push('<span>' + p + '</span>');
  });
  if (!cells.length) return '';
  return '<div class="ck-plugin-meta">' + cells.join('<span class="sep">·</span>') + '</div>';
}

async function loadInstalledPlugins(): Promise<void> {
  const listEl = document.getElementById('plugin-installed-list');
  if (!listEl || !api.listInstalledPlugins) return;
  try {
    const r = await api.listInstalledPlugins();
    const plugins: any[] = (r && r.success) ? r.plugins : [];
    if (!plugins.length) {
      listEl.innerHTML = '<div class="ck-list-empty">还没有安装插件<br>从下方市场安装</div>';
      return;
    }
    listEl.innerHTML = plugins.map((p) => {
      const hasExec = pluginHasExec(p.contributes);
      // 开关：插件的总开关。开启后技能/代理/规则/MCP/可执行内容全部生效。
      const swTitle = hasExec
        ? '启用后：技能/代理/规则 + MCP + 可执行内容全部生效'
        : '启用后：技能/代理/规则全部生效';
      const sw = '<label class="ck-switch" title="' + escapeAttr(swTitle) + '">' +
        '<input type="checkbox" data-toggle="' + escapeAttr(p.id) + '"' + (p.enabled ? ' checked' : '') + ' />' +
        '<span class="ck-switch-track"></span></label>';

      const meta: string[] = [];
      if (p.version) meta.push('v' + escapeHtml(p.version));
      if (p.repo) meta.push(escapeHtml(p.repo));
      const contrib = pluginContribSummary(p.contributes);
      if (contrib) meta.push(escapeHtml(contrib));

      return '<div class="ck-plugin-item" data-plugin="' + escapeAttr(p.id) + '">' +
        '<div class="ck-plugin-head">' +
          '<span class="ck-plugin-name">' + escapeHtml(p.name || p.id) + '</span>' +
          (hasExec ? '<span class="ck-plugin-badge update" title="含可执行内容">含可执行</span>' : '') +
          '<div class="ck-plugin-switch-row">' +
            '<span class="ck-plugin-switch-label">' + (p.enabled ? '已启用' : '已禁用') + '</span>' +
            sw +
          '</div>' +
          '<div class="ck-plugin-actions">' +
            (p.hasConfig ? '<button class="ck-snip-icon-btn" data-config="' + escapeAttr(p.id) + '" title="配置">⚙</button>' : '<span class="ck-snip-icon-btn ck-snip-icon-placeholder" aria-hidden="true"></span>') +
            '<button class="ck-snip-icon-btn danger" data-uninstall="' + escapeAttr(p.id) + '" title="卸载">' +
              ICON_TRASH +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="ck-plugin-desc">' + escapeHtml(p.description || '（无描述）') + '</div>' +
        pluginMetaHtml(meta) +
      '</div>';
    }).join('');

    // 配置按钮：弹简单配置表单（按 schema 渲染）
    listEl.querySelectorAll('[data-config]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as any).dataset.config;
        await openPluginConfig(id);
      });
    });

    listEl.querySelectorAll('[data-uninstall]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as any).dataset.uninstall;
        if (!(await ckConfirm('确定卸载插件「' + id + '」？\n\n插件目录与其启用状态都会被删除。', '卸载插件'))) return;
        if (!api.pluginUninstall) return;
        const r = await api.pluginUninstall(id);
        if (!r || !r.success) { await ckAlert((r && r.error) || '卸载失败'); return; }
        await loadPlugins();
      });
    });

    // 开关：启用含可执行内容的插件时先警告（那会在本机运行第三方代码）
    listEl.querySelectorAll('[data-toggle]').forEach((input) => {
      input.addEventListener('change', async () => {
        const id = (input as any).dataset.toggle;
        const p = plugins.filter((x) => x.id === id)[0];
        const turnOn = (input as any).checked;

        if (turnOn && p && pluginHasExec(p.contributes)) {
          const lines = (p.contributes.providers || []).map((f: string) => {
            return '· providers/' + f + '（会被 require 执行）';
          });
          if (p.contributes.mcp) lines.push('· mcp.json 里的 MCP server（会启动子进程）');
          const ok = await ckConfirm(
            '启用「' + (p.name || id) + '」？\n\n' +
            '该插件含可执行内容，启用后会在本机运行第三方代码：\n\n' +
            lines.join('\n'),
            '启用插件'
          );
          if (!ok) { (input as any).checked = false; return; }
        }

        if (!api.pluginSetEnabled) return;
        const r = await api.pluginSetEnabled(id, turnOn);
        if (!r || !r.success) {
          (input as any).checked = !turnOn; // 失败回滚，避免 UI 与真实状态不一致
          await ckAlert((r && r.error) || '操作失败');
          return;
        }
        await loadInstalledPlugins();
      });
    });
  } catch (_) {
    listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>';
  }
}

/** 渲染市场列表（数据来自 pluginMarketItems / pluginInstalled / pluginRemote） */
function renderPluginMarket(): void {
  const listEl = document.getElementById('plugin-market-list');
  if (!listEl) return;
  const notice = pluginMarketNotice
    ? '<div class="ck-list-empty">' + escapeHtml(pluginMarketNotice) + '</div>'
    : '';
  if (!pluginMarketItems.length) {
    // 空就是空：如实告知，并给出可执行的下一步
    listEl.innerHTML = notice +
      '<div class="ck-list-empty">暂无插件<br><br>给你的仓库打上 <b>cuckoo-plugin</b> topic，<br>它就会出现在这里</div>';
    return;
  }
  listEl.innerHTML = notice + pluginMarketItems.map(marketCardHtml).join('');
  listEl.querySelectorAll('[data-install]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as any).dataset.install;
      const it = pluginMarketItems.filter((x) => x.id === id)[0];
      if (it) await installPluginFromMarket(it, (btn as any).dataset.upgrade === '1');
    });
  });
}

function marketCardHtml(it: any): string {
  const state = pluginUpdateState(it);
  const remote = pluginRemote[it.id];

  let badges = '';
  if (it.archived) badges += '<span class="ck-plugin-badge archived" title="仓库已归档，可能不再维护">已归档</span>';
  if (state === 'installed') badges += '<span class="ck-plugin-badge on">已安装</span>';
  if (state === 'update') badges += '<span class="ck-plugin-badge update">可更新</span>';

  // 已安装且无更新 → 不给操作按钮（避免重复安装把用户已改过的内容覆盖掉）
  let action = '';
  if (state === 'none') {
    action = '<button class="ck-snip-icon-btn" data-install="' + escapeAttr(it.id) + '" title="安装">' +
      ICON_INSTALL + '</button>';
  } else if (state === 'update') {
    action = '<button class="ck-snip-icon-btn" data-install="' + escapeAttr(it.id) + '" data-upgrade="1" title="更新到最新">' +
      ICON_UPDATE + '</button>';
  }

  // 版本要求：搜索接口不返回这些，靠远端 plugin.json 补（没拿到就不显示）
  let req = '';
  if (remote && remote.ok) {
    const bits: string[] = [];
    if (remote.version) bits.push('插件 v' + escapeHtml(remote.version));
    if (remote.minAppVersion) bits.push('需要 Cuckoo Code ≥ ' + escapeHtml(remote.minAppVersion));
    if (bits.length) req = '<div class="ck-plugin-req">' + bits.join(' · ') + '</div>';
  } else if (remote && remote.error) {
    req = '<div class="ck-plugin-req err">读不到 plugin.json：' + escapeHtml(remote.error) + '</div>';
  }

  return '<div class="ck-plugin-item" data-repo="' + escapeAttr(it.id) + '">' +
    '<div class="ck-plugin-head">' +
      '<span class="ck-plugin-name" title="' + escapeAttr(it.id) + '">' + escapeHtml(it.id) + '</span>' +
      badges +
      '<div class="ck-plugin-actions">' + action + '</div>' +
    '</div>' +
    '<div class="ck-plugin-desc">' + escapeHtml(it.description || '（无简介）') + '</div>' +
    pluginMetaHtml([
      it.language ? escapeHtml(it.language) : '',
      it.stars ? '★ ' + it.stars : '',
      it.license ? escapeHtml(it.license) : '',
      (it.pushedAt || it.updatedAt || '').slice(0, 10),
    ]) +
    req +
  '</div>';
}

async function loadPluginMarket(force: boolean): Promise<void> {
  const listEl = document.getElementById('plugin-market-list');
  if (!listEl || !api.pluginMarketList) return;
  listEl.innerHTML = '<div class="ck-list-empty">加载中…</div>';
  try {
    const r = await api.pluginMarketList({ force: !!force });
    if (!r || !r.success) {
      pluginMarketItems = [];
      pluginMarketNotice = (r && r.error) || '加载失败';
      renderPluginMarket();
      return;
    }
    pluginMarketItems = r.items || [];
    pluginInstalled = (r && r.installed) || {};
    pluginMarketNotice = (r && r.error) || '';
    renderPluginMarket();
    // 搜索接口不返回插件版本/兼容要求，异步补齐后再渲染一次
    loadRemoteManifests();
  } catch (_) {
    listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>';
  }
}

/** 批量拉远端 plugin.json（版本 / 最低应用版本），并据此判定「可更新」 */
async function loadRemoteManifests(): Promise<void> {
  if (!api.pluginMarketRemote) return;
  const targets = pluginMarketItems
    .filter((it) => it.defaultBranch)
    .map((it) => ({ repo: it.id, branch: it.defaultBranch }));
  if (!targets.length) return;
  try {
    const r = await api.pluginMarketRemote(targets);
    if (!r || !r.success) return;
    pluginRemote = r.remote || {};
    renderPluginMarket();
  } catch (_) { /* 补信息失败不影响主列表 */ }
}

async function installPluginFromMarket(item: any, isUpgrade: boolean): Promise<void> {
  const remote = pluginRemote[item.id];
  const what = isUpgrade ? '更新' : '安装';

  const lines: string[] = [item.id];
  if (item.description) lines.push(item.description);
  if (remote && remote.ok) {
    if (remote.version) lines.push('版本：v' + remote.version);
    if (remote.minAppVersion) lines.push('需要 Cuckoo Code ≥ ' + remote.minAppVersion);
  }

  const ok = await ckConfirm(
    '确定' + what + '该插件？\n\n' + lines.join('\n') +
    '\n\n装好后默认处于禁用状态，需在「已安装」处打开开关才生效。',
    what + '插件'
  );
  if (!ok) return;

  if (!api.pluginInstall) return;
  const r = await api.pluginInstall(item.id, item.defaultBranch, !!isUpgrade);
  if (!r || !r.success) {
    await ckAlert((r && r.error) || (what + '失败'), what + '失败');
    return;
  }
  const msg = (r.upgraded ? '已更新：' : '已安装：') + ((r.plugin && r.plugin.name) || item.id);
  await ckAlert(msg + '\n\n默认禁用。在「已安装」处打开开关后，它的技能 / 代理 / 规则 / MCP / 可执行内容才会生效。', r.upgraded ? '更新完成' : '安装完成');
  await loadPlugins();
}

document.getElementById('plugin-refresh')?.addEventListener('click', () => loadPluginMarket(true));

document.getElementById('plugin-open-dir')?.addEventListener('click', async () => {
  if (!api.pluginOpenDir) return;
  const r = await api.pluginOpenDir();
  if (r && !r.success) await ckAlert(r.error || '打开目录失败');
});

/** 打开插件配置弹窗（按 schema 渲染简单表单） */
async function openPluginConfig(pluginId: string): Promise<void> {
  const apiAny: any = api as any;
  if (!apiAny || typeof apiAny.pluginConfigGet !== 'function') {
    await ckAlert('配置接口不可用');
    return;
  }
  const r = await apiAny.pluginConfigGet(pluginId);
  if (!r || !r.success) { await ckAlert((r && r.error) || '读取配置失败'); return; }
  const schema = r.schema || {};
  const values = r.values || {};
  const keys = Object.keys(schema);
  if (keys.length === 0) { await ckAlert('该插件没有配置项'); return; }

  // 用 ck-dialog 的 mask 手动构建表单
  const mask = document.getElementById('ck-dialog');
  const titleEl = document.getElementById('ck-dialog-title');
  const msgEl = document.getElementById('ck-dialog-msg');
  const okBtn = document.getElementById('ck-dialog-ok');
  const cancelBtn = document.getElementById('ck-dialog-cancel');
  if (!mask || !titleEl || !msgEl || !okBtn || !cancelBtn) return;

  titleEl.textContent = '插件配置：' + pluginId;
  // 加宽弹窗（原 ck-dialog 只有 280px，放不下表单）
  const dlg = mask.querySelector('.ck-dialog') as any;
  if (dlg) { dlg.__oldMaxWidth = dlg.style.maxWidth; dlg.style.maxWidth = '420px'; dlg.style.width = '380px'; }
  msgEl.innerHTML = '';
  const inputs: Record<string, any> = {};
  for (const k of keys) {
    const f = schema[k] || {};
    const row = document.createElement('div');
    row.style.cssText = 'margin:10px 0;display:flex;flex-direction:column;gap:4px';
    const lab = document.createElement('label');
    lab.textContent = (f.label || k) + (f.description ? '（' + f.description + '）' : '');
    lab.style.cssText = 'font-size:12px;color:var(--ck-text-2)';
    let inp: any;
    if (f.type === 'boolean') {
      inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = values[k] !== undefined ? !!values[k] : !!f.default;
      inp.style.cssText = 'align-self:flex-start';
    } else if (f.type === 'number') {
      inp = document.createElement('input');
      inp.type = 'number';
      inp.value = values[k] !== undefined ? values[k] : (f.default !== undefined ? f.default : '');
      inp.style.cssText = 'width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--ck-border-strong);border-radius:6px;background:var(--ck-surface);color:var(--ck-text);font-size:12px';
    } else {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.value = values[k] !== undefined ? values[k] : (f.default !== undefined ? f.default : '');
      inp.style.cssText = 'width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--ck-border-strong);border-radius:6px;background:var(--ck-surface);color:var(--ck-text);font-size:12px';
    }
    inputs[k] = { inp, type: f.type };
    row.appendChild(lab); row.appendChild(inp);
    msgEl.appendChild(row);
  }
  cancelBtn.classList.remove('cuckoo-hidden');

  const cleanup = () => {
    mask.classList.add('cuckoo-hidden');
    // 恢复弹窗宽度
    const d2 = mask.querySelector('.ck-dialog') as any;
    if (d2) { d2.style.maxWidth = d2.__oldMaxWidth || ''; d2.style.width = ''; }
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
  };
  const onOk = async () => {
    cleanup();
    const out: any = {};
    for (const k of Object.keys(inputs)) {
      const { inp, type } = inputs[k];
      if (type === 'boolean') out[k] = !!inp.checked;
      else if (type === 'number') out[k] = Number(inp.value);
      else out[k] = String(inp.value);
    }
    const sr = await apiAny.pluginConfigSet(pluginId, out);
    if (!sr || !sr.success) { await ckAlert((sr && sr.error) || '保存失败'); return; }
    await ckAlert('已保存。重启或重载后生效（部分插件即时生效）。', '配置已保存');
  };
  const onCancel = () => { cleanup(); };
  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  mask.classList.remove('cuckoo-hidden');
}

// ===== Cuckoo 插件（DSH 兼容）=====
function ckpRenderItem(p: any): string {
  const on = !!p.enabled;
  return '<div class="ck-list-item" data-id="' + escapeAttr(p.id) + '">' +
    '<div class="ck-list-main">' +
      '<div class="ck-list-title">' + escapeHtml(p.name || p.id) +
        (p.version ? ' <span class="ck-plugin-ver">v' + escapeHtml(p.version) + '</span>' : '') +
      '</div>' +
      (p.description ? '<div class="ck-list-desc">' + escapeHtml(p.description) + '</div>' : '') +
      '<div class="ck-plugin-meta"><span>' + escapeHtml(p.id) + '</span></div>' +
    '</div>' +
    '<label class="ck-switch" title="' + (on ? '已启用' : '已禁用') + '">' +
      '<input type="checkbox" class="ckp-toggle" ' + (on ? 'checked' : '') + ' />' +
      '<span class="ck-switch-track"></span>' +
    '</label>' +
    '<button class="ck-icon-btn ckp-del" title="卸载">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
    '</button>' +
  '</div>';
}

export async function loadCuckooPlugins(): Promise<void> {
  const listEl = document.getElementById('ckp-list');
  const apiAny: any = api as any;
  if (!listEl || typeof apiAny.cuckooPluginList !== 'function') return;
  try {
    const r = await apiAny.cuckooPluginList();
    const plugins: any[] = (r && r.success) ? (r.plugins || []) : [];
    if (plugins.length === 0) {
      listEl.innerHTML = '<div class="ck-list-empty">暂无 DSH 插件（点 + 安装）</div>';
      return;
    }
    listEl.innerHTML = plugins.map(ckpRenderItem).join('');
    listEl.querySelectorAll('.ck-list-item').forEach((el: any) => {
      const id = el.getAttribute('data-id');
      const toggle = el.querySelector('.ckp-toggle') as any;
      const del = el.querySelector('.ckp-del') as any;
      if (toggle) {
        toggle.addEventListener('change', async () => {
          const r2 = await apiAny.cuckooPluginToggle(id, !!toggle.checked);
          if (!r2 || !r2.success) { await ckAlert((r2 && r2.error) || '操作失败'); toggle.checked = !toggle.checked; }
        });
      }
      if (del) {
        del.addEventListener('click', async () => {
          if (!(await ckConfirm('确定卸载插件「' + id + '」？\n（工具需重启后移除）'))) return;
          const r2 = await apiAny.cuckooPluginUninstall(id);
          if (!r2 || !r2.success) { await ckAlert((r2 && r2.error) || '卸载失败'); return; }
          await loadCuckooPlugins();
        });
      }
    });
  } catch (_) {
    listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>';
  }
}

document.getElementById('ckp-install-btn')?.addEventListener('click', async () => {
  const apiAny: any = api as any;
  if (typeof apiAny.cuckooPluginInstall !== 'function') return;
  const pkgName = await ckPrompt({ title: '安装 DSH 插件', placeholder: 'npm 包名，如 @scope/dsh-plugin-xxx', value: '' });
  if (!pkgName) return;
  const btn = document.getElementById('ckp-install-btn') as any;
  if (btn) btn.disabled = true;
  try {
    const r = await apiAny.cuckooPluginInstall(pkgName);
    if (!r || !r.success) { await ckAlert((r && r.error) || '安装失败', '安装失败'); return; }
    const tools = (r.tools || []).join(', ');
    await ckAlert('已安装：' + (r.pluginName || r.id) + '\n工具：' + (tools || '(无)') + '\n\n重启应用后工具生效。', '安装完成');
    await loadCuckooPlugins();
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('ckp-open-dir')?.addEventListener('click', async () => {
  const apiAny: any = api as any;
  if (typeof apiAny.cuckooPluginOpenDir !== 'function') return;
  const r = await apiAny.cuckooPluginOpenDir();
  if (r && !r.success) await ckAlert(r.error || '打开目录失败');
});
// ===== Cuckoo 插件（结束） =====

// ===== 插件（结束） =====

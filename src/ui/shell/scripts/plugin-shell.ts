/**
 * 插件界面挂载：接收主进程 'shell-plugin-mount'，往壳页面挂插件 UI。
 * 支持的挂载点：statusbar（状态栏项）、toolbar（工具栏按钮）、sidebar（侧边栏页）。
 */
import { api } from './shared.js';

interface MountSpec {
  pluginId: string;
  target: 'statusbar' | 'toolbar' | 'sidebar';
  id: string;
  spec: any;
}

const mountedStatus = new Set<string>();
const mountedToolbar = new Set<string>();

function mountStatusbar(m: MountSpec): void {
  const key = m.pluginId + ':' + m.id;
  const bar = document.querySelector('.statusbar');
  if (!bar) return;
  // 已存在 → 更新文字（支持动态）
  const exist = bar.querySelector('[data-plugin="' + m.pluginId + '"][data-plugin-id="' + m.id + '"]');
  if (exist) { const lbl = exist.querySelector('.sb-label'); if (lbl) lbl.textContent = (m.spec && m.spec.text) || ''; return; }
  mountedStatus.add(key);
  const el = document.createElement('div');
  el.className = 'sb-item';
  el.setAttribute('data-plugin', m.pluginId);
  el.setAttribute('data-plugin-target', 'statusbar');
  el.setAttribute('data-plugin-id', m.id);
  if (m.spec && m.spec.title) el.title = String(m.spec.title);
  el.innerHTML = '<span class="sb-label">' + escapeHtml((m.spec && m.spec.text) || '') + '</span>';
  // 插到末尾（sb-spacer 之前）
  const spacer = bar.querySelector('.sb-spacer');
  if (spacer && spacer.parentNode === bar) bar.insertBefore(el, spacer);
  else bar.appendChild(el);
}

function mountToolbar(m: MountSpec): void {
  const key = m.pluginId + ':' + m.id;
  if (mountedToolbar.has(key)) return;
  mountedToolbar.add(key);
  const bar = document.querySelector('.toolbar');
  if (!bar) return;
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.setAttribute('data-plugin', m.pluginId);
  btn.setAttribute('data-plugin-target', 'toolbar');
  btn.setAttribute('data-plugin-id', m.id);
  if (m.spec && m.spec.title) btn.title = String(m.spec.title);
  btn.textContent = (m.spec && m.spec.label) || m.id;
  btn.addEventListener('click', () => {
    try {
      // 1) spec.command：触发该命令（复用命令系统）
      if (m.spec && m.spec.command) {
        const apiAny: any = api as any;
        if (apiAny && typeof apiAny.commandInvoke === 'function') { apiAny.commandInvoke(m.spec.command).catch(() => {}); return; }
      }
      // 2) 回调表（兼容）
      const cb = (window as any).__cuckooPluginToolbarCbs && (window as any).__cuckooPluginToolbarCbs[key];
      if (typeof cb === 'function') cb();
    } catch (_) {}
  });
  bar.appendChild(btn);
}

/**
 * 插件侧边栏页：同时创建「活动栏图标」+「侧边栏面板」并配对。
 * - 图标（.ck-ab-item）点击 → 激活对应面板（.ck-tab），与内置页一致的切换行为
 * - 面板 HTML 由插件提供（spec.html）
 * - 提供 spec.icon 时渲染图标（HTML/SVG/文本）；否则用标题首字
 */
function mountSidebar(m: MountSpec): void {
  const key = m.pluginId + ':' + m.id;
  const tabId = 'plugin:' + key; // data-panel / data-tab 配对值
  const sidebar = document.getElementById('ck-sidebar');
  const ab = document.querySelector('.ck-activitybar');
  const panelBody = document.querySelector('.ck-panel-body');
  if (!sidebar || !ab || !panelBody) return;

  // 幂等：先移除同插件旧的面板与图标（避免重载重复挂载）
  document.querySelectorAll('[data-plugin="' + m.pluginId + '"][data-plugin-panel]').forEach((el: any) => el.remove());
  document.querySelectorAll('.ck-ab-item[data-plugin="' + m.pluginId + '"][data-plugin-tab]').forEach((el: any) => el.remove());

  // 1) 面板（.ck-tab，与内置页同层）
  if (!panelBody.querySelector('[data-panel="' + tabId + '"]')) {
    const panel = document.createElement('div');
    panel.className = 'ck-tab';
    panel.setAttribute('data-panel', tabId);
    panel.setAttribute('data-plugin-panel', key);
    panel.setAttribute('data-plugin', m.pluginId);
    panel.setAttribute('data-plugin-target', 'sidebar');
    panel.setAttribute('data-plugin-id', m.id);
    panel.innerHTML = (m.spec && m.spec.html)
      || '<div style="padding:12px;color:var(--ck-text-dim);font-size:12px">' + escapeHtml((m.spec && m.spec.title) || m.id) + '</div>';
    panelBody.appendChild(panel);
    // 面板交互脚本（可选）：在面板挂载后执行，注入 shellAPI 与面板根元素
    const script = m.spec && m.spec.script;
    if (typeof script === 'string' && script.trim()) {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('shellAPI', 'panel', 'pluginId', script);
        fn(api, panel, m.pluginId);
      } catch (err: any) {
        console.error('[plugin-shell] 面板脚本执行失败 ' + key + ':', err && err.message);
      }
    }
  }

  // 2) 活动栏图标（点 → 展开侧栏并激活面板）
  if (!ab.querySelector('[data-plugin-tab="' + key + '"]')) {
    const btn = document.createElement('button');
    btn.className = 'ck-ab-item';
    btn.setAttribute('data-plugin', m.pluginId);
    btn.setAttribute('data-plugin-target', 'sidebar');
    btn.setAttribute('data-plugin-id', m.id);
    btn.setAttribute('data-plugin-tab', key);
    btn.title = (m.spec && m.spec.title) || m.id;
    const icon = m.spec && m.spec.icon;
    if (icon) {
      // icon 视为 HTML 片段（可含 <svg>）；纯文本也可
      btn.innerHTML = String(icon);
    } else {
      btn.innerHTML = '<span class="ck-ab-text">' + escapeHtml(((m.spec && m.spec.title) || m.id).slice(0, 1)) + '</span>';
    }
    btn.addEventListener('click', () => {
      const sb = document.getElementById('ck-sidebar');
      const isCollapsed = sb && sb.classList.contains('ck-collapsed');
      const isActive = btn.classList.contains('ck-ab-active');
      if (isCollapsed) { setSidebarCollapsed(false); activatePluginTab(btn, tabId); return; }
      if (isActive) { setSidebarCollapsed(true); return; }
      activatePluginTab(btn, tabId);
    });
    const spacer = ab.querySelector('.ck-ab-spacer');
    if (spacer && spacer.parentNode === ab) ab.insertBefore(btn, spacer);
    else ab.appendChild(btn);
  }
}

/** 激活插件面板：清除内置/插件图标与面板的 active，激活目标 */
function activatePluginTab(btn: any, tabId: string): void {
  document.querySelectorAll('.ck-ab-item').forEach((i: any) => i.classList.remove('ck-ab-active'));
  btn.classList.add('ck-ab-active');
  document.querySelectorAll('.ck-tab').forEach((p: any) => {
    if (p.getAttribute('data-panel') === tabId) p.classList.add('ck-tab-active');
    else p.classList.remove('ck-tab-active');
  });
}

/** 展开/收起侧栏（与 sidebar.ts 行为一致，走 IPC 让主进程重排视图） */
function setSidebarCollapsed(collapsed: boolean): void {
  const sb: any = document.getElementById('ck-sidebar');
  if (!sb) return;
  const apiAny: any = api as any;
  const WIDTH_KEY = 'cuckoo-sidebar-width';
  let w = 320;
  try { const v = Number(localStorage.getItem(WIDTH_KEY)); if (Number.isFinite(v) && v >= 320) w = Math.round(v); } catch (_) {}
  if (collapsed) {
    sb.classList.add('ck-collapsed');
    sb.style.width = '';
    if (apiAny && typeof apiAny.toggleSidebar === 'function') apiAny.toggleSidebar(46);
  } else {
    sb.classList.remove('ck-collapsed');
    sb.style.width = w + 'px';
    if (apiAny && typeof apiAny.toggleSidebar === 'function') apiAny.toggleSidebar(w);
  }
}

/** 通用槽位渲染（对标 DSH slots）：按 slot 找容器，按 order 排序插入 */
function mountSlot(m: any): void {
  if (!m || !m.slot || !m.id) return;
  const key = m.pluginId + ':' + m.slot + ':' + m.id;
  const existing = document.querySelector('[data-slot-key="' + key + '"]');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  const order = typeof m.order === 'number' ? m.order : 100;
  const spec = m.spec || {};
  const el = document.createElement('button');
  el.className = 'ck-ab-item';
  el.setAttribute('data-slot-key', key);
  el.setAttribute('data-plugin', m.pluginId);
  el.setAttribute('data-plugin-target', 'slot:' + m.slot);
  if (spec.title) el.title = String(spec.title);
  el.innerHTML = spec.icon ? String(spec.icon) : (spec.label ? escapeHtml(String(spec.label)) : escapeHtml(m.id));
  el.addEventListener('click', () => {
    try {
      const apiAny: any = api as any;
      if (spec.command && apiAny && typeof apiAny.commandInvoke === 'function') { apiAny.commandInvoke(spec.command).catch(() => {}); }
    } catch (_) {}
  });
  // 找容器（按 slot 名）
  let container: any = null;
  if (m.slot === 'activitybar') container = document.querySelector('.ck-activitybar');
  else if (m.slot === 'toolbar') container = document.querySelector('.toolbar');
  else if (m.slot === 'statusbar') container = document.querySelector('.statusbar');
  if (!container) return;
  // activitybar：插到 spacer 前；其余：按 order 插到末尾
  const spacer = container.querySelector('.ck-ab-spacer');
  if (m.slot === 'activitybar' && spacer) container.insertBefore(el, spacer);
  else container.appendChild(el);
}

/** 移除某插件（或某挂载点）在壳页面挂的 DOM */
function unmountPlugin(pluginId: string, target?: string, id?: string): void {
  if (!pluginId) return;
  const match = (el: any): boolean => {
    if (!el || el.getAttribute('data-plugin') !== pluginId) return false;
    return true;
  };
  const hitTarget = (el: any): boolean => {
    if (!match(el)) return false;
    const t = el.getAttribute('data-plugin-target');
    if (target && t && t !== target) return false;
    const pid = el.getAttribute('data-plugin-id');
    if (id && pid && pid !== id) return false;
    return true;
  };
  // 活动栏图标（插件 sidebar 面板的入口）
  document.querySelectorAll('.ck-ab-item[data-plugin]').forEach((el: any) => { if (hitTarget(el)) el.remove(); });
  // 侧边栏面板
  document.querySelectorAll('.ck-tab[data-plugin-panel]').forEach((el: any) => { if (hitTarget(el)) el.remove(); });
  // 状态栏项
  document.querySelectorAll('.statusbar [data-plugin]').forEach((el: any) => { if (hitTarget(el)) el.remove(); });
  // 工具栏按钮
  document.querySelectorAll('.toolbar [data-plugin]').forEach((el: any) => { if (hitTarget(el)) el.remove(); });
  // 通用槽位
  document.querySelectorAll('[data-slot-key][data-plugin]').forEach((el: any) => { if (hitTarget(el)) el.remove(); });
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 注入/更新某插件的 <style>（data-plugin 标记，便于卸载清理） */
function applyShellStyle(pluginId: string, css: string): void {
  if (!pluginId || typeof css !== 'string') return;
  let tag = document.querySelector('style[data-plugin-style="' + pluginId + '"]') as any;
  if (!tag) {
    tag = document.createElement('style');
    tag.setAttribute('data-plugin-style', pluginId);
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

/** 移除某插件的 <style> */
function removeShellStyle(pluginId: string): void {
  if (!pluginId) return;
  const tag = document.querySelector('style[data-plugin-style="' + pluginId + '"]');
  if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
}

export function initPluginShell(): void {
  const wlog: any = (window as any);
  wlog.__shellMountLog = wlog.__shellMountLog || { received: [], pulled: null };
  try {
    const apiAny: any = api as any;
    // 插件注入壳页面 CSS（对标 DSH styles.insert）
    if (apiAny && typeof apiAny.onPluginShellStyle === 'function') {
      apiAny.onPluginShellStyle((m: any) => {
        try { if (m && m.pluginId) applyShellStyle(m.pluginId, m.css); } catch (_) {}
      });
    }
    if (apiAny && typeof apiAny.onPluginShellStyleRemove === 'function') {
      apiAny.onPluginShellStyleRemove((m: any) => {
        try { if (m && m.pluginId) removeShellStyle(m.pluginId); } catch (_) {}
      });
    }
    // 插件背景图（基座负责对齐）
    const applyBg = (data: any) => {
      let tag = document.getElementById('ck-plugin-bg') as any;
      if (!data || !data.url) { if (tag) tag.remove(); return; }
      if (!tag) { tag = document.createElement('style'); tag.id = 'ck-plugin-bg'; document.head.appendChild(tag); }
      const overlay = data.overlay || 'rgba(10,12,20,0.5)';
      const w = data.winW || window.innerWidth, h = data.winH || window.innerHeight;
      tag.textContent = 'body { background: linear-gradient(' + overlay + ',' + overlay + '), url(' + data.url + ') no-repeat fixed !important;' +
        'background-size: auto, ' + w + 'px ' + h + 'px !important;' +
        'background-position: 0 0, 0 0 !important; }' +
        '.shell { background: transparent !important; }';
    };
    if (apiAny && typeof apiAny.onShellBackground === 'function') apiAny.onShellBackground(applyBg);
    if (apiAny && typeof apiAny.getShellBackground === 'function') {
      apiAny.getShellBackground().then((r: any) => { if (r && r.success) applyBg(r.background); }).catch(() => {});
    }
    if (apiAny && typeof apiAny.listPluginShellStyles === 'function') {
      apiAny.listPluginShellStyles().then((r: any) => {
        if (!r || !r.success || !Array.isArray(r.styles)) return;
        for (const s of r.styles) { try { applyShellStyle(s.pluginId, s.css); } catch (_) {} }
      }).catch(() => {});
    }
    if (apiAny && typeof apiAny.onPluginShellMount === 'function') {
      apiAny.onPluginShellMount((m: MountSpec) => {
        try {
          wlog.__shellMountLog.received.push(m && m.target + ':' + (m && m.id));
          if (!m || !m.target) return;
          if (m.target === 'statusbar') mountStatusbar(m);
          else if (m.target === 'toolbar') mountToolbar(m);
          else if (m.target === 'sidebar') mountSidebar(m);
        } catch (_) {}
      });
    }
    // 卸载：移除某插件（或某挂载点）的 DOM
    if (apiAny && typeof apiAny.onPluginShellUnmount === 'function') {
      apiAny.onPluginShellUnmount((m: any) => {
        try { unmountPlugin(m && m.pluginId, m && m.target, m && m.id); } catch (_) {}
      });
    }
    if (apiAny && typeof apiAny.listPluginShellMounts === 'function') {
      apiAny.listPluginShellMounts().then((r: any) => {
        wlog.__shellMountLog.pulled = r;
        if (!r || !r.success || !Array.isArray(r.mounts)) return;
        for (const m of r.mounts) {
          try {
            if (m.target === 'statusbar') mountStatusbar(m);
            else if (m.target === 'toolbar') mountToolbar(m);
            else if (m.target === 'sidebar') mountSidebar(m);
          } catch (_) {}
        }
      }).catch(() => {});
    }
    // 通用槽位（对标 DSH slots）
    if (apiAny && typeof apiAny.onPluginSlotRegister === 'function') {
      apiAny.onPluginSlotRegister((m: any) => { try { mountSlot(m); } catch (_) {} });
    }
    if (apiAny && typeof apiAny.onPluginSlotUnregister === 'function') {
      apiAny.onPluginSlotUnregister((m: any) => {
        try { const k = m.pluginId + ':' + m.slot + ':' + m.id; const el = document.querySelector('[data-slot-key="' + k + '"]'); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
      });
    }
    if (apiAny && typeof apiAny.listPluginSlots === 'function') {
      apiAny.listPluginSlots().then((r: any) => { if (r && r.success && Array.isArray(r.slots)) { for (const m of r.slots) { try { mountSlot(m); } catch (_) {} } } }).catch(() => {});
    }
  } catch (_) {}
}

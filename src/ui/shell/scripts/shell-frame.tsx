/**
 * React 版壳框架（feat/shell-react）
 *
 * React 接管整个侧栏（活动栏 + 面板），旧的原生结构隐藏。
 * 逐页面迁移：每迁一个，注册一个页面组件。
 *
 * 复用现有 CSS class（.ck-activitybar / .ck-panel / .ck-panel-body / .ck-ab-item）。
 */
import { createElement, useState, useMemo, useEffect, Component, useCallback, useSyncExternalStore, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { api } from './shared.js';
import { SettingsModal } from './pages/settings-react.js';
import { subscribeSlots, getSlotItems, reloadDshClients } from './dsh-client-runtime.js';

const SIDEBAR_COLLAPSED = 46;
const MIN_WIDTH = 320;
const MAX_WIDTH = 4000;
const WIDTH_KEY = 'cuckoo-sidebar-width';

/** 读持久化宽度 */
function savedWidth(): number {
  try { const v = Number(localStorage.getItem(WIDTH_KEY)); if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return Math.round(v); } catch (_) {}
  return 320;
}

/** 展开侧栏（若收起）：恢复宽度，并通知主进程重排 */
function expandSidebar(): void {
  const sidebar = document.getElementById('ck-sidebar');
  if (!sidebar || !sidebar.classList.contains('ck-collapsed')) return;
  sidebar.classList.remove('ck-collapsed');
  const w = savedWidth();
  sidebar.style.width = w + 'px';
  try { if (api.toggleSidebar) api.toggleSidebar(w); } catch (_) {}
}

/** 收起侧栏 */
function collapseSidebar(): void {
  const sidebar = document.getElementById('ck-sidebar');
  if (!sidebar || sidebar.classList.contains('ck-collapsed')) return;
  sidebar.classList.add('ck-collapsed');
  sidebar.style.width = '';
  try { if (api.toggleSidebar) api.toggleSidebar(SIDEBAR_COLLAPSED); } catch (_) {}
}

/** 活动栏 tab 定义 */
interface TabDef { id: string; title: string; icon: string | { text: string }; }

const TABS: TabDef[] = [
  { id: 'home', title: '主页', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
  { id: 'workspaces', title: '工作区（会话）', icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { id: 'files', title: '项目文件', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6' },
  { id: 'snippets', title: '提示词', icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { id: 'skills', title: '技能', icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
  { id: 'plugins', title: '插件', icon: 'M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.2 2.2 0 0 1 0 4.4H2V19a2 2 0 0 0 2 2h3.8v-1.5a2.2 2.2 0 0 1 4.4 0V21H18a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z' },
  { id: 'agents', title: '子代理', icon: 'M3 8h18v12H3zM12 8V4' },
  { id: 'mcp', title: 'MCP（连接器）', icon: 'M9 12h6M8 7H7a5 5 0 0 0 0 10h1M16 7h1a5 5 0 0 1 0 10h-1' },
  { id: 'windows', title: '窗口', icon: 'M3 3h18v18H3zM3 9h18M9 21V9' },
  { id: 'token', title: 'Token（词元）', icon: { text: '元' } },
];

const BOTTOM_TABS: TabDef[] = [
  { id: 'about', title: '关于', icon: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 16v-4M12 8h.01' },
  { id: 'feishu', title: '飞书同步（手机）', icon: 'M5 2h14v20H5zM11 18h2' },
];

/** 设置图标（打开全屏模态，不是 tab） */
const SETTINGS_ICON = 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0';

/** 页面组件表 */
const PAGES: Record<string, () => any> = {};

/** 注册页面组件 */
export function registerPage(id: string, comp: () => any): void { PAGES[id] = comp; }

/** 包装 DSH main 插槽组件：造它要的 hooks（usePluginManager / useConfigLedger / renderSlot） */
function MainSlotPage({ item }: { item: any }) {
  const C = item.Component;
  const face = item.injectedProps || {};
  const t = item.t || ((k: string) => k);
  const pmStore = face && face.hooks ? face.hooks.pluginManager : undefined;
  const clStore = face && face.hooks ? face.hooks.configLedger : undefined;
  // usePluginManager(selector) → 用 useSyncExternalStore 桥接快照 store
  const usePluginManager = useCallback((selector: any) => {
    return useSyncExternalStore(
      (cb: any) => (pmStore && typeof pmStore.subscribe === 'function') ? pmStore.subscribe(cb) : () => {},
      () => {
        const s = pmStore ? pmStore.getSnapshot() : { status: 'idle', packages: [], busy: [], notice: null, install: {}, confirm: null, highlight: null };
        return selector ? selector(s) : s;
      },
    );
  }, [pmStore]);
  const useConfigLedger = useCallback((selector: any) => {
    return useSyncExternalStore(
      (cb: any) => (clStore && typeof clStore.subscribe === 'function') ? clStore.subscribe(cb) : () => {},
      () => {
        const s = clStore ? clStore.getSnapshot() : { items: [], bundles: new Set(), rows: new Set() };
        return selector ? selector(s) : s;
      },
    );
  }, [clStore]);
  // P5：renderSlot 真渲染子插槽
  // 签名：renderSlot(slotName, ownerProps?, opts?) → ReactNode
  //   opts.only     → list 类型：只渲染指定 id
  //   opts.entryKey → keyed 类型：选择 key
  //   opts.fallback → 空时回退
  const renderSlot = useCallback((slotName: string, ownerProps?: any, opts?: any) => {
    try {
      const items = getSlotItems(slotName);
      let filtered = items;
      // DSH 契约：opts.only（list）、opts.entryKey（keyed）
      if (opts && opts.only !== undefined) filtered = items.filter((it: any) => it.id === opts.only);
      else if (opts && opts.entryKey !== undefined) filtered = items.filter((it: any) => it.id === opts.entryKey || (it.spec && it.spec.key === opts.entryKey));
      if (!filtered.length) return (opts && opts.fallback) || null;
      return createElement(Fragment, null, ...filtered.map((it: any, i: number) => {
        const C = it.Component;
        if (typeof C !== 'function') return null;
        const p = Object.assign({}, ownerProps || {}, it.injectedProps || {});
        p.t = it.t || ((k: string) => k);
        return createElement(C, { key: (it.spec && it.spec.key) || it.key || ('slot-' + i), ...p });
      }));
    } catch (e) {
      console.error('[dsh-slot] renderSlot(' + slotName + ') 失败', e);
      return null;
    }
  }, []);
  const props: any = { ...face, usePluginManager, useConfigLedger, renderSlot, t };
  return createElement(C, props);
}

/** 错误边界：Page 组件崩溃不影响整个侧栏 */
class PageErrorBoundary extends Component<{ children?: any }, { err: string | null }> {
  constructor(props: any) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e: any) { return { err: (e && e.message) ? e.message : String(e) }; }
  componentDidCatch(e: any, info: any) {
    console.error('[dsh-page] Page 崩溃', e);
    if (info && info.componentStack) console.error('[dsh-page] 组件栈:', String(info.componentStack).slice(0, 1500));
  }
  render() {
    if (this.state.err) {
      return createElement('div', { style: { padding: 16, color: '#e55' } },
        createElement('div', { style: { fontWeight: 700, marginBottom: 8 } }, '⚠ 页面组件崩溃'),
        createElement('div', { style: { fontSize: 12, color: '#888', whiteSpace: 'pre-wrap' } }, this.state.err));
    }
    return (this as any).props.children;
  }
}

/** 图标 */
function Icon({ icon }: { icon: TabDef['icon'] }) {
  if (typeof icon === 'object' && 'text' in icon) return createElement('span', { className: 'ck-ab-text' }, icon.text);
  return createElement('svg', { className: 'ck-ab-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d: icon }));
}

/** 活动栏按钮 */
function AbButton({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  return createElement('button', { className: 'ck-ab-item' + (active ? ' ck-ab-active' : ''), title: tab.title, onClick }, createElement(Icon, { icon: tab.icon }));
}

/** 主框架 */
function ShellFrame() {
  const [activeTab, setActiveTab] = useState('home');
  // DSH main 插槽面板 id（独立于 activeTab——侧栏不切，只在 .viewport 显示）
  const [mainPanelId, setMainPanelId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // P3：DSH main 插槽注册的组件（按 key 匹配 activeTab）
  const [mainSlotItems, setMainSlotItems] = useState<any[]>([]);
  useEffect(() => {
    const refresh = () => setMainSlotItems(getSlotItems('main'));
    refresh();
    return subscribeSlots(refresh);
  }, []);
  // HMR：主进程通知"重载 DSH client"（插件启用/禁用后）
  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.onCuckooReload) {
      anyApi.onCuckooReload((data: any) => { void reloadDshClients(data && data.pluginId, data ? data.enabled : undefined); });
    }
  }, []);
  // 桥接：dsh-client-runtime 的 ctx.layout.selectPanel(id) → setActiveTab
  useEffect(() => {
    (window as any).__cuckooSelectPanel = (id: string | null) => {
      if (id) {
        const sidebar = document.getElementById('ck-sidebar');
        if (sidebar && sidebar.classList.contains('ck-collapsed')) expandSidebar();
      }
      setMainPanelId(id);
    };
    return () => { try { delete (window as any).__cuckooSelectPanel; } catch (_) {} };
  }, []);
  // DSH main 插槽组件（按 id === mainPanelId 匹配）
  const mainSlotItem = useMemo(() => mainSlotItems.find((m: any) => m.id === mainPanelId), [mainSlotItems, mainPanelId]);
  const isMainSlotActive = !!(mainSlotItem && mainSlotItem.Component);
  // 常规页面（侧栏里渲染）
  const Page = useMemo(() => PAGES[activeTab], [activeTab]);
  // DSH main 插槽激活时：隐藏 AI view（让 .viewport 露出来）
  useEffect(() => {
    const anyApi = api as any;
    if (isMainSlotActive) {
      if (anyApi.setAiViewVisible) anyApi.setAiViewVisible(false).catch(() => {});
    } else {
      if (anyApi.setAiViewVisible) anyApi.setAiViewVisible(true).catch(() => {});
    }
  }, [isMainSlotActive]);
  // DSH main 插槽内容 → Portal 到 .viewport（和 AI 网页同位置）
  const viewportEl = useMemo(() => document.querySelector('.viewport'), []);
  // 关闭 DSH 主面板（回 AI view）
  const closeMainPanel = () => { setMainPanelId(null); };
  const mainOverlay = (isMainSlotActive && viewportEl)
    ? createPortal(
        createElement('div', {
          style: { position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--ck-bg, #fff)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', paddingTop: 48 },
        },
          // 关闭按钮（右上角浮层，悬浮于插件页内容之上）
          createElement('button', {
            type: 'button',
            title: '关闭',
            'aria-label': '关闭',
            onClick: closeMainPanel,
            style: {
              position: 'absolute', top: 10, left: 12, zIndex: 10,
              width: 28, height: 28, borderRadius: 8, border: '1px solid var(--ck-border, #e5e7eb)',
              background: 'var(--ck-bg, #fff)', color: 'var(--ck-text-2, #666)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            },
          },
            createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
              createElement('path', { d: 'M18 6L6 18' }),
              createElement('path', { d: 'M6 6l12 12' }),
            ),
          ),
          createElement(PageErrorBoundary, null, createElement(MainSlotPage, { item: mainSlotItem }))),
        viewportEl as Element)
    : null;
  const onTabClick = (id: string) => {
    // 活动栏 tab → 关闭 DSH 主面板（回 AI view）+ 切侧栏页
    setMainPanelId(null);
    const sidebar = document.getElementById('ck-sidebar');
    const collapsed = !!(sidebar && sidebar.classList.contains('ck-collapsed'));
    // 收起态 → 展开并切页
    if (collapsed) { expandSidebar(); setActiveTab(id); return; }
    // 已激活的图标 → 收起（VS Code 行为）
    if (id === activeTab) { collapseSidebar(); return; }
    setActiveTab(id);
  };
  // 点"设置"→ 打开全屏模态（若侧栏收起则先展开）
  const onSettingsClick = () => {
    const sidebar = document.getElementById('ck-sidebar');
    if (sidebar && sidebar.classList.contains('ck-collapsed')) expandSidebar();
    setSettingsOpen(true);
  };
  return createElement('div', { style: { display: 'contents' } },
    createElement('div', { className: 'ck-activitybar' },
      TABS.map((t) => createElement(AbButton, { key: t.id, tab: t, active: activeTab === t.id, onClick: () => onTabClick(t.id) })),
      createElement('div', { className: 'ck-ab-spacer' }),
      BOTTOM_TABS.map((t) => createElement(AbButton, { key: t.id, tab: t, active: activeTab === t.id, onClick: () => onTabClick(t.id) })),
      // 设置：打开全屏模态
      createElement('button', { className: 'ck-ab-item', title: '设置', onClick: onSettingsClick },
        createElement('svg', { className: 'ck-ab-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          createElement('circle', { cx: 12, cy: 12, r: 3 }),
          createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }))),
    ),
    createElement('div', { className: 'ck-panel' },
      createElement('div', { className: 'ck-panel-body' },
        Page
          ? createElement(PageErrorBoundary, null, createElement(Page))
          : createElement('div', { style: { padding: 12, color: '#888' } }, '页面「' + activeTab + '」尚未重写'),
      ),
    ),
    // DSH main 插槽内容（Portal 到 .viewport）
    mainOverlay,
    // 设置模态（Portal 挂到 body，全窗遮罩 + 居中对话框）
    settingsOpen ? createPortal(
      createElement(SettingsModal, { onClose: () => setSettingsOpen(false) }),
      document.body,
    ) : null,
  );
}

/** 挂载（幂等）：React 接管整个侧栏，旧的原生结构整体隐藏 */
export function mountShellFrame(): void {
  const sidebar = document.getElementById('ck-sidebar');
  if (!sidebar) return;
  // 1) 旧的原生结构：从 DOM 里【移除】（不是隐藏——隐藏时 ID 还在，getElementById 会拿到旧元素，造成 ID 冲突）
  if (!sidebar.dataset.ckOldRemoved) {
    // 1a) 先把"通用弹窗"移出到 body（ckPrompt/ckAlert 等依赖，不能删）
    //     它们在 partials/modals.html 里，本被包在侧栏内。
    ['ck-dialog', 'input-modal', 'wg-modal', 'init-prompt-modal', 'snip-modal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentNode !== document.body) { try { document.body.appendChild(el); } catch (_) {} }
    });
    // 1b) 其余"非 React 挂载点"的子节点移除
    const keep = document.getElementById('ck-shell-react');
    [...sidebar.childNodes].forEach((n) => {
      if (n !== keep) { try { sidebar.removeChild(n); } catch (_) {} }
    });
    sidebar.dataset.ckOldRemoved = '1';
  }
  // 2) React 挂载点
  let host = document.getElementById('ck-shell-react');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ck-shell-react';
    host.style.cssText = 'display:contents;';
    sidebar.appendChild(host);
  }
  if ((host as any).__root) return;
  const root = createRoot(host);
  (host as any).__root = root;
  root.render(createElement(ShellFrame));

  // 拖拽调宽：在侧栏右侧插一个 resizer（原生 DOM，不进 React 树）
  if (!(sidebar as any).__resizerAdded) {
    const resizer = document.createElement('div');
    resizer.className = 'ck-sidebar-resizer';
    resizer.title = '拖动调整宽度';
    sidebar.appendChild(resizer);
    resizer.addEventListener('mousedown', (e: any) => {
      if (sidebar.classList.contains('ck-collapsed')) return;
      e.preventDefault();
      try { if (api.startSidebarDrag) api.startSidebarDrag(); } catch (_) {}
    });
    (sidebar as any).__resizerAdded = true;
  }
  // 拖拽中：主进程推来实时宽度
  if (!(sidebar as any).__dragWired && api.onSidebarDrag) {
    api.onSidebarDrag((w: number) => {
      if (typeof w !== 'number' || !Number.isFinite(w)) return;
      const nw = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
      try { localStorage.setItem(WIDTH_KEY, String(nw)); } catch (_) {}
      if (!sidebar.classList.contains('ck-collapsed')) sidebar.style.width = nw + 'px';
    });
    (sidebar as any).__dragWired = true;
  }
  // 松开鼠标 → 结束拖拽
  if (!(document as any).__dragEndWired) {
    document.addEventListener('mouseup', () => { try { if (api.endSidebarDrag) api.endSidebarDrag(); } catch (_) {} });
    (document as any).__dragEndWired = true;
  }
}

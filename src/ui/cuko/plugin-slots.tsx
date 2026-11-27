/**
 * [261125-p3vk8w-cuko-plugin-slots] Cuko 窗口的 DSH 插件插槽
 *
 * - CukoSidebarPanels   侧边栏 sidebar.panellist（「新对话」下方）
 * - CukoSidebarFooter   侧边栏 sidebar.footer.action（「请求日志」上方）
 * - CukoMainPanel       点面板条目后打开的 main 面板（盖在对话区上，左上角关闭）
 *
 * 与老页面共用 dsh-client-runtime、components/sidebar-slots.tsx、components/main-slot-page.tsx；
 * 没有插件时只留不可见的 data-slot 挂载点，侧边栏外观不变。
 * 详见 docs/requirements/261125-p3vk8w-cuko-plugin-slots.md
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadDshClients, reloadDshClients, subscribeSlots, getSlotItems } from '@/ui/shell/scripts/dsh-client-runtime';
import { PANEL_SLOT, FOOTER_SLOT, useDshSlot, renderSidebarSlotItem, type SidebarSlotItemOptions } from '@/ui/shell/scripts/components/sidebar-slots';
import { MainSlotPage } from '@/ui/shell/scripts/components/main-slot-page';
import { SlotErrorBoundary } from '@/ui/shell/scripts/components/slot-error-boundary';

const MAIN_SLOT = 'main';
/** [261125-bmsfsh] DSH 全屏浮层槽位（dsh-purge 的 dock / 弹窗都挂这里） */
export const OVERLAY_SLOT = 'shell.overlay';
/** [261125-bmsfsh] 会话头部工具位（dsh-purge 的 RedTeam 按钮） */
export const SESSION_HEADER_SLOT = 'conversation.session.header.utilities';
/** [261125-bmsfsh] 输入框右侧位（dsh-purge 的 rewind 按钮） */
export const INPUT_RIGHT_SLOT = 'conversation.input.right';

// ===== 当前打开的 main 面板（模块级小 store：侧边栏与对话区共用）=====
let activePanelId: string | null = null;
const panelSubs = new Set<() => void>();
export function selectPluginPanel(id: string | null): void {
  activePanelId = id || null;
  for (const f of [...panelSubs]) { try { f(); } catch (_) { /* ignore */ } }
}
function subscribePanel(cb: () => void): () => void {
  panelSubs.add(cb);
  return () => { panelSubs.delete(cb); };
}
function usePluginPanelId(): string | null {
  return useSyncExternalStore(subscribePanel, () => activePanelId);
}

// ===== DSH client 运行时（整个窗口只启动一次）=====
let started = false;
function ensureDshClients(): void {
  if (started) return;
  started = true;
  const anyApi = (window as any).shellAPI || {};
  // 插件 ctx.layout.selectPanel(id) 走这个桥（老页面在 shell-frame 里挂）
  (window as any).__cuckooSelectPanel = (id: string | null) => selectPluginPanel(id);
  // 让主进程把插槽注册 / 注销也推给本窗口
  if (typeof anyApi.pluginSlotSubscribe === 'function') anyApi.pluginSlotSubscribe().catch(() => {});
  // 插件启用 / 禁用后重载 client
  if (typeof anyApi.onCuckooReload === 'function') {
    anyApi.onCuckooReload((d: any) => { void reloadDshClients(d && d.pluginId, d ? d.enabled : undefined); });
  }
  loadDshClients().catch((e: any) => console.error('[cuko-dsh] 加载插件 client 失败', e));
}

function invokeCommand(spec: any): void {
  const anyApi = (window as any).shellAPI || {};
  if (spec && spec.command && typeof anyApi.commandInvoke === 'function') anyApi.commandInvoke(spec.command).catch(() => {});
}

const ITEM_OPTS: SidebarSlotItemOptions = {
  onSelectPanel: (id) => selectPluginPanel(id),
  onInvokeCommand: invokeCommand,
  className: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  style: { display: 'flex', width: '100%', textAlign: 'left' },
};

/** sidebar.panellist：「新对话」下方的插件面板按钮 */
export function CukoSidebarPanels() {
  useEffect(() => { ensureDshClients(); }, []);
  const items = useDshSlot(PANEL_SLOT);
  if (!items.length) return <div data-slot={PANEL_SLOT} style={{ display: 'contents' }} />;
  return (
    <div data-slot={PANEL_SLOT} className="flex flex-col gap-0.5 border-b px-2 py-2">
      {items.map((m) => renderSidebarSlotItem(m, ITEM_OPTS))}
    </div>
  );
}

/** sidebar.footer.action：「请求日志」上方的插件底部动作 */
export function CukoSidebarFooter() {
  useEffect(() => { ensureDshClients(); }, []);
  const items = useDshSlot(FOOTER_SLOT);
  if (!items.length) return <div data-slot={FOOTER_SLOT} style={{ display: 'contents' }} />;
  return (
    <div data-slot={FOOTER_SLOT} className="flex flex-col gap-0.5 border-t p-2">
      {items.map((m) => renderSidebarSlotItem(m, ITEM_OPTS))}
    </div>
  );
}

/**
 * [261125-bmsfsh] shell.overlay：全屏浮层挂载点。
 *
 * 语义对齐 DSH 的 AppFrame overlayLayer：整屏、最高层、不参与布局。
 * - 容器 pointer-events-none：空容器不挡下面任何点击（没插件时界面不变）
 * - 每个条目包一层 pointer-events-auto：插件自己的浮层才可交互
 */
export function CukoOverlayLayer() {
  useEffect(() => { ensureDshClients(); }, []);
  const items = useDshSlot(OVERLAY_SLOT);
  if (!items.length) return <div data-slot={OVERLAY_SLOT} style={{ display: 'contents' }} />;
  return (
    <div
      data-slot={OVERLAY_SLOT}
      className="pointer-events-none fixed inset-0 z-50 flex flex-col"
      style={{ display: items.length ? undefined : 'contents' }}
    >
      {items.map((m: any) => {
        const C = m.Component;
        if (typeof C !== 'function') return null;
        let injected: any = {};
        try { if (m.spec && typeof m.spec.inject === 'function') injected = m.spec.inject({}) || {}; } catch (_) { /* ignore */ }
        const t = (typeof m.t === 'function') ? m.t : ((k: string) => k);
        return (
          <div key={m.key} className="pointer-events-auto" data-slot-item={m.id}>
            <SlotErrorBoundary label="插件浮层">
              <C {...injected} t={t} />
            </SlotErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}

/**
 * [261125-bmsfsh] 会话作用域槽位的通用渲染器。
 *
 * DSH 语义：这类槽位按会话挂载，注册时的 `spec.inject` 是
 * `(sessionId) => ({ sessionId, t, ... })` —— 参数（scope 目标）必须传进去，
 * 否则插件拿到的 sessionId 是 undefined（dsh-purge 的 rewind 按钮就是这样）。
 */
function renderSessionSlotItems(items: any[], sessionId: string, label: string) {
  return items.map((m: any) => {
    const C = m.Component;
    if (typeof C !== 'function') return null;
    let injected: any = {};
    try {
      if (m.spec && typeof m.spec.inject === 'function') injected = m.spec.inject(sessionId) || {};
      else if (m.injectedProps) injected = m.injectedProps;
    } catch (e) { console.error('[cuko-dsh] slot inject 失败 ' + m.id, e); }
    const t = (typeof m.t === 'function') ? m.t : ((k: string) => k);
    return (
      <SlotErrorBoundary key={m.key} label={label}>
        <C {...injected} sessionId={sessionId} t={t} />
      </SlotErrorBoundary>
    );
  });
}

/** [261125-bmsfsh] 空槽也保留 data-slot 挂载点（外观不变，但可探测） */
function EmptySlotMark({ slot }: { slot: string }) {
  return <div data-slot={slot} style={{ display: 'contents' }} />;
}

/**
 * [261125-bmsfsh] conversation.session.header.utilities：会话头部工具位。
 * 落在 Cuko 右侧对话区顶部的工具条里（dsh-purge 的 RedTeam 按钮）。
 */
export function CukoSessionHeaderUtilities({ sessionId }: { sessionId: string }) {
  useEffect(() => { ensureDshClients(); }, []);
  const items = useDshSlot(SESSION_HEADER_SLOT);
  if (!items.length) return <EmptySlotMark slot={SESSION_HEADER_SLOT} />;
  return (
    <div data-slot={SESSION_HEADER_SLOT} className="flex items-center gap-1">
      {renderSessionSlotItems(items, sessionId, '插件头部按钮')}
    </div>
  );
}

/**
 * [261125-bmsfsh] conversation.input.right：输入框右侧位。
 * Cuko 的输入框是 assistant-ui 的 Composer，通过 ComposerSlotsContext.extra 注入。
 */
export function CukoInputRight({ sessionId }: { sessionId: string }) {
  useEffect(() => { ensureDshClients(); }, []);
  const items = useDshSlot(INPUT_RIGHT_SLOT);
  if (!items.length) return <EmptySlotMark slot={INPUT_RIGHT_SLOT} />;
  return (
    <div data-slot={INPUT_RIGHT_SLOT} className="flex items-center gap-1">
      {renderSessionSlotItems(items, sessionId, '插件输入区按钮')}
    </div>
  );
}

/** main 面板：盖在对话区上（父元素需 relative） */
export function CukoMainPanel() {
  useEffect(() => { ensureDshClients(); }, []);
  const panelId = usePluginPanelId();
  const [mainItems, setMainItems] = useState<any[]>([]);
  useEffect(() => {
    const refresh = () => setMainItems(getSlotItems(MAIN_SLOT));
    refresh();
    return subscribeSlots(refresh);
  }, []);
  const item = panelId ? mainItems.find((m: any) => m.id === panelId) : undefined;
  if (!item || !item.Component) return null;
  return (
    <div data-slot={MAIN_SLOT} className="absolute inset-0 z-20 flex flex-col overflow-auto bg-background" style={{ paddingTop: 48 }}>
      <button
        type="button"
        title="关闭"
        aria-label="关闭"
        onClick={() => selectPluginPanel(null)}
        className="absolute left-3 top-2.5 z-10 flex size-7 items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-sm hover:text-foreground"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
      <SlotErrorBoundary label="插件面板">
        <MainSlotPage item={item} />
      </SlotErrorBoundary>
    </div>
  );
}

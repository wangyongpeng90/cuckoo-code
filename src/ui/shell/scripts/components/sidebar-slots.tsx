/**
 * [261125-p3vk8w-cuko-plugin-slots] 侧边栏插件插槽（老页面主页 + Cuko 窗口共用）
 *
 * - sidebar.panellist      插件面板按钮列表
 * - sidebar.footer.action  侧栏底部动作
 *
 * 条目两路来源：
 * ① 本地 DSH client 注册的 React 组件（dsh-client-runtime 的 getSlotItems / subscribeSlots）
 * ② 主进程 host 注册的条目（plugin-slot-list 全量 + shell-slot-register / shell-slot-unregister 增量）
 *
 * 从 pages/home-react.tsx 原样抽出，老页面行为不变；
 * 只多了 options（点击回调、样式），让 Cuko 窗口用自己的样式和面板打开方式。
 * 详见 docs/requirements/261125-p3vk8w-cuko-plugin-slots.md
 */
import { createElement, useState, useEffect, Component } from 'react';
import { api } from '../shared.js';
import { subscribeSlots, getSlotItems } from '../dsh-client-runtime.js';

export const PANEL_SLOT = 'sidebar.panellist';
export const FOOTER_SLOT = 'sidebar.footer.action';

/** 错误边界：单个插件组件崩溃不影响整个侧栏 */
export class SidebarSlotBoundary extends Component<{ children?: any }, { err: string | null }> {
  constructor(props: any) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e: any) { return { err: (e && e.message) ? e.message : String(e) }; }
  componentDidCatch(e: any) { console.error('[dsh-slot] 组件崩溃', e); }
  render() {
    if (this.state.err) {
      return createElement('span', { title: '插件组件崩溃：' + this.state.err, style: { color: '#e55', fontSize: 11 } }, '⚠ 插件出错');
    }
    return (this as any).props.children;
  }
}

/** 取 spec 上的文案（label 可能是函数） */
export function sidebarSpecLabel(spec: any, fallback: string): string {
  if (!spec) return fallback;
  const pick = (v: any) => {
    if (typeof v === 'function') { try { return v(); } catch (_) { return null; } }
    return v;
  };
  return String(pick(spec.label) || pick(spec.text) || pick(spec.title) || fallback);
}

/**
 * 订阅某个槽位（本地 client + 主进程 host 两路）。
 *
 * [261125-bmsfsh] 逻辑与槽位名无关，泛化成 useDshSlot；
 * useSidebarSlot 保留为别名（老页面 / 已有调用点不用改）。
 */
export function useDshSlot(slotName: string): any[] {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    const anyApi = api as any;
    // ① 本地（DSH client 注册的 React 组件）
    const refreshLocal = () => {
      const local = getSlotItems(slotName).map((s: any) => ({ kind: 'client', key: 'c:' + s.key, spec: s.spec, Component: s.Component, id: s.id, pluginId: s.pluginId, t: s.t }));
      setItems((prev) => {
        const host = prev.filter((x: any) => x.kind === 'host');
        return [...local, ...host];
      });
    };
    refreshLocal();
    const unsub = subscribeSlots(refreshLocal);
    // ② 主进程 host 侧
    const isMine = (m: any) => !!(m && m.slot === slotName);
    const keyOf = (m: any) => m.pluginId + ':' + m.slot + ':' + m.id;
    if (anyApi.listPluginSlots) {
      anyApi.listPluginSlots().then((r: any) => {
        if (!r || !r.success || !Array.isArray(r.slots)) return;
        const host = r.slots.filter(isMine).map((m: any) => ({ kind: 'host', key: 'h:' + keyOf(m), spec: m.spec, id: m.id, pluginId: m.pluginId, order: m.order }));
        setItems((prev) => [...prev.filter((x: any) => x.kind === 'client'), ...host]);
      }).catch(() => {});
    }
    if (anyApi.onPluginSlotRegister) {
      anyApi.onPluginSlotRegister((m: any) => {
        if (!isMine(m)) return;
        setItems((prev) => {
          const k = 'h:' + keyOf(m);
          const next = prev.filter((x: any) => x.key !== k);
          next.push({ kind: 'host', key: k, spec: m.spec, id: m.id, pluginId: m.pluginId, order: m.order });
          return next;
        });
      });
    }
    if (anyApi.onPluginSlotUnregister) {
      anyApi.onPluginSlotUnregister((m: any) => {
        if (!isMine(m)) return;
        setItems((prev) => prev.filter((x: any) => !(x.kind === 'host' && x.pluginId === m.pluginId && x.id === m.id)));
      });
    }
    return unsub;
  }, [slotName]);
  return items;
}

/** 历史名（sidebar 专用调用点）：等价于 useDshSlot */
export const useSidebarSlot = useDshSlot;

export interface SidebarSlotItemOptions {
  /** 条目没有 command 时点击：打开 id 对应的 main 面板 */
  onSelectPanel: (id: string) => void;
  /** 条目带 command 时点击：执行插件命令 */
  onInvokeCommand: (spec: any) => void;
  /** 条目 class，缺省为老页面的 ck-btn ck-btn-anim */
  className?: string;
  /** 追加到条目上的内联样式（覆盖缺省值） */
  style?: Record<string, any>;
}

/** 渲染一个槽位条目（有组件 → div 包组件；无组件 → 按钮 + 文案） */
export function renderSidebarSlotItem(m: any, opts: SidebarSlotItemOptions): any {
  const label = sidebarSpecLabel(m.spec, m.id);
  const C = m.Component;
  // 组装组件 props：ownerProps + inject face + t
  let injected: any = {};
  try {
    if (m.spec && typeof m.spec.inject === 'function') injected = m.spec.inject({}) || {};
  } catch (e) { /* ignore */ }
  const t = (typeof m.t === 'function') ? m.t : ((k: string) => k);
  const props: any = { wide: true, ...injected };
  props.t = t;
  // 组件自带的文字（若 spec 没有 label/text/title，则不显示额外文字）
  const showLabel = !!(m.spec && (m.spec.label || m.spec.text || m.spec.title));
  // DSH 语义：sidebar.panellist 项有 id → 点击切 main 面板
  const hasCommand = !!(m.spec && m.spec.command);
  const panelId = m.id;
  const onClick = hasCommand ? (() => opts.onInvokeCommand(m.spec)) : (() => opts.onSelectPanel(panelId));
  const className = opts.className || 'ck-btn ck-btn-anim';
  const title = (m.spec && m.spec.title) ? String(m.spec.title) : label;
  // 有组件 → 用 div 包（避免 <button> 嵌 <button>）；无组件 → 用 button
  if (C) {
    return createElement('div', {
      key: m.key,
      className,
      title,
      onClick,
      style: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', ...(opts.style || {}) },
    },
      createElement('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
        createElement(SidebarSlotBoundary, null, createElement(C, props))),
      showLabel ? createElement('span', null, label) : null,
    );
  }
  return createElement('button', {
    key: m.key,
    className,
    title,
    onClick,
    style: { flex: '0 0 auto', ...(opts.style || {}) },
  }, createElement('span', null, label));
}

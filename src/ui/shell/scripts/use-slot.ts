/**
 * 订阅 DSH 插槽（本地 client 注册 + 主进程 host 注册）的 React Hook。
 */
import { createElement, useState, useEffect } from 'react';
import { api } from './shared.js';
import { subscribeSlots, getSlotItems } from './dsh-client-runtime.js';

export interface SlotEntry {
  kind: 'client' | 'host';
  key: string;
  id: string;
  pluginId: string;
  spec: any;
  Component?: any;
  t?: (k: string) => string;
  order?: number;
  /** DSH 依赖注入面（spec.inject 的解析结果） */
  injectedProps?: any;
}

/** 订阅某个插槽下的所有项（client 组件 + host 文字） */
export function useSlot(slotName: string): SlotEntry[] {
  const [items, setItems] = useState<SlotEntry[]>([]);
  useEffect(() => {
    const anyApi = api as any;
    const keyOf = (m: any) => m.pluginId + ':' + m.slot + ':' + m.id;
    const isMine = (m: any) => !!(m && m.slot === slotName);

    const localItems = (): SlotEntry[] => getSlotItems(slotName).map((s: any) => ({
      kind: 'client' as const, key: 'c:' + s.key, id: s.id, pluginId: s.pluginId,
      spec: s.spec, Component: s.Component, t: s.t, injectedProps: s.injectedProps,
    }));

    const refreshLocal = () => {
      setItems((prev) => [...localItems(), ...prev.filter((x) => x.kind === 'host')]);
    };
    refreshLocal();
    const unsub = subscribeSlots(refreshLocal);

    if (anyApi.listPluginSlots) {
      anyApi.listPluginSlots().then((r: any) => {
        if (!r || !r.success || !Array.isArray(r.slots)) return;
        const host = r.slots.filter(isMine).map((m: any) => ({
          kind: 'host' as const, key: 'h:' + keyOf(m), id: m.id, pluginId: m.pluginId,
          spec: m.spec, order: m.order,
        }));
        setItems([...localItems(), ...host]);
      }).catch(() => {});
    }
    if (anyApi.onPluginSlotRegister) {
      anyApi.onPluginSlotRegister((m: any) => {
        if (!isMine(m)) return;
        setItems((prev) => {
          const k = 'h:' + keyOf(m);
          const next = prev.filter((x) => x.key !== k);
          next.push({ kind: 'host', key: k, id: m.id, pluginId: m.pluginId, spec: m.spec, order: m.order });
          return next;
        });
      });
    }
    if (anyApi.onPluginSlotUnregister) {
      anyApi.onPluginSlotUnregister((m: any) => {
        if (!isMine(m)) return;
        setItems((prev) => prev.filter((x) => !(x.kind === 'host' && x.pluginId === m.pluginId && x.id === m.id)));
      });
    }
    return unsub;
  }, [slotName]);
  return items;
}

/** 取 spec 上的文案（label 可能是函数，DSH 常用 i18n） */
export function specLabel(spec: any, fallback: string): string {
  if (!spec) return fallback;
  const pick = (v: any) => {
    if (typeof v === 'function') { try { return v(); } catch (_) { return null; } }
    return v;
  };
  return String(pick(spec.label) || pick(spec.text) || pick(spec.title) || fallback);
}

/**
 * 渲染一个插件组件，注入 DSH standardProps：
 * - renderSlot(slotName, props)：渲染子插槽（DSH 的插槽嵌套机制）
 * - t / injectedProps / close ...
 */
export function renderPluginElement(item: SlotEntry, extra?: any): any {
  const C = item && item.Component;
  if (!C) return null;

  /**
   * DSH renderSlot：渲染子插槽（对齐 DSH 契约）
   * 签名：renderSlot(slotName, ownerProps?, opts?)
   *   opts.only     → list 类型：只渲染指定 id
   *   opts.entryKey → keyed 类型：只渲染指定 key
   *   opts.fallback → 空时回退
   */
  const renderSlot = (slotName: string, slotProps?: any, opts?: any): any => {
    if (!slotName) return null;
    let items = getSlotItems(slotName);
    // DSH 契约：opts.only / opts.entryKey 过滤
    if (opts && opts.only !== undefined) {
      items = items.filter((it: any) => it.id === opts.only);
    } else if (opts && opts.entryKey !== undefined) {
      items = items.filter((it: any) => it.id === opts.entryKey || (it.spec && it.spec.key === opts.entryKey));
    }
    if (!items.length) return (opts && opts.fallback) || null;
    return createElement('div', { 'data-render-slot': slotName, style: { display: 'contents' } },
      ...items.map((it, i) => {
        const IC = it.Component;
        if (typeof IC !== 'function') return null;
        return createElement(IC, {
          key: (it.spec && it.spec.key) || it.key || (slotName + ':' + i),
          ...(it.injectedProps || {}),
          ...(slotProps || {}),
          renderSlot,
          t: it.t || ((k: string) => k),
        });
      }));
  };

  return createElement(C, {
    ...(item.injectedProps || {}),
    ...(extra || {}),
    renderSlot,
    t: item.t || ((k: string) => k),
  });
}

/**
 * [261125-p3vk8w-cuko-plugin-slots] DSH main 插槽面板（老页面 shell-frame + Cuko 窗口共用）
 * 从 shell-frame.tsx 原样抽出：造插件组件要的 hooks（usePluginManager / useConfigLedger / renderSlot）。
 */
import { createElement, useCallback, useSyncExternalStore, Fragment } from 'react';
import { getSlotItems } from '../dsh-client-runtime.js';

/** 包装 DSH main 插槽组件：造它要的 hooks（usePluginManager / useConfigLedger / renderSlot） */
export function MainSlotPage({ item }: { item: any }) {
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

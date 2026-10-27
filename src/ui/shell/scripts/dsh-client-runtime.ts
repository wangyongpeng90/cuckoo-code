/**
 * DSH client 运行时（feat/022-dsh-compat-c7）
 *
 * 让 DSH 的 ./client 入口（window.__ModuleLoader__.load({ id, factory })）在 Cuckoo 壳页面执行：
 * - window.__ModuleLoader__ + require(react/@deepseek-ai/*)
 * - ctx.slots（inject/register）→ 本地插槽表，各 React 页面消费
 * - ctx.plugin(definition) → 真执行子插件（DSH 聚合插件靠它挂 N 个子插件）
 * - ctx.get(服务名) → 最小服务（sessions/workspaces/locale/layout/remote/connection/...）
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import * as dshPrimitives from './dsh-primitives/index.js';
import * as dshClientStore from './dsh-client-store/index.js';

export interface SlotItem {
  key: string;
  pluginId: string;
  slot: string;
  id: string;
  order: number;
  spec: any;
  Component: any;
  /** i18n 翻译函数（来自 spec.locale） */
  t?: (k: string) => string;
  /** DSH 依赖注入面：spec.inject（函数 → 返回值；数组 → 从服务表取）*/
  injectedProps?: any;
}

const slotTable = new Map<string, SlotItem[]>();
const listeners = new Set<() => void>();
/** 每槽的订阅者（slots.subscribe 用） */
const slotListeners = new Map<string, Set<() => void>>();
/** 每槽的版本号（每次变化 +1，slots.getVersion 用） */
const slotVersions = new Map<string, number>();
/** 每槽的声明（slots.spec 用） */
const slotSpecs = new Map<string, any>();

function notify(): void { for (const cb of listeners) { try { cb(); } catch (_) {} } }

/** 某槽变化：bump 版本 + 通知该槽订阅者 */
function notifySlot(slotName: string): void {
  slotVersions.set(slotName, (slotVersions.get(slotName) || 0) + 1);
  const subs = slotListeners.get(slotName);
  if (subs) for (const cb of [...subs]) { try { cb(); } catch (_) {} }
  notify();
}

/** DSH 条目格式：{ component, options, inject, locale, children, registrant }（对齐 DSH StoredEntry）*/
function toEntry(it: SlotItem): any {
  const s = it.spec || {};
  return {
    // DSH 契约字段（小写 component——dsh-codex-ui 用它拿组件）
    component: it.Component,
    options: { id: it.id, key: s.key !== undefined ? s.key : it.key, order: it.order, label: s.label, priority: s.priority },
    inject: typeof s.inject === 'function' ? s.inject : undefined,
    children: s.children,
    locale: s.locale,
    registrant: it.pluginId,
    // 我们自己的字段（兼容旧用法）
    id: it.id,
    order: it.order,
    spec: s,
    Component: it.Component,
    t: it.t,
    injectedProps: it.injectedProps,
  };
}

/** 投影"胜出者"（entriesOfSlot）：按 kind 去重 */
function entriesOfSlotImpl(slotName: string): any[] {
  const all = (slotTable.get(slotName) || []).slice().sort((a, b) => (a.order || 100) - (b.order || 100));
  const spec = slotSpecs.get(slotName);
  const kind = spec && spec.kind;
  if (kind === 'chain') return all.map(toEntry);
  const heads: any[] = [];
  const seen = new Set<string | undefined>();
  for (const it of all) {
    const cell = kind === 'keyed' ? (it as any).key2 : kind === 'list' ? it.id : undefined;
    const cellKey = String(cell === undefined ? '' : cell);
    if (seen.has(cellKey)) continue;
    seen.add(cellKey);
    heads.push(toEntry(it));
  }
  return heads;
}

/** 订阅插槽变化（React 页面用） */
export function subscribeSlots(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 取某插槽下的所有项（按 order 排序） */
export function getSlotItems(slotName: string): SlotItem[] {
  return (slotTable.get(slotName) || []).slice().sort((a, b) => (a.order || 100) - (b.order || 100));
}

/** 万能 stub（任意属性/调用不抛错） */
function makeStub(name: string): any {
  const fn: any = function () { return p; };
  const p: any = new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === '__esModule') return false;
      if (prop === 'default') return p;
      if (prop === 'toString') return () => '[dsh-client-stub ' + name + ']';
      return makeStub(name + '.' + String(prop));
    },
    apply() { return p; },
    construct() { return p; },
  });
  return p;
}

/**
 * DSH slots 契约：把注册时的 label 解析成字符串（resolveSlotLabel）。
 * label 形态：string | (() => string) | { key } | 本地化对象 { zh, en }
 */
function resolveSlotLabel(label: any): string | undefined {
  if (label === null || label === undefined) return undefined;
  if (typeof label === "string") return label;
  if (typeof label === "number") return String(label);
  if (typeof label === "function") {
    try { const v = label(); return (v === null || v === undefined) ? undefined : String(v); }
    catch (_) { return undefined; }
  }
  if (typeof label === "object") {
    if (typeof (label as any).key === "string") return (label as any).key;
    for (const v of Object.values(label)) { if (typeof v === "string") return v; }
  }
  return undefined;
}

/**
 * @deepseek-ai/dsh-client-ui-slots 兼容层：
 *  - resolveSlotLabel：真实现（插件管理页读 plugins.item 的 label 用）
 *  - 其余导出：stub 兜底（缺哪个都不会崩）
 */
const dshUiSlots: any = new Proxy({ resolveSlotLabel }, {
  get(t: any, prop: string | symbol) {
    if (prop in t) return (t as any)[prop];
    if (prop === "__esModule") return true;
    if (prop === "default") return dshUiSlots;
    if (prop === "then") return undefined;
    return makeStub("dsh-client-ui-slots." + String(prop));
  },
});

/** 占位图标组件（SVG 小方块），供 DSH primitives 的 IconXxx 兜底 */
function makePlaceholderIcon(): any {
  return function PlaceholderIcon(props: any) {
    const size = (props && props.size) || 16;
    return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('rect', { x: 4, y: 4, width: 16, height: 16, rx: 3 }));
  };
}

/** DSH primitives 包 shim：IconXxx → 占位图标组件；其他 → 空组件（不崩）
 *
 * 关键：DSH 插件用 `__toESM(require(...))` 包装——它靠 `Object.getOwnPropertyNames`
 * 遍历属性来复制。纯 Proxy 没 `ownKeys` trap → 遍历为空 → 复制后什么都有没有
 * → dsh-market 的 `missingPrimitives` 检查不过 → 它直接 return（什么都不注册）。
 * 所以这里【预填】必需组件名，并补 ownKeys/getOwnPropertyDescriptor/has trap。
 */
function makePrimitivesShim(): any {
  const cache: Record<string, any> = {};
  const shimObj: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === '__esModule') return true;
      if (prop === Symbol.toStringTag) return 'Module';
      if (prop === 'default') return shimObj;
      const name = String(prop);
      if (name in cache) return cache[name];
      const val = name.startsWith('Icon') ? makePlaceholderIcon() : (function Empty() { return null; });
      cache[name] = val;
      return val;
    },
    /** 让 __toESM 的 Object.getOwnPropertyNames 能"看到"预填的组件 */
    ownKeys() { return Object.keys(cache); },
    getOwnPropertyDescriptor(_t, prop) {
      const name = String(prop);
      if (name in cache) return { enumerable: true, configurable: true, value: cache[name] };
      return undefined;
    },
    has(_t, prop) {
      const name = String(prop);
      if (name in cache) return true;
      return typeof prop === 'string' && !name.startsWith('__');
    },
  });
  // 预填 DSH 插件【必需】的 primitives（dsh-market 检查这 4 个）
  const REQUIRED = ['Menu', 'DisclosureRow', 'Tooltip', 'Toast'];
  for (const n of REQUIRED) cache[n] = function Empty() { return null; };
  return shimObj;
}

/** 最小 store 引擎（DSH @deepseek-ai/dsh-client-store 的简化实现） */
function makeStoreEngine(): any {
  /** defineStore(spec) → { create() }。spec: { init(), actions: { name(draft, ...args) } } */
  function defineStore(spec: any): any {
    const s = spec || {};
    return {
      create() {
        let state = typeof s.init === 'function' ? s.init() : {};
        const subs = new Set<() => void>();
        const notify = () => { for (const fn of [...subs]) { try { fn(); } catch (_) {} } };
        const actions: Record<string, any> = {};
        const src = s.actions || {};
        for (const key of Object.keys(src)) {
          actions[key] = (...args: any[]) => {
            try { src[key](state, ...args); } catch (e) { console.error('[store] action 失败 ' + key, e); }
            notify();
          };
        }
        return {
          getSnapshot: () => state,
          subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
          actions,
        };
      },
    };
  }
  /** 快照 store（简化：同 defineStore） */
  function createSnapshotStore(init?: any): any {
    return defineStore({ init: typeof init === 'function' ? init : () => (init || {}), actions: {} });
  }
  function shallowEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) { if (a[k] !== b[k]) return false; }
    return true;
  }
  return { defineStore, createSnapshotStore, shallowEqual };
}

/** 可被插件 require 的模块表 */
const moduleTable: Record<string, any> = {
  'react': React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': jsxRuntime,
  'react/jsx-dev-runtime': jsxRuntime,
  '@deepseek-ai/dsh-client-ui-primitives': dshPrimitives,
  '@deepseek-ai/dsh-client-store': dshClientStore,
  '@deepseek-ai/dsh-client-runtime/client': dshClientStore,
  '@deepseek-ai/dsh-client-runtime': dshClientStore,
};

const loadedModules: Record<string, any> = {};

// ===== 最小客户端服务（供 ctx.get / inject 使用）=====

/** 可订阅的快照容器（DSH 的 Observable 简化版） */
function makeObservable(initial: any): any {
  let value = initial;
  const subs = new Set<(v: any) => void>();
  return {
    getSnapshot: () => value,
    subscribe(fn: (v: any) => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    set(v: any) { value = v; for (const fn of [...subs]) { try { fn(v); } catch (_) {} } },
  };
}

/** i18n：register(ns,{zh,en}) / bind(ns) → t 函数 / t(key) */
function makeLocale(): any {
  const dicts: Record<string, any> = {};
  let lang = 'zh';
  try { lang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'; } catch (_) {}
  /** 插值：把 "v{version}" + {version:'1.2'} → "v1.2" */
  const interpolate = (v: any, params?: any): string => {
    let out = (v === undefined || v === null) ? '' : String(v);
    if (params && typeof params === 'object') {
      out = out.replace(/\{(\w+)\}/g, (m: string, name: string) => {
        const pv = params[name];
        return (pv === undefined || pv === null) ? m : String(pv);
      });
    }
    return out;
  };
  const lookup = (ns: string, key: string): string => {
    const d = dicts[ns];
    if (!d) return key;
    const pack = d[lang] || d.zh || d.en || {};
    return (pack && pack[key]) || key;
  };
  const t = (key: string, params?: any): string => {
    // 无 ns 时全局找
    for (const ns of Object.keys(dicts)) { const v = lookup(ns, key); if (v !== key) return interpolate(v, params); }
    return interpolate(key, params);
  };
  const localeSubs = new Set<(l: string) => void>();
  // DSH 契约：locale 每次变化 revision +1（configLedgerSource 等用它判变化）
  let localeRevision = 0;
  // ⚠️ getSnapshot 必须返回稳定引用（useSyncExternalStore 要求）——否则无限重渲染
  let localeSnapshot: any = { current: lang, active: lang, revision: localeRevision, locale: lang };
  const rebuildSnapshot = () => { localeSnapshot = { current: lang, active: lang, revision: localeRevision, locale: lang }; };
  const api: any = {
    // 注册字典：DSH 契约返回 { dispose } 或函数，这里返回函数（兼容两种用法）
    register(ns: string, dict: any) { dicts[ns] = dict; localeRevision++; rebuildSnapshot(); return () => { delete dicts[ns]; localeRevision++; rebuildSnapshot(); }; },
    bind(ns: string) { return (key: string, params?: any) => interpolate(lookup(ns, key), params); },
    t,
    // 订阅语言变化（组件常用：locale.subscribe(() => ...)）
    subscribe(cb: any) { if (typeof cb === 'function') localeSubs.add(cb); return () => { localeSubs.delete(cb); }; },
    getSnapshot() { return localeSnapshot; },
    setLocale(next: string) { lang = next; localeRevision++; rebuildSnapshot(); for (const fn of [...localeSubs]) { try { fn(next); } catch (_) {} } },
    get current() { return lang; },
    /** DSH 契约：当前语言（部分插件用 getLocale） */
    getLocale() { return lang; },
  };
  return api;
}

/** 会话服务（最小） */
function makeSessions(): any {
  const list = makeObservable({ byId: {}, order: [] as string[] });
  return {
    list,
    get(id: string) { return list.getSnapshot().byId[id]; },
    current() { return null; },
  };
}

/** 工作区服务（最小） */
function makeWorkspaces(): any {
  const list = makeObservable({ items: [] as any[] });
  return {
    list,
    async create(spec: any) { return { workspaceId: (spec && spec.path) || 'ws-' + Date.now() }; },
  };
}

/** 布局服务（最小） */
function makeLayout(): any {
  const activePanelId = makeObservable(null);
  return {
    selectPanel(id: string | null) {
      activePanelId.set(id);
      // 桥接到壳框架（shell-frame 挂的全局回调）
      try {
        const fn = (window as any).__cuckooSelectPanel;
        if (typeof fn === 'function') fn(id);
      } catch (_) {}
    },
    panelInfo: { getSnapshot: () => ({ activePanelId: activePanelId.getSnapshot() }), subscribe: activePanelId.subscribe },
  };
}

/** 连接服务（最小，api 用 stub 兜底） */
function makeConnection(): any {
  return { api: makeStub('connection.api'), agentPresets: undefined };
}

/** 远端服务单例（DSH 的 remote 是全局共享的，所有插件的 $on 注册到同一个） */
let __remoteSingleton: any = null;

/** 远端服务（最小 + pluginManager/pluginInventory） */
function makeRemote(): any {
  if (__remoteSingleton) return __remoteSingleton;
  const noop = () => () => {};
  const api = () => (window as any).shellAPI;
  // DSH 契约：返回 { ok, value } / { ok, error }
  const call = async (fn: string, ...args: any[]) => {
    try {
      const a = api();
      if (!a || typeof a[fn] !== 'function') return { ok: false, error: { code: 'operation-error', diagnostic: 'shellAPI.' + fn + ' 不存在' } };
      return await a[fn](...args);
    } catch (e: any) {
      return { ok: false, error: { code: 'operation-error', diagnostic: e && e.message ? e.message : String(e) } };
    }
  };
  // P2：事件总线（remote.$on 接真事件）
  const remoteListeners = new Map<string, Set<(d: any) => void>>();
  const initRemoteListener = () => {
    try {
      const a = api();
      if (a && typeof a.onRemoteEvent === 'function' && !(window as any).__cuckooRemoteBound) {
        (window as any).__cuckooRemoteBound = true;
        a.onRemoteEvent((evt: string, data: any) => {
          const set = remoteListeners.get(evt);
          if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error('[remote.$on] ' + evt + ' 回调失败', e); } }
        });
      }
    } catch (_) {}
  };
  __remoteSingleton = {
    $on: (evt: string, cb: any) => {
      if (typeof cb !== 'function') return noop();
      initRemoteListener();
      if (!remoteListeners.has(evt)) remoteListeners.set(evt, new Set());
      remoteListeners.get(evt)!.add(cb);
      return () => { const s = remoteListeners.get(evt); if (s) s.delete(cb); };
    },
    settings: { get: async () => undefined, set: async () => true },
    goals: { get: async () => null, edit: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), clear: async () => ({ ok: false }) },
    session: { modelCatalog: async () => ({ result: { value: { groups: [] } } }) },
    agentPresets: { list: async () => ({ result: { value: { presets: [] } } }) },
    // ===== DSH plugin-manager RPC =====
    pluginManager: {
      listBundles: () => call('pluginManagerListBundles'),
      listPlugins: () => call('pluginManagerListPlugins'),
      setBundleEnabled: (name: string, enabled: boolean) => call('pluginManagerSetEnabled', name, enabled),
      setPluginEnabled: (entryId: string, enabled: boolean) => call('pluginManagerSetEnabled', entryId, enabled),
      removeBundle: (name: string) => call('pluginManagerRemoveBundle', name),
      installBundle: (spec: string, opts?: any) => call('pluginManagerInstallBundle', spec, opts),
      inspect: (spec: string, _signal?: any) => call('pluginManagerInspect', spec),
      cancelInstall: (_requestId: string) => call('pluginManagerCancelInstall'),
    },
    pluginInventory: {
      list: () => call('pluginInventoryList'),
    },
  };
  return __remoteSingleton;
}

/** 会话打开（uiWorkspace） */
function makeUiWorkspace(): any {
  return {
    // [022] DSH 0.1.7+ 的会话导航 API：dsh-tasks 的「打开对话」按钮走这里
    // 复用壳页面的 navigateSession（主进程 navigate-session IPC 会把 logicId 翻译成 webId 再导航）
    // 详见 docs/dsh-compat-decisions.md 9.1 + 真机验证发现（点按钮无反应）
    openSession(id: string) {
      try {
        const api = (window as any).shellAPI;
        if (api && typeof api.navigateSession === 'function') {
          const p = api.navigateSession(id);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch { /* ignore */ }
    },
    // 工作区切换：Cuckoo 侧栏点分组就切换，不需要单独的 openWorkspace
    openWorkspace(_id: string) { /* noop */ },
  };
}

/** 响应式表单（configForms.get 返回）：带 subscribe/getSnapshot/describe/... */
function makeReactiveForm(ns: string): any {
  const state = makeObservable({ status: 'ready', value: {} });
  const descState = makeObservable({ view: { namespaces: [{ ns }] } });
  return {
    /** 订阅表单值变化 */
    subscribe(fn: (v: any) => void) { return state.subscribe(fn); },
    /** 取快照 */
    getSnapshot() { return state.getSnapshot(); },
    /** 描述（命名空间视图） */
    describe() { return { getSnapshot: () => descState.getSnapshot(), subscribe: descState.subscribe }; },
    /** 读值 */
    get() { return state.getSnapshot().value; },
    /** 写值（本地） */
    set(v: any) { state.set({ status: 'ready', value: { ...(state.getSnapshot().value || {}), ...(v || {}) } }); },
    /** 保存（本地） */
    save: async () => ({ ok: true }),
    reset: async () => ({ ok: true }),
    /** 提交（兼容别名） */
    submit: async () => ({ ok: true }),
  };
}

/** 配置表单（configForms / forms） */
function makeConfigForms(): any {
  const forms: Record<string, any> = {};
  const desc = makeObservable({ view: { namespaces: [] as any[] } });
  const getForm = (ns: string) => (forms[ns] || (forms[ns] = makeReactiveForm(ns)));
  return {
    /** 取某命名空间的表单 */
    get(ns: string) { return getForm(ns || 'default'); },
    /** 描述（所有命名空间） */
    describe() { return { getSnapshot: () => desc.getSnapshot(), subscribe: desc.subscribe }; },
    /** 绑定（返回表单） */
    bind(ns: string) { return getForm(ns || 'default'); },
    open: () => {},
    getSnapshot: () => desc.getSnapshot(),
    subscribe: desc.subscribe,
  };
}

/**
 * settingsScope 服务（对齐 DSH @deepseek-ai/dsh-client-ui-settings）
 *
 * 契约（ui-settings/lib/client.js 的 SettingsScopeBinder）：
 *  - bind({ namespace, decode? }) → SettingsScope
 *      - getSnapshot(): { status, value, base, user, revision, writable, mode }
 *      - subscribe(listener): disposer
 *      - set(field, value): Promise<void>
 *      - unset(field): Promise<void>
 *  - describe() → 共享镜像 face（getSnapshot/subscribe/load/ensure/acceptView/namespace）
 *
 * ⚠️ Cuckoo 目前没有"宿主 settings 文档"的 wire 层，所以 scope 为内存态（status: 'unavailable'）。
 *    这样插件能正常 apply（不崩），只是卡片显示"当前不可用"。
 */
function makeSettingsScope(): any {
  // 共享镜像（所有 scope 派生自它）
  const mirrorSubs = new Set<() => void>();
  let mirrorSnapshot: any = { status: 'unavailable', view: undefined, error: null };
  const mirror: any = {
    getSnapshot: () => mirrorSnapshot,
    subscribe(cb: () => void) { if (typeof cb === 'function') mirrorSubs.add(cb); return () => { mirrorSubs.delete(cb); }; },
    load: async () => {},
    ensure: async () => {},
    acceptView: () => {},
    namespace: (_ns: string) => undefined,
  };
  return {
    /** 绑定一个命名空间 scope */
    bind(spec: any): any {
      const ns = spec && spec.namespace ? String(spec.namespace) : 'default';
      const subs = new Set<() => void>();
      const snap: any = {
        status: 'unavailable',
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'memory',
        namespace: ns,
      };
      return {
        getSnapshot: () => snap,
        subscribe(cb: () => void) { if (typeof cb === 'function') subs.add(cb); return () => { subs.delete(cb); }; },
        async set(_field: string, _value: unknown) { /* no-op（无宿主 transport）*/ },
        async unset(_field: string) { /* no-op */ },
      };
    },
    /** 共享镜像 face */
    describe: () => mirror,
    getSnapshot: () => mirrorSnapshot,
    subscribe: (cb: () => void) => mirror.subscribe(cb),
  };
}

/** 主题服务（对齐 DSH ctx.theme）：getTheme/list/setTheme/subscribe */
function makeTheme(emit: (evt: string, ...a: any[]) => void): any {
  const themes = [
    { id: 'light', colorScheme: 'light', tokens: {} },
    { id: 'dark', colorScheme: 'dark', tokens: {} },
    { id: 'system', colorScheme: 'light', tokens: {} },
  ];
  let snapshot: any = { preference: 'system', active: { id: 'light', colorScheme: 'light', tokens: {} }, themes, revision: 0 };
  // 从主进程拉真主题
  try {
    const api = (window as any).shellAPI;
    if (api && typeof api.themeGet === 'function') {
      api.themeGet().then((r: any) => {
        if (r && r.success && r.snapshot) {
          snapshot = r.snapshot;
          emit('theme/change', snapshot);
        }
      }).catch(() => {});
    }
  } catch (_) {}
  const subs = new Set<(s: any) => void>();
  return {
    getTheme: () => snapshot,
    getSnapshot: () => snapshot,
    list: () => snapshot.themes || themes,
    subscribe(cb: (s: any) => void) { if (typeof cb === 'function') subs.add(cb); return () => { subs.delete(cb); }; },
    setTheme(id: string) {
      try {
        const api = (window as any).shellAPI;
        if (api && typeof api.themeSet === 'function') {
          api.themeSet(id).then((r: any) => {
            if (r && r.success && r.snapshot) { snapshot = r.snapshot; for (const f of [...subs]) { try { f(snapshot); } catch (_) {} } emit('theme/change', snapshot); }
          }).catch(() => {});
        }
      } catch (_) {}
    },
    register() { return () => {}; },
  };
}

/** 服务表（按名取） */
function makeServices(): Record<string, any> {
  const locale = makeLocale();
  // 事件总线（真实现，供 ctx.on/emit 用）
  const evBus = new Map<string, Set<Function>>();
  const emit = (evt: string, ...args: any[]) => {
    const set = evBus.get(evt);
    if (set) for (const fn of [...set]) { try { fn(...args); } catch (e) { console.error('[dsh-client] 事件回调失败 ' + evt, e); } }
  };
  const theme = makeTheme(emit);
  return {
    slots: null, // 每插件独立，稍后填
    sessions: makeSessions(),
    workspaces: makeWorkspaces(),
    layout: makeLayout(),
    connection: makeConnection(),
    remote: makeRemote(),
    'remote.session': makeRemote().session,
    uiWorkspace: makeUiWorkspace(),
    locale,
    theme,
    settingsScope: makeSettingsScope(),
    configForms: makeConfigForms(),
    forms: makeConfigForms(),
    tools: makeStub('tools'),
    store: makeStub('store'),
    __evBus: evBus,
    __emit: emit,
  };
}

/** 构造给插件 client 的 ctx（增强版） */
function makeCtx(pluginId: string, services: Record<string, any>): any {
  const effects: Array<() => void> = [];
  const slots = {
    inject(name: string, cb: () => any) {
      try {
        const d = cb();
        // 支持 generator（function* + yield）：迭代它，收集 disposer
        if (d && typeof d.next === 'function' && typeof d[Symbol.iterator] === 'function') {
          const disposers: Array<() => void> = [];
          for (const item of d) {
            if (typeof item === 'function') disposers.push(item);
          }
          return () => { for (const fn of disposers) { try { fn(); } catch (_) {} } };
        }
        return typeof d === 'function' ? d : () => {};
      } catch (e: any) {
        console.error('[dsh-slot] inject(' + name + ') 回调失败 @' + pluginId + ': ' + (e && e.message ? e.message : String(e)));
        if (e && e.stack) console.error(String(e.stack).slice(0, 600));
        return () => {};
      }
    },
    register(spec: any, Component: any) {
      const s = spec || {};
      const slotName = s.name || s.slot;
      // DSH 的 key 字段（如 main 插槽的 key:'plugins'）也要作为 id
      const id = s.id || s.key || slotName;
      if (!slotName) return () => {};
      const key = pluginId + ':' + slotName + ':' + id;
      // i18n：从 spec.locale 生成 t 函数（DSH 组件常用 ({ t }) => ...）
      // 注意：返回的 t 必须是函数，任何 key 都安全返回（查不到回退 key）
      // t(key, params?) → 支持插值（DSH 的 t('xxx', { name: '...' })）
      const interpolate = (v: any, params: any): string => {
        let out = (v === undefined || v === null) ? '' : String(v);
        if (params && typeof params === 'object') {
          out = out.replace(/\{(\w+)\}/g, (m: string, name: string) => {
            const pv = params[name];
            return (pv === undefined || pv === null) ? m : String(pv);
          });
        }
        return out;
      };
      let t: any = (k: string, params?: any) => interpolate(k, params);
      try {
        const ns = s.locale;
        if (ns && services.locale && typeof services.locale.bind === 'function') {
          const bound = services.locale.bind(ns);
          if (typeof bound === 'function') t = (k: string, params?: any) => {
            try { return interpolate(bound(k), params); } catch (_) { return interpolate(k, params); }
          };
        }
      } catch (_) {}
      // DSH 依赖注入面：spec.inject
      //   函数 → 调它拿 props（如 dsh-usage 的 face() → { store, poll, settings }）
      //   数组 → 从服务表按名取
      let injectedProps: any = undefined;
      try {
        const inj = s.inject;
        if (typeof inj === 'function') {
          injectedProps = inj() || {};
        } else if (Array.isArray(inj)) {
          injectedProps = {};
          for (const nm of inj) {
            if (typeof nm === 'string' && services[nm]) injectedProps[nm] = services[nm];
          }
        }
      } catch (e) { console.error('[dsh-client] spec.inject 解析失败 ' + id, e); }

      // 记录插槽声明（第一次注册时）
      if (!slotSpecs.has(slotName)) {
        slotSpecs.set(slotName, {
          name: slotName,
          kind: s.kind || (s.children ? 'list' : 'single'),
          scope: s.scope,
          children: s.children,
        });
      }
      const list = (slotTable.get(slotName) || []).filter((x) => x.key !== key);
      list.push({ key, pluginId, slot: slotName, id, order: typeof s.order === 'number' ? s.order : 100, spec: s, Component, t, injectedProps });
      slotTable.set(slotName, list);
      notifySlot(slotName);
      try {
        const api = (window as any).shellAPI;
        if (api && typeof api.slotRegister === 'function') {
          api.slotRegister({ pluginId, slot: slotName, id, order: s.order, spec: { label: typeof s.label === 'function' ? undefined : s.label, title: s.title } }).catch(() => {});
        }
      } catch (_) {}
      return () => {
        const l = (slotTable.get(slotName) || []).filter((x) => x.key !== key);
        slotTable.set(slotName, l);
        notifySlot(slotName);
      };
    },
    unregister() {},
    /** 拿某槽的条目（DSH 契约：stable 引用）*/
    entries(slotName: string) {
      return (slotTable.get(slotName) || []).map(toEntry);
    },
    /** 投影"胜出者"（按 kind 去重）*/
    entriesOfSlot(slotName: string) {
      return entriesOfSlotImpl(slotName);
    },
    /** 插槽声明（codex-ui 判 typeof === "function"）*/
    spec(slotName: string) {
      return slotSpecs.get(slotName);
    },
    /** 订阅某槽变化（返回退订）*/
    subscribe(slotName: string, fn: () => void) {
      if (typeof fn !== 'function') return () => {};
      if (!slotListeners.has(slotName)) slotListeners.set(slotName, new Set());
      slotListeners.get(slotName)!.add(fn);
      return () => { const s = slotListeners.get(slotName); if (s) s.delete(fn); };
    },
    /** 版本号（每次变化 +1）*/
    getVersion(slotName: string) { return slotVersions.get(slotName) || 0; },
    /** 拿所有已声明槽（调试用）*/
    allSlots() { return [...slotSpecs.keys()]; },
  };
  services.slots = slots;

  const ctx: any = {
    pluginId,
    slots,
    ...services,
    effect(fn: any) {
      try { const c = fn(); const d = typeof c === 'function' ? c : () => {}; effects.push(d); return d; }
      catch (e) { console.error('[dsh-client] effect 失败 ' + pluginId, e); return () => {}; }
    },
    on(evt: string, fn: any) {
      const bus = services.__evBus as Map<string, Set<Function>>;
      if (!bus || typeof fn !== 'function') return () => {};
      if (!bus.has(evt)) bus.set(evt, new Set());
      bus.get(evt)!.add(fn);
      return () => { const s = bus.get(evt); if (s) s.delete(fn); };
    },
    once(evt: string, fn: any) {
      const off = (ctx as any).on(evt, (...args: any[]) => { off(); fn(...args); });
      return off;
    },
    off(evt: string, fn: any) { const s = (services.__evBus as any)?.get(evt); if (s) s.delete(fn); },
    emit(evt: string, ...args: any[]) { const f = services.__emit; if (typeof f === 'function') f(evt, ...args); },
    // cordis：依赖就绪后回调（简化：立即执行）
    inject(_names: any, cb: any) {
      if (typeof cb !== 'function') return () => {};
      try { const ret = cb(ctx); if (typeof ret === 'function') return ret; } catch (e) { console.error('[dsh-client] inject 回调失败 ' + pluginId, e); }
      return () => {};
    },
    // 真挂子插件（DSH 聚合插件靠它）：执行 definition.apply(子 ctx)
    plugin(definition: any) {
      const def = typeof definition === 'function' ? { apply: definition, name: pluginId + ':child' } : (definition || {});
      const childName = def.name || pluginId + ':child';
      const childCtx = makeCtx(childName, services);
      // 注入：把 def.inject 里的服务挂到 childCtx（已在 services 里，直接可见）
      try {
        if (typeof def.apply === 'function') {
          const ret = def.apply(childCtx);
          if (ret && typeof ret.then === 'function') return ret.then(() => ({ dispose() {} }));
        }
      } catch (e) { console.error('[dsh-client] 子插件 apply 失败 ' + childName, e); }
      return { dispose() {} };
    },
    get(key: string) { return services[key]; },
    provide(key: string, val: any) { services[key] = val; return () => { delete services[key]; }; },
    logger: { warn: (...a: any[]) => console.warn('[dsh-client:' + pluginId + ']', ...a), info: (...a: any[]) => console.info('[dsh-client:' + pluginId + ']', ...a), error: (...a: any[]) => console.error('[dsh-client:' + pluginId + ']', ...a) },
    log: (...a: any[]) => console.log('[dsh-client:' + pluginId + ']', ...a),
  };
  return ctx;
}

/** 执行一个插件的 client 模块（apply） */
function applyClient(pluginId: string, mod: any): void {
  const client = mod && (mod.default || mod);
  if (client && typeof client.apply === 'function') {
    try { client.apply(makeCtx(pluginId, makeServices())); }
    catch (e) { console.error('[dsh-client] apply 失败 ' + pluginId, e); }
  }
}

/** 拦截 fetch：把 /api/* 请求重写到插件本地 HTTP 服务 */
let httpBaseCache: string | null = null;
let shellTokenCache: string | null = null;
function installFetchInterceptor(): void {
  const w = window as any;
  if (w.__ckFetchPatched) return;
  w.__ckFetchPatched = true;
  const origFetch = w.fetch.bind(w);
  // [022] 不设白名单。用主进程的动态路由表（插件 ctx.webServer.register 注册的 path）
  // 从任意形态的 URL 里匹配出真正的 API 路径，再拼到本地 webServer 上。
  // 匹配不到注册表的请求原样放行（如 file:// 同目录静态资源、外网请求）。
  // 每次请求都实时拉取，不做缓存（IPC 只需几毫秒，避免「插件加载慢于壳页面」导致缓存过期）。
  const fetchDynamicRoutes = async (): Promise<string[]> => {
    try {
      const api = (window as any).shellAPI;
      if (!api || typeof api.webRoutes !== 'function') return [];
      const r = await api.webRoutes();
      if (r && r.success && Array.isArray(r.routes)) {
        // 按长度降序：最长匹配优先（'/dsh-market/api' 先于 '/dsh-market'）
        return r.routes
          .map((x: any) => String(x && x.path ? x.path : ''))
          .filter(Boolean)
          .sort((a: string, b: string) => b.length - a.length);
      }
    } catch (_) { /* ignore */ }
    return [];
  };
  /** 是否外网/绝对地址（不重写，直接放行） */
  const isExternalUrl = (u: string) => {
    if (!u) return false;
    if (/^(https?|data|blob|chrome-extension|about|ws|wss):/i.test(u)) return true;
    if (u.startsWith('//')) return true;
    return false;
  };
  /**
   * 壳页面自身目录（含末尾斜杠），用于剥离插件 pathname 里的"页面磁盘前缀"。
   * 例：document.baseURI = 'file:///C:/d/.../src/ui/shell.html'
   *     → BASE_DIR = '/C:/d/.../src/ui/'
   * 不同用户安装路径不同，所以运行时动态获取，不能写死。
   */
  const BASE_DIR: string = (() => {
    try {
      const u = new URL(document.baseURI);
      const p = u.pathname;
      const i = p.lastIndexOf('/');
      return i >= 0 ? p.slice(0, i + 1) : '';
    } catch (_) { return ''; }
  })();
  /**
   * 去掉 pathname 开头的 BASE_DIR。
   * 不含 BASE_DIR 时原样返回（如 '/dsh-tasks/api/next' 这种前端硬编码路径）。
   */
  const stripBaseDir = (raw: string): string => {
    if (!BASE_DIR || !raw.startsWith(BASE_DIR)) return raw;
    return '/' + raw.slice(BASE_DIR.length);
  };
  /**
   * 从任意形态的 URL 里，用已注册的动态路由表匹配出真正的 API 路径。
   * 返回 null 表示「不是任何已注册插件的 API」——调用方应原样放行。
   *
   * 三段式（精度从高到低）：
   *   ① 剥离 BASE_DIR（页面磁盘前缀）得到候选，若以注册 path 开头则命中（最准确）
   *   ② 候选本身作为绝对路径匹配注册表（如 '/dsh-tasks/api/next'）
   *   ③ 兜底：在原始 raw 里 indexOf 找注册 path（极端情况下路径形态异常）
   *
   * 例：
   *   '/C:/d/.../ui/dsh-market/status'
   *     → 剥离 BASE_DIR → '/dsh-market/status' → 命中 '/dsh-market' ✅
   *   '/dsh-tasks/api/next'
   *     → 不含 BASE_DIR，候选 = 原样 → 命中 '/dsh-tasks/api' ✅
   */
  const extractApiPath = (raw: string, routes: string[]): string | null => {
    if (!raw) return null;
    // 统一先提取 pathname 部分（去掉 query/fragment）
    let pathname = raw;
    try {
      const u = new URL(raw, document.baseURI);
      pathname = u.pathname;
    } catch (_) { /* raw 本身可能就是 pathname */ }

    // ① 剥离 BASE_DIR 后匹配（最准确）
    const stripped = stripBaseDir(pathname);
    for (const p of routes) {
      if (stripped === p || stripped.startsWith(p + '/')) return stripped;
    }

    // ② 候选本身作为绝对路径匹配（dsh-tasks 这类前端硬编码路径）
    for (const p of routes) {
      if (pathname === p || pathname.startsWith(p + '/')) return pathname;
    }

    // ③ 兜底：在原始 raw 里 indexOf 找注册 path（路径形态异常时的最后一道）
    for (const p of routes) {
      const idx = raw.indexOf(p);
      if (idx >= 0) {
        // 校验边界：后面必须是 '/' 或结尾，避免 '/dsh-market-app' 误匹配 '/dsh-market'
        const next = raw[idx + p.length];
        if (next === undefined || next === '/' || next === '?' || next === '#') {
          return raw.slice(idx);
        }
      }
    }
    return null;
  };
  w.fetch = async (input: any, init?: any) => {
    try {
      let url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
      if (url && !isExternalUrl(url)) {
        const routes = await fetchDynamicRoutes();
        let raw = url;
        if (!raw.startsWith('/') && !raw.startsWith('file:')) {
          try { raw = new URL(raw, location.href).href; } catch (_) { /* ignore */ }
        }
        const apiPath = extractApiPath(raw, routes);
        if (apiPath) {
          if (httpBaseCache === null) {
            try {
              const api = (window as any).shellAPI;
              const r = api && typeof api.webServerInfo === 'function' ? await api.webServerInfo() : null;
              httpBaseCache = (r && r.success && r.base) ? r.base : '';
            } catch (_) { httpBaseCache = ''; }
          }
          if (shellTokenCache === null) {
            try {
              const api = (window as any).shellAPI;
              const r = api && typeof api.getShellToken === 'function' ? await api.getShellToken() : null;
              shellTokenCache = (r && r.token) ? r.token : '';
            } catch (_) { shellTokenCache = ''; }
          }
          if (httpBaseCache) {
            input = httpBaseCache + apiPath;
            if (shellTokenCache) {
              const headers = new Headers(init && init.headers ? init.headers : undefined);
              headers.set('X-Cuckoo-Shell', shellTokenCache);
              init = Object.assign({}, init || {}, { headers });
            }
          }
        }
      }
    } catch (e) { console.error('[dsh-client] fetch 重写失败', e); }
    return origFetch(input, init);
  };
}

/** 全局 __ModuleLoader__（DSH client 入口会调它） */
function installModuleLoader(): void {
  const w = window as any;
  if (w.__ModuleLoader__) return;
  w.__ModuleLoader__ = {
    load(spec: any) {
      const { id, factory } = spec || {};
      if (!id || typeof factory !== 'function') return;
      const req = (name: string) => {
        if (moduleTable[name]) return moduleTable[name];
        if (loadedModules[name]) return loadedModules[name];
        // primitives 包（Icon 组件）用"组件安全 shim"
        if (name.includes('ui-primitives')) return makePrimitivesShim();
        // ui-slots 包（resolveSlotLabel 等）
        if (name.includes("ui-slots")) return dshUiSlots;
        // client-store 包（createSnapshotStore/defineStore）
        if (name === '@deepseek-ai/dsh-client-store') return dshClientStore;
        // 其他 @deepseek-ai/*（服务/store 等）：万能 stub（可链式调用，不返回 null）
        return makeStub(name);
      };
      try {
        const exports = factory(req) || {};
        loadedModules[id] = exports;
        applyClient(id, exports);
      } catch (e) { console.error('[dsh-client] factory 执行失败 ' + id, e); }
    },
  };
}

/** HMR：清空所有插槽（用于重载前） */
export function clearAllSlots(): void {
  slotTable.clear();
  notify();
}

/** HMR：只清某插件的插槽（按 pluginId = 包名） */
export function clearSlotsByPlugin(pluginId: string): void {
  if (!pluginId) return;
  const touched: string[] = [];
  for (const [slotName, items] of [...slotTable.entries()]) {
    const next = items.filter((x) => x.pluginId !== pluginId);
    if (next.length !== items.length) touched.push(slotName);
    if (next.length) slotTable.set(slotName, next);
    else slotTable.delete(slotName);
  }
  // 每个受影响的槽都要 bump 版本（configLedger 的 getVersion 依赖它）
  for (const name of touched) notifySlot(name);
  if (!touched.length) notify();
}

/**
 * HMR：重载 / 卸载 DSH client
 * @param pluginId 可选——只处理该插件（包名）；不传则全量重载
 * @param enabled  可选——true=重载；false=仅卸载（清槽 + 清模块，不重新执行）
 */
export async function reloadDshClients(pluginId?: string, enabled?: boolean): Promise<void> {
  try {
    if (pluginId) {
      // 清它的插槽 + 清它的模块（按包名；同时兼容短名）
      const shortId = (pluginId.includes('/') ? pluginId.split('/').pop() : pluginId) || pluginId;
      clearSlotsByPlugin(pluginId);
      if (shortId !== pluginId) clearSlotsByPlugin(shortId);
      for (const k of Object.keys(loadedModules)) {
        // loadedModules 的 key 是包名（@scope/name）
        if (k === pluginId || k === shortId) delete loadedModules[k];
      }
      // enabled === false：只卸载，不重新执行 client（禁用场景）
      if (enabled === false) {
        console.log('[dsh-client] HMR 卸载完成（仅 ' + pluginId + '）');
        return;
      }
      await loadDshClients(pluginId);
      console.log('[dsh-client] HMR 重载完成（仅 ' + pluginId + '）');
    } else {
      // 全量重载
      clearAllSlots();
      for (const k of Object.keys(loadedModules)) delete loadedModules[k];
      await loadDshClients();
      console.log('[dsh-client] HMR 重载完成（全部）');
    }
  } catch (e: any) {
    console.error('[dsh-client] HMR 重载失败', e);
  }
}

/**
 * 加载已启用插件的 client 源码并执行（幂等）
 * @param onlyPkgName 可选——只加载该包（HMR 单插件重载）
 */
export async function loadDshClients(onlyPkgName?: string): Promise<void> {
  installFetchInterceptor();
  installModuleLoader();
  const api = (window as any).shellAPI;
  if (!api || typeof api.cuckooPluginClientSources !== 'function') return;
  try {
    const r = await api.cuckooPluginClientSources();
    if (!r || !r.success || !Array.isArray(r.clients)) return;
    for (const c of r.clients) {
      // 匹配：全名（@scope/name）或短名（name）都算（主进程 clientSources 给短名，setEnabled 传全名）
      if (onlyPkgName) {
        const short = onlyPkgName.includes('/') ? onlyPkgName.split('/').pop() : onlyPkgName;
        if (c.pkgName !== onlyPkgName && c.pkgName !== short) continue;
      }
      const src = String(c.source || '');
      if (!src.includes('__ModuleLoader__')) continue;
      try {
        // eslint-disable-next-line no-new-func
        new Function(src)();
      } catch (e) {
        console.error('[dsh-client] 执行源码失败 ' + (c && c.pluginId), e);
      }
    }
  } catch (_) { /* ignore */ }
}

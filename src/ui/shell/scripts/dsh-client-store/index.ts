/**
 * DSH client-store 兼容层（@deepseek-ai/dsh-client-store 的替身）
 *
 * 契约（对齐 DSH packages/client/store/src/index.ts）：
 *  - createSnapshotStore(init, opts) → { getSnapshot, subscribe, update, set }
 *  - defineStore(decl) → { spec, create(scopeKey?) }
 *
 * ⚠️ 自实现：不依赖 zustand/immer——用简单可观察 + 浅克隆 draft。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** 浅克隆（draft 用；只克隆顶层，mutator 只改顶层字段） */
function shallowClone(v: any): any {
  if (Array.isArray(v)) return v.slice();
  if (v && typeof v === "object") return Object.assign({}, v);
  return v;
}

/** localStorage 持久化（写 + 读回） */
function attachPersistence(store: any, name: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(name);
    if (raw !== null) {
      try { store.set(JSON.parse(raw)); } catch (_) {}
    }
    store.subscribe(() => {
      try { localStorage.setItem(name, JSON.stringify(store.getSnapshot())); } catch (_) {}
    });
  } catch (_) {}
}

/** 创建快照 store（DSH 契约） */
export function createSnapshotStore(init: any, opts?: any): any {
  let state = init;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error("[client-store] subscriber failed:", e); } } };
  const store = {
    getSnapshot: () => state,
    subscribe(fn: any) { if (typeof fn !== "function") return () => {}; listeners.add(fn); return () => { listeners.delete(fn); }; },
    update(mutator: any) {
      const draft = shallowClone(state);
      try { mutator(draft); } catch (e) { console.error("[client-store] update mutator failed:", e); return; }
      state = draft;
      notify();
    },
    set(next: any) { state = next; notify(); },
  };
  if (opts && opts.persist && opts.persist.name) attachPersistence(store, opts.persist.name);
  return store;
}

/** 声明式 store：init + actions → handle（DSH defineStore 契约） */
export function defineStore(decl: any): any {
  if (!decl || typeof decl !== "object") throw new Error("[client-store] defineStore: decl required");
  const init = typeof decl.init === "function" ? decl.init : () => ({ ...(decl.init || {}) });
  const actionsDecl = decl.actions || {};
  return {
    spec: decl,
    create(scopeKey?: any) {
      const persistKey = decl.persist === undefined ? undefined : (scopeKey === undefined ? decl.persist : decl.persist + "." + scopeKey);
      const store = createSnapshotStore(init(), persistKey !== undefined ? { persist: { name: persistKey } } : undefined);
      const actions: any = {};
      for (const key of Object.keys(actionsDecl)) {
        const mutate = actionsDecl[key];
        actions[key] = (...params: any[]) => { store.update((draft: any) => { mutate(draft, ...params); }); };
      }
      return {
        actions,
        getSnapshot: () => store.getSnapshot(),
        subscribe: (fn: any) => store.subscribe(fn),
        store,
        clearPersisted: () => { try { if (persistKey && typeof localStorage !== "undefined") localStorage.removeItem(persistKey); } catch (_) {} },
      };
    },
  };
}

/** 浅比较（DSH shallowEqual 契约） */
export function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { if (a[k] !== b[k]) return false; }
  return true;
}

/** 批量通知工具（DSH notifySubscribers 契约） */
export function notifySubscribers(listeners: any, label: string, ...args: any[]): void {
  for (const fn of [...listeners]) { try { fn(...args); } catch (e) { console.error((label || "[client-store]") + " subscriber failed:", e); } }
}

/** raf 批量（DSH rafBatch 契约） */
export function rafBatch(fn: any): () => void {
  const schedule = typeof requestAnimationFrame === "function"
    ? (f: any) => requestAnimationFrame(() => { f(); })
    : (f: any) => queueMicrotask(f);
  let scheduled = false;
  return () => { if (scheduled) return; scheduled = true; schedule(() => { scheduled = false; fn(); }); };
}

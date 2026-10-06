/**
 * Cuckoo 插件系统 - 插件加载器
 *
 * 职责：
 *  - 接收一个"DSH 风格插件模块"（已 require 的对象，或源码字符串）
 *  - 校验入口契约（name / inject / apply）
 *  - 等待 inject 声明的服务就绪
 *  - 用 apply(ctx, config) 激活插件
 *  - 返回可卸载句柄
 *
 * 入口契约（对齐 DSH 标准）：
 *   1. 命名导出 name（字符串）
 *   2. 命名导出 inject（服务名数组，可选）
 *   3. 命名导出 apply(ctx, config)（函数）
 *   4. 禁止裸 export default apply（会导致 inject 丢失）
 */
import { createContext } from './context.js';
import { Service } from './service.js';
import type { HostCapabilities } from './context.js';
import type { PluginContext, PluginModule, ServiceName, LoadResult, ServiceRegistry } from './types.js';

/** 已加载的插件句柄 */
export interface LoadedPlugin {
  name: string;
  ctx: PluginContext;
  /** 该插件声明的依赖服务（供 PluginHost 跟踪） */
  inject: string[];
  dispose(): void;
}

/**
 * 从模块对象解析入口契约
 * @returns { name, inject, apply } 或抛错
 */
function resolveEntry(mod: PluginModule, fallbackName?: string): { name: string; inject: ServiceName[]; apply: Function } {
  if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) {
    throw new Error('插件模块必须是对象');
  }
  const m = mod as any;

  // 对象形式：export default { name, inject, apply }
  if (m.default && typeof m.default === 'object' && typeof m.default.apply === 'function') {
    const o = m.default;
    const name = (typeof o.name === 'string' && o.name.trim()) ? o.name.trim() : (fallbackName || 'anonymous-plugin');
    const inject: ServiceName[] = Array.isArray(o.inject) ? o.inject.filter((x: any) => typeof x === 'string') : [];
    return { name, inject, apply: o.apply };
  }

  // 类形式：export default class ... extends Service
  // 它没有 apply，而是"实例化即注册服务"。这里包一个 apply 来 new 它。
  const defaultExport = m.default;
  if (typeof defaultExport === 'function' && isServiceClass(defaultExport) && typeof m.apply !== 'function') {
    const className = typeof defaultExport.name === 'string' && defaultExport.name
      ? defaultExport.name
      : (fallbackName || 'anonymous-service');
    const apply = (ctx: any) => { new defaultExport(ctx); };
    const inject: ServiceName[] = Array.isArray(defaultExport.inject)
      ? defaultExport.inject.filter((x: any) => typeof x === 'string')
      : (Array.isArray(m.inject) ? m.inject.filter((x: any) => typeof x === 'string') : []);
    return { name: className, inject, apply };
  }

  // 兼容：命名导出 或 直接的 apply 字段
  const apply = typeof m.apply === 'function' ? m.apply
    : typeof m.default === 'function' && !isClass(m.default) ? m.default
    : typeof m === 'function' && !isClass(m) ? m
    : null;

  if (!apply) {
    throw new Error('插件缺少 apply(ctx, config) 入口函数');
  }

  const name = typeof m.name === 'string' && m.name.trim()
    ? m.name.trim()
    : (fallbackName || 'anonymous-plugin');

  const inject: ServiceName[] = Array.isArray(m.inject) ? m.inject.filter((x: any) => typeof x === 'string') : [];

  // 校验：裸 default 会丢 inject（DSH 红线）——但 class 形式除外（它靠 static inject）
  if (!m.name && m.default && !m.apply && !isClass(m.default)) {
    throw new Error('插件用裸 export default 导出，会导致 inject 丢失；请改用命名导出 apply');
  }

  return { name, inject, apply };
}

/** 判断一个函数是否是 class（用源码文本） */
function isClass(fn: any): boolean {
  try {
    if (typeof fn !== 'function') return false;
    return /^\s*class\s/.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

/** 判断一个类是否"看起来像 Service"（有 name 属性、构造器接受 ctx） */
function isServiceClass(cls: any): boolean {
  return isClass(cls);
}

/**
 * 校验插件声明的 inject 服务。
 *
 * 注意：DSH 允许插件 inject **任意**服务名（只要有人 provide）。
 * 所以这里**只校验格式**（非空字符串），不限制为内置服务名单。
 * 内置服务（agents/tools/sessions/settings）只是"必定存在"的常用服务。
 */
function checkInject(host: HostCapabilities, inject: ServiceName[]): void {
  for (const svc of inject) {
    if (typeof svc !== 'string' || !svc.trim()) {
      throw new Error('inject 服务名非法（须为非空字符串）');
    }
  }
}

/**
 * 加载一个 DSH 风格插件模块
 */
export function loadPluginModule(mod: PluginModule, host: HostCapabilities, config?: any, registry?: ServiceRegistry, beforeApply?: (ctx: PluginContext) => void): LoadedPlugin {
  const { name, inject, apply } = resolveEntry(mod);
  checkInject(host, inject);

  const ctx = createContext(name, host, registry);

  // apply 之前的钩子（如给 UI 插件附加 ctx.ui）
  if (beforeApply) {
    try { beforeApply(ctx); } catch (err) {
      console.error('[plugin] beforeApply 出错 (' + name + '):', err);
    }
  }

  // 激活：若声明的 inject 服务未就绪，推迟到就绪后再 apply
  const doApply = (): void => {
    try {
      const ret = apply(ctx, config);
      if (ret && typeof (ret as any).then === 'function') {
        (ret as Promise<any>).catch((err: any) => {
          console.error('[plugin] 插件 apply 异步出错 (' + name + '):', err);
        });
      }
    } catch (err: any) {
      console.error('[plugin] 插件 apply 出错 (' + name + '):', err && err.message ? err.message : err);
    }
  };

  // 内置服务：ctx 自带，始终就绪（不必注册到 registry）
  const BUILTIN_SERVICES = new Set(['agents', 'tools', 'sessions', 'settings']);
  const needsWait = inject.filter((svc) => !BUILTIN_SERVICES.has(svc));

  if (registry && needsWait.length > 0) {
    // 检查所有 inject 服务是否就绪（内置服务除外）
    const missing = needsWait.filter((svc) => !registry.has(svc));
    if (missing.length > 0) {
      // 有未就绪的服务：注册 onReady，全部就绪后 apply
      let ready = false;
      const cleanups: Array<() => void> = [];
      const tryApply = (): void => {
        if (ready) return;
        const stillMissing = needsWait.filter((svc) => !registry.has(svc));
        if (stillMissing.length > 0) return;
        ready = true;
        for (const c of cleanups) { try { c(); } catch (_) {} }
        doApply();
      };
      for (const svc of missing) {
        cleanups.push(registry.onReady(svc, tryApply));
      }
      // 可能注册瞬间就已就绪
      tryApply();
    } else {
      doApply();
    }
  } else {
    doApply();
  }

  return {
    name,
    ctx,
    inject,
    dispose: () => {
      const dispose = (ctx as any).__dispose;
      if (typeof dispose === 'function') dispose();
    },
  };
}

/**
 * 把 ESM 源码转换成可在 `new Function` 里运行的 CommonJS 形式。
 *
 * DSH 插件是 ESM（用 \`export const name = ...\`），而 \`new Function\` 是 CJS 环境。
 * 这里做**最小语法转换**（不引入 bundler）：
 *   export const name = 'x'      → exports.name = 'x'
 *   export function apply(...)   → exports.apply = function apply(...)
 *   export default xxx           → exports.default = xxx
 *   export { a, b }              → exports.a = a; exports.b = b
 *
 * 只覆盖 DSH 插件的常见写法，不做完整 ESM 解析。
 */
export function esmToCjs(source: string): string {
  let out = source;
  // export const/let/var xxx = ...   （不锚行首，兼容一行多个 export）
  out = out.replace(/\bexport\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, 'exports.$2 =');
  // export function xxx(...)  → exports.xxx = function xxx(...)
  out = out.replace(/\bexport\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, 'exports.$1 = function $1(');
  // export async function xxx(...)
  out = out.replace(/\bexport\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, 'exports.$1 = async function $1(');
  // export default xxx
  out = out.replace(/\bexport\s+default\s+/g, 'exports.default = ');
  // export { a, b as c }
  out = out.replace(/\bexport\s*\{([^}]*)\}\s*;?/g, (_m, inner) => {
    const parts = String(inner).split(',').map((s) => s.trim()).filter(Boolean);
    return parts
      .map((p) => {
        const m = p.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!m) return '';
        const local = m[1];
        const exported = m[2] || m[1];
        return 'exports.' + exported + ' = ' + local + ';';
      })
      .join(' ');
  });
  // import { A, B as C } from 'xxx'  → const { A, B: C } = require('xxx')
  out = out.replace(/\bimport\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_m, names, from) => {
    const mapped = String(names).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const mm = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!mm) return '';
      return mm[2] ? (mm[1] + ': ' + mm[2]) : mm[1];
    }).filter(Boolean).join(', ');
    return 'const { ' + mapped + " } = require('" + from + "');";
  });
  // import X from 'xxx'  → const X = require('xxx')
  out = out.replace(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?/g, (_m, def, from) => {
    return "const " + def + " = require('" + from + "');";
  });
  return out;
}

/**
 * 从源码字符串加载（用于 eval / 动态注入场景）
 * 注意：会执行任意代码，调用方须确保来源可信。
 * 支持 ESM 与 CommonJS 两种写法。
 */
export function loadPluginSource(source: string, host: HostCapabilities, fallbackName?: string, config?: any, registry?: ServiceRegistry, beforeApply?: (ctx: PluginContext) => void): LoadedPlugin {
  const isEsm = /(^|\n)\s*export\s/.test(source);
  const code = isEsm ? esmToCjs(source) : source;
  // 用 Function 包装成 CommonJS 模块环境
  const moduleObj = { exports: {} as any };
  const exportsObj = moduleObj.exports;
  const fn = new Function('module', 'exports', 'require', code + '\n;return module.exports;');
  const result = fn(moduleObj, exportsObj, (id: string) => {
    // 插件可 import/require 的"内置模块"：Service 基类
    if (id === 'cuckoo' || id === '@deepseek-ai/cordis' || id === 'cuckoo-plugin') {
      return { Service };
    }
    throw new Error('DSH 插件暂不支持 require 外部模块: ' + id);
  });
  const mod = (result && (typeof result === 'object' || typeof result === 'function')) ? result : moduleObj.exports;
  return loadPluginModule(mod, host, config, registry, beforeApply);
}

/**
 * 安全加载：任何错误都包成 LoadResult，不抛出
 */
export function safeLoad(fn: () => LoadedPlugin): LoadResult & { plugin?: LoadedPlugin } {
  try {
    const plugin = fn();
    return { ok: true, pluginName: plugin.name, plugin };
  } catch (err: any) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

export { resolveEntry, checkInject };


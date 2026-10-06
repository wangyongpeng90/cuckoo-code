/**
 * Cuckoo 插件系统 - 插件运行时管理器（PluginHost）
 *
 * 统一管理所有 DSH 风格插件（含 dsh/ 和 ui/ 两类）的生命周期：
 *   - 注册 / 加载 / 卸载
 *   - 查询（按名字、按服务、统计）
 *   - 依赖注入（inject）
 *   - 事件总线统一派发
 *
 * 这是"好的插件系统"的核心：把之前分散在 runtime.ts / ui-runtime.ts 的逻辑，
 * 收敛到一个管理器里，让插件系统有统一的视图和生命周期。
 *
 * 设计对齐 DSH：
 *   - 插件是不可变的加载单元，有唯一 name
 *   - 加载有明确的成功/失败结果
 *   - 卸载是"可逆"的（effect 自动清理）
 */
import { loadPluginSource } from './loader.js';
import type { LoadedPlugin } from './loader.js';
import { attachUi } from './ui-runtime.js';
import type { HostCapabilities } from './context.js';
import type { PluginContext } from './types.js';
import { ServiceRegistryImpl } from './service-registry.js';

/** 插件类型 */
export type PluginKind = 'dsh' | 'ui';

/** 一个插件的记录 */
export interface PluginRecord {
  name: string;
  kind: PluginKind;
  plugin: LoadedPlugin;
  loadedAt: number;
}

/** 加载失败记录 */
export interface LoadFailure {
  name: string;
  kind: PluginKind;
  error: string;
}

/** 待加载的插件 */
export interface PendingPluginSource {
  name: string;
  source: string;
  kind: PluginKind;
  /** 插件配置（来自 cordis.patch.yml） */
  config?: any;
  /** 插件 id（= 安装目录名，用于资源访问路径匹配） */
  pluginId?: string;
}

/**
 * 插件宿主：统一管理所有插件
 */
/**
 * 把原始错误翻译成"可操作诊断"。
 * 目标是让插件作者知道哪里错了、怎么修。
 */
export function diagnose(rawError: string, source: { name: string; kind: PluginKind }): string {
  const e = String(rawError || '');
  // 1. ESM 语法残留
  if (/Unexpected token .export.|Cannot use import statement/.test(e)) {
    return "[ESM 语法错误] 插件必须用 ESM 命名导出：export const name / export function apply。原始错误: " + e;
  }
  // 2. 缺 apply
  if (/缺少 apply|apply.*入口/.test(e)) {
    return "[缺入口] 插件必须导出 apply(ctx, config) 函数。原始错误: " + e;
  }
  // 3. 裸 default 导出
  if (/裸 export default/.test(e)) {
    return "[导出方式错误] 不要用 export default，请用 export function apply，否则 inject 会丢失。原始错误: " + e;
  }
  // 4. 语法错误
  if (/SyntaxError|Unexpected token|Unexpected end/.test(e)) {
    return "[语法错误] 插件源码有语法错误，请检查括号/引号是否配对。原始错误: " + e;
  }
  // 5. inject 格式
  if (/inject/.test(e) && /非法|空/.test(e)) {
    return "[inject 非法] inject 必须是非空字符串数组。原始错误: " + e;
  }
  // 6. require 外部模块
  if (/require 外部模块/.test(e)) {
    return "[不支持 require] DSH 插件应自包含，不能 require 外部模块。原始错误: " + e;
  }
  return "[" + source.kind + " 插件加载失败] " + e;
}

export class PluginHost {
  private records = new Map<string, PluginRecord>();
  private failures: LoadFailure[] = [];
  private registry = new ServiceRegistryImpl();
  /** 每个插件的依赖监听清理器 */
  private depCleanups = new Map<string, Array<() => void>>();

  constructor(private host: HostCapabilities) {}

  /** 取服务注册表 */
  get services(): ServiceRegistryImpl {
    return this.registry;
  }

  /** 加载一个插件 */
  load(source: PendingPluginSource): { ok: boolean; error?: string } {
    if (this.records.has(source.name)) {
      return { ok: false, error: '插件已加载: ' + source.name };
    }
    try {
      const isUi = source.kind === 'ui';
      // 资源访问用"插件 id"（安装目录名），而非文件名
      const assetId = source.pluginId || source.name;
      const plugin = loadPluginSource(
        source.source, this.host, source.name, source.config, this.registry,
        // UI 插件：在 apply 之前附加 ctx.ui（用 assetId 作为资源标识）
        isUi ? (ctx) => attachUi(ctx, assetId) : undefined,
      );
      this.records.set(plugin.name, {
        name: plugin.name,
        kind: source.kind,
        plugin,
        loadedAt: Date.now(),
      });
      // T4：跟踪依赖——服务被移除时，卸载依赖它的插件
      for (const svc of plugin.inject || []) {
        const off = this.registry.onRemove(svc, () => {
          console.warn('[plugin] 依赖服务被移除，卸载插件: ' + plugin.name + ' (依赖 ' + svc + ')');
          this.unload(plugin.name);
        });
        this.depCleanups.set(plugin.name, this.depCleanups.get(plugin.name) || []);
        this.depCleanups.get(plugin.name)!.push(off);
      }
      return { ok: true };
    } catch (err: any) {
      const raw = err && err.message ? err.message : String(err);
      const error = diagnose(raw, source);
      this.failures.push({ name: source.name, kind: source.kind, error });
      return { ok: false, error };
    }
  }

  /** 批量加载 */
  loadAll(sources: PendingPluginSource[]): { loaded: string[]; failed: LoadFailure[] } {
    const loaded: string[] = [];
    const before = this.failures.length;
    for (const s of sources) {
      const r = this.load(s);
      if (r.ok) loaded.push(s.name);
    }
    return { loaded, failed: this.failures.slice(before) };
  }

  /** 卸载一个插件 */
  unload(name: string): boolean {
    const rec = this.records.get(name);
    if (!rec) return false;
    try {
      rec.plugin.dispose();
    } catch (err) {
      console.error('[plugin] 卸载插件出错 (' + name + '):', err);
    }
    // 清理依赖监听
    const cleans = this.depCleanups.get(name);
    if (cleans) {
      for (const c of cleans) { try { c(); } catch (_) {} }
      this.depCleanups.delete(name);
    }
    this.records.delete(name);
    return true;
  }

  /** 卸载全部 */
  unloadAll(): void {
    for (const name of Array.from(this.records.keys())) {
      this.unload(name);
    }
    this.failures.length = 0;
  }

  /** 按名字取插件上下文 */
  getContext(name: string): PluginContext | null {
    return this.records.get(name)?.plugin.ctx || null;
  }

  /** 列出已加载插件名 */
  list(): string[] {
    return Array.from(this.records.keys());
  }

  /** 按类型列出 */
  listByKind(kind: PluginKind): string[] {
    return Array.from(this.records.values())
      .filter((r) => r.kind === kind)
      .map((r) => r.name);
  }

  /** 统计信息 */
  stats(): { total: number; dsh: number; ui: number; failed: number } {
    const all = Array.from(this.records.values());
    return {
      total: all.length,
      dsh: all.filter((r) => r.kind === 'dsh').length,
      ui: all.filter((r) => r.kind === 'ui').length,
      failed: this.failures.length,
    };
  }

  /** 取加载失败的记录 */
  getFailures(): LoadFailure[] {
    return this.failures.slice();
  }

  /** 向所有已加载插件广播事件 */
  broadcast(event: string, ...args: any[]): void {
    for (const rec of this.records.values()) {
      const bus = (rec.plugin.ctx as any).__bus;
      if (bus && typeof bus.emit === 'function') {
        try { bus.emit(event, ...args); } catch (err) {
          console.error('[plugin] 广播事件出错 (' + event + '):', err);
        }
      }
    }
  }
}


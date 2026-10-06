/**
 * Cuckoo 插件系统 - 服务注册表
 *
 * DSH 的 `ctx.provide(name, impl)` / `ctx.inject([names], cb)` 机制：
 *   - 插件可以**提供**服务（如 tools、settings、自定义服务）
 *   - 其他插件可以**注入**依赖，服务就绪时自动回调
 *
 * 这是跨插件通信的核心，也是"一切皆插件"的基础。
 * 本模块零依赖，可在 vitest 直接测。
 */

type ReadyCb = () => void;

export class ServiceRegistryImpl implements ServiceRegistryInternal {
  private services = new Map<string, any>();
  private readyCbs = new Map<string, Set<ReadyCb>>();
  private removeCbs = new Map<string, Set<ReadyCb>>();

  provide(name: string, impl: any): () => void {
    if (this.services.has(name)) {
      console.warn('[plugin] 服务重复提供，覆盖旧值: ' + name);
    }
    this.services.set(name, impl);
    // 触发等待该服务的回调
    const cbs = this.readyCbs.get(name);
    if (cbs) {
      for (const cb of Array.from(cbs)) {
        try { cb(); } catch (err) {
          console.error('[plugin] 服务就绪回调出错 (' + name + '):', err);
        }
      }
      this.readyCbs.delete(name);
    }
    return () => {
      this.services.delete(name);
      // 通知"服务已移除"（依赖者可据此卸载）
      const removeCbs = this.removeCbs.get(name);
      if (removeCbs) {
        for (const cb of Array.from(removeCbs)) {
          try { cb(); } catch (err) {
            console.error('[plugin] 服务移除回调出错 (' + name + '):', err);
          }
        }
      }
    };
  }

  /** 监听"某服务被移除"（对齐 DSH：服务消失→依赖者卸载） */
  onRemove(name: string, cb: ReadyCb): () => void {
    if (!this.removeCbs.has(name)) this.removeCbs.set(name, new Set());
    const set = this.removeCbs.get(name)!;
    set.add(cb);
    return () => set.delete(cb);
  }

  get(name: string): any {
    return this.services.get(name);
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  onReady(name: string, cb: ReadyCb): () => void {
    if (this.services.has(name)) {
      cb();
      return () => {};
    }
    if (!this.readyCbs.has(name)) this.readyCbs.set(name, new Set());
    const set = this.readyCbs.get(name)!;
    set.add(cb);
    return () => set.delete(cb);
  }

  /** 清空（测试用） */
  clear(): void {
    this.services.clear();
    this.readyCbs.clear();
    this.removeCbs.clear();
  }
}

export interface ServiceRegistryInternal {
  provide(name: string, impl: any): () => void;
  get(name: string): any;
  has(name: string): boolean;
  onReady(name: string, cb: () => void): () => void;
  onRemove(name: string, cb: () => void): () => void;
  clear(): void;
}

/** 全局单例（整个应用一个服务注册表） */
export const serviceRegistry = new ServiceRegistryImpl();

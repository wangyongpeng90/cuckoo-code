/**
 * Cuckoo 插件系统 - 运行时加载器
 *
 * 职责：在渲染进程里，把主进程扫描到的 DSH 插件文件加载并激活。
 *
 * 流程：
 *   1. 主进程扫描已启用插件目录下的 dsh 子目录（getEnabledPluginDshFiles）
 *   2. 读文件内容，通过 IPC 传给渲染进程（或由调用方注入）
 *   3. 这里用 loadPluginSource 执行，创建 ctx
 *   4. 注册到活跃上下文，绑定 Cuckoo 事件桥
 */
import { loadPluginSource, safeLoad } from './loader.js';
import { serviceRegistry } from './service-registry.js';
import type { LoadedPlugin } from './loader.js';
import type { HostCapabilities } from './context.js';
import { registerContext, unregisterContext, bindCuckooEvents } from './compat/bridge.js';
import type { CuckooEventSource } from './compat/bridge.js';

/** 已加载的 DSH 插件 */
const loaded: LoadedPlugin[] = [];
let unbindEvents: (() => void) | null = null;

/** 一个待加载的插件（名字 + 源码） */
export interface PendingPlugin {
  name: string;
  source: string;
}

/**
 * 加载一组 DSH 插件
 * @param plugins 插件源码列表
 * @param host 宿主能力
 * @param eventSource Cuckoo 事件源（用于事件桥，只需绑定一次）
 */
export function loadPlugins(plugins: PendingPlugin[], host: HostCapabilities, eventSource?: CuckooEventSource): { loaded: string[]; failed: Array<{ name: string; error: string }> } {
  const okNames: string[] = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const p of plugins) {
    const result = safeLoad(() => loadPluginSource(p.source, host, p.name, undefined, serviceRegistry));
    if (result.ok && result.plugin) {
      loaded.push(result.plugin);
      registerContext(result.plugin.ctx);
      okNames.push(result.plugin.name);
    } else {
      failures.push({ name: p.name, error: result.error || '未知错误' });
      console.error('[plugin] 加载插件失败 (' + p.name + '):', result.error);
    }
  }

  // 事件桥只绑一次
  if (eventSource && !unbindEvents) {
    unbindEvents = bindCuckooEvents(eventSource);
  }

  return { loaded: okNames, failed: failures };
}

/** 卸载所有已加载的 DSH 插件 */
export function unloadAllPlugins(): void {
  for (const p of loaded) {
    try {
      unregisterContext(p.ctx);
      p.dispose();
    } catch (err) {
      console.error('[plugin] 卸载插件失败 (' + p.name + '):', err);
    }
  }
  loaded.length = 0;
  if (unbindEvents) {
    unbindEvents();
    unbindEvents = null;
  }
}

/** 取已加载插件名列表 */
export function getLoadedPluginNames(): string[] {
  return loaded.map((p) => p.name);
}

export { safeLoad };

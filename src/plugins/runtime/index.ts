/**
 * Cuckoo 插件系统 - 模块入口
 *
 * 让 Cuckoo 支持 DSH（DeepSeek Harness）风格的插件：
 *   export const name = 'my-plugin'
 *   export const inject = ['agents']
 *   export function apply(ctx, config) { ... }
 *
 * 提供：
 *   - 入口契约解析（loader）
 *   - DSH 风格上下文（context）：服务 + 事件
 *   - 5 种事件派发（events）：emit / parallel / serial / bail / waterfall
 *   - Cuckoo→DSH 事件桥（bridge）
 */
export type {
  // 正式命名（Cuckoo 插件）
  PluginFn, PluginObject, PluginModule, PluginContext, PluginScope,
  // 兼容别名（历史 DSH 命名）
  DshPluginFn, DshPluginObject, DshPluginModule, DshContext, DshScope,
  AgentsService, AgentHandle, ToolsService, SessionsService, SettingsService,
  ServiceName, EventListener, DispatchMode, LoadResult,
} from './types.js';

export { Service } from './service.js';
export { EventBus } from './events.js';
export { createContext } from './context.js';
export type { HostCapabilities } from './context.js';

export { loadPluginModule, loadPluginSource, safeLoad, resolveEntry, checkInject, esmToCjs } from './loader.js';
export type { LoadedPlugin } from './loader.js';

// ===== 兼容层（Cuckoo 内部事件 → 插件事件名）=====
export {
  registerContext, unregisterContext, clearContexts, getActiveContexts,
  bindCuckooEvents, broadcast,
} from './compat/bridge.js';
export type { CuckooEventSource } from './compat/bridge.js';

export {
  loadPlugins, unloadAllPlugins, getLoadedPluginNames,
} from './runtime.js';
export type { PendingPlugin } from './runtime.js';

export { loadUiPlugins, unloadAllUiPlugins } from './ui-runtime.js';
export type { PendingUiPlugin } from './ui-runtime.js';

export { parseCordisPatch, hasPatchDeclared } from './patch.js';
export type { PatchInsert, PatchParseResult } from './patch.js';

export { ServiceRegistryImpl, serviceRegistry } from './service-registry.js';
export type { ServiceRegistryInternal } from './service-registry.js';

// ===== 主题系统（对标 DSH ui-theme）=====
export { ThemeRuntime, DEFAULT_PREFERENCE, BUILTIN_THEMES } from './theme-runtime.js';
export type {
  ThemeService, ThemeSnapshot, ThemeDefinition, ThemeTokens,
  ThemeTokenModes, ThemeTokenOverrides, ThemePreference,
} from './theme-runtime.js';
export { createThemeProxy } from './theme-proxy.js';

export { PluginHost, diagnose } from './plugin-host.js';
export type { PluginKind, PluginRecord, LoadFailure, PendingPluginSource } from './plugin-host.js';

/**
 * 插件模块入口
 *
 * 分层：
 *  - types / paths / manifest / github / state —— 纯 node，零依赖
 *  - market / installer / roots             —— 纯逻辑，HTTP 由注入的 HttpGet 提供
 *  - http                                   —— 唯一依赖 electron 的薄适配层（Electron net）
 *
 * 依赖方向（遵守 docs/arch/02-dependency.md）：
 *  本模块只依赖 infra + node 内置 + tar，**不得反向依赖**
 *  skills / agents / rules / providers / mcp / session / app。
 *  各消费方需要插件贡献时，由上层计算后**作为参数传入**或调用 roots 的查询函数，
 *  不要在本模块里 import 上层。
 */
export type {
  PluginManifest,
  PluginContributes,
  InstalledPlugin,
  PluginOrigin,
  MarketItem,
  RemotePluginInfo,
  PluginState,
} from './types.js';

export {
  MANIFEST_FILE,
  SKILLS_DIR,
  AGENTS_DIR,
  RULES_DIR,
  MCP_FILE,
  PROVIDERS_DIR,
  isValidPluginId,
  getUserDir,
  getPluginsDir,
  getPluginDir,
  getPluginsStateFile,
  getMarketCacheFile,
  getManifestCacheFile,
  getMarketConfigFile,
  listInstalledPluginDirs,
} from './paths.js';

export {
  validateManifest,
  parseManifest,
  readManifest,
  deriveContributes,
} from './manifest.js';

export {
  isValidRepo,
  isValidBranch,
  buildTarballUrl,
  buildRawFileUrl,
  CODELOAD_BASE,
  RAW_BASE,
} from './github.js';

export {
  TOPIC,
  CACHE_TTL_MS,
  MANIFEST_CACHE_TTL_MS,
  buildSearchUrl,
  normalizeRepo,
  readMarketToken,
  searchPlugins,
  fetchRemoteManifests,
} from './market.js';

export {
  INSTALL_META_FILE,
  safeEntryFilter,
  readPluginOrigin,
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
} from './installer.js';

export type { InstallResult } from './installer.js';

export {
  readStateTable,
  writeStateTable,
  isPluginEnabled,
  readPluginState,
  setPluginEnabled,
  clearPluginState,
} from './state.js';

export { createElectronHttpGet } from './http.js';
export type { HttpGet, HttpRequest, HttpResponse } from './http.js';

export {
  getPluginScanRoots,
  getEnabledPluginProviderFiles,
  getEnabledPluginMcpFiles,
} from './roots.js';
export type { PluginScanRoots } from './roots.js';

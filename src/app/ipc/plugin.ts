/**
 * IPC：插件市场与插件管理
 *
 * 网络层在此处注入 Electron net 实现（走 Chromium 网络栈 → 继承系统代理与系统 CA）。
 * 为什么不用 Node 原生 fetch：系统代理（MITM）环境下会 UNABLE_TO_VERIFY_LEAF_SIGNATURE，
 * 详见 src/plugins/http.ts 的说明。
 *
 * 插件是用户级的（~/.cuckoo/plugins/），与"当前项目"无关，故不读 sessionStore。
 * （例外：启用可执行部分后要顺带连接该项目下的 MCP server。）
 */
import { createRequire } from 'node:module';
import {
  searchPlugins,
  fetchRemoteManifests,
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  isPluginEnabled,
  setPluginEnabled,
  createElectronHttpGet,
  getPluginsDir,
} from '../../plugins/index.js';
import { invalidateCustomProvidersCache } from '../../providers/custom/loader.js';
import * as windowState from '../window.js';
import * as mcpClient from '../../mcp/client.js';

const require = createRequire(import.meta.url);
const { ipcMain, shell } = require('electron');

/** 传输层单例（无状态，可复用） */
const httpGet = createElectronHttpGet();

/** 一次远端清单查询允许的最大条数（防渲染侧传入超大数组打爆请求） */
const MAX_REMOTE_TARGETS = 200;

/**
 * 已安装插件的 repo → 摘要映射。
 * 市场页用它判断某条目是否已安装，以及是否需要显示「更新」。
 */
function buildInstalledMap(): Record<string, { id: string; name: string; version: string; installedAt: string }> {
  const out: Record<string, { id: string; name: string; version: string; installedAt: string }> = {};
  for (const p of listInstalledPlugins()) {
    const repo = p.origin && p.origin.repo;
    if (!repo) continue; // 手工放进目录的插件没有来源，无法与市场条目对应
    out[repo] = {
      id: p.manifest.id,
      name: p.manifest.name,
      version: (p.origin && p.origin.version) || p.manifest.version || '',
      installedAt: (p.origin && p.origin.installedAt) || '',
    };
  }
  return out;
}

function registerPluginIpc(): void {
  // ===== 市场：列出 topic:cuckoo-plugin 的仓库 =====
  ipcMain.handle('plugin-market-list', async (_event: any, { force = false }: any = {}) => {
    try {
      const r = await searchPlugins({ httpGet, force: !!force });
      return {
        success: r.success,
        items: r.items,
        fromCache: r.fromCache,
        cachedAt: r.cachedAt,
        error: r.error,
        installed: buildInstalledMap(),
      };
    } catch (err: any) {
      return { success: false, items: [], installed: {}, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 远端 plugin.json：拿插件版本与最低应用版本 =====
  // 搜索接口不返回这些，必须单独拉（raw.githubusercontent，不消耗 API 配额）。
  // 逐条降级：单条失败只影响该条，市场列表本身照常显示。
  ipcMain.handle('plugin-market-remote', async (_event: any, { targets }: any = {}) => {
    try {
      const list = Array.isArray(targets) ? targets.slice(0, MAX_REMOTE_TARGETS) : [];
      const remote = await fetchRemoteManifests({
        httpGet,
        targets: list.map((t: any) => ({ repo: String(t && t.repo || ''), branch: String(t && t.branch || '') })),
      });
      return { success: true, remote };
    } catch (err: any) {
      return { success: false, remote: {}, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 安装 / 更新 =====
  // upgrade=true 时覆盖已安装的同 id 插件。
  ipcMain.handle('plugin-install', async (_event: any, { repo, branch, upgrade }: any = {}) => {
    try {
      const r = await installPlugin({ httpGet, repo, branch, upgrade: !!upgrade });
      if (r.success) invalidateCustomProvidersCache();
      return {
        success: r.success,
        error: r.error,
        upgraded: !!r.upgraded,
        plugin: r.plugin
          ? { id: r.plugin.manifest.id, name: r.plugin.manifest.name, contributes: r.plugin.contributes }
          : undefined,
      };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 卸载 =====
  ipcMain.handle('plugin-uninstall', async (_event: any, { id }: any = {}) => {
    try {
      const r = uninstallPlugin(id);
      if (r.success) invalidateCustomProvidersCache();
      return r;
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 已安装列表（含启用状态与来源）=====
  ipcMain.handle('plugin-list-installed', async () => {
    try {
      const plugins = listInstalledPlugins().map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version || '',
        description: p.manifest.description || '',
        author: p.manifest.author || '',
        minAppVersion: p.manifest.minAppVersion || '',
        dir: p.dir,
        contributes: p.contributes,
        enabled: isPluginEnabled(p.manifest.id),
        // 来源：用于在市场页做"已安装/有更新"比对
        repo: (p.origin && p.origin.repo) || '',
        installedAt: (p.origin && p.origin.installedAt) || '',
        installedVersion: (p.origin && p.origin.version) || '',
      }));
      return { success: true, plugins };
    } catch (err: any) {
      return { success: false, plugins: [], error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 启用 / 禁用（滑块，插件总开关）=====
  // 一个开关管全部：技能/代理/规则的扫描 + providers/*.js 的加载 + mcp.json 的读取。
  // 后两者是"在本机运行第三方代码"，因此默认关闭。
  ipcMain.handle('plugin-set-enabled', async (event: any, { id, enabled }: any = {}) => {
    try {
      const ok = setPluginEnabled(id, !!enabled);
      if (!ok) return { success: false, error: '插件 id 非法' };
      // 让 provider 加载器重新读取
      invalidateCustomProvidersCache();
      // 启用后立即尝试连接该插件带来的 MCP server ——
      // 否则要重新初始化项目才会连上（connectEnabledServers 原本只在初始化时调）
      if (enabled) {
        try {
          const ctx = windowState.getContextByWebContents(event.sender);
          const store = ctx ? ctx.sessionStore : null;
          const projectDir = store ? store.state.selectedProjectDir : null;
          if (projectDir) {
            mcpClient.connectEnabledServers(projectDir).catch(() => { /* 连接失败不影响开关结果 */ });
          }
        } catch { /* 无窗口上下文时跳过 */ }
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 在文件管理器中打开插件目录（便于手工检查）=====
  ipcMain.handle('plugin-open-dir', async () => {
    try {
      const dir = getPluginsDir();
      const err = await shell.openPath(dir);
      return err ? { success: false, error: err } : { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

export { registerPluginIpc };

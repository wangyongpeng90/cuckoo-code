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
  getEnabledPluginDshFiles,
  getEnabledPluginUiFiles,
  getEnabledPluginWebScripts,
} from '../../plugins/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { invalidateCustomProvidersCache } from '../../providers/custom/loader.js';
import { parseCordisPatch } from '../../plugins/runtime/patch.js';
import {
  installAndLoad,
  loadEnabledPlugins,
  loadPluginFromDir,
  uninstallCuckooPlugin,
  unloadPlugin,
  reloadPlugin,
} from '../../plugins/cuckoo-plugins/index.js';
import { resolveClientEntry } from '../../plugins/cuckoo-plugins/loader.js';
import {
  getProfileDir,
  ensureProfile,
  listProfilePluginEntries,
  setPluginEnabledInProfile,
  listProfilePlugins,
  installToProfile,
  uninstallFromProfile,
} from '../../plugins/profile/index.js';
import { registry as toolRegistry } from '../../tools/index.js';
import * as windowState from '../window.js';
import * as mcpClient from '../../mcp/client.js';

const require = createRequire(import.meta.url);
const { ipcMain, shell, app } = require('electron');
const _os = require('node:os');
const _fs = require('node:fs');
const _path = require('node:path');

// ===== 插件槽位存储（对标 DSH slots）=====
// 提升到模块级：DSH 插件 ctx.ui.slot.register 直接调 registerPluginSlot，
// 壳页面通过 plugin-slot-register / shell-slot-register 事件消费。
interface PluginSlot { pluginId: string; slot: string; id: string; order: number; spec: any }
const pluginSlots: PluginSlot[] = [];

/** 注册/更新一个插件槽位（同 pluginId+slot+id 覆盖），并广播给壳页面 */
function registerPluginSlot({ pluginId, slot, id, order, spec }: any = {}): { success: boolean; error?: string } {
  if (!pluginId || !slot || !id) return { success: false, error: '缺 pluginId/slot/id' };
  const o = typeof order === 'number' ? order : 100;
  const exist = pluginSlots.find((s) => s.pluginId === pluginId && s.slot === slot && s.id === id);
  if (exist) { exist.order = o; exist.spec = spec; }
  else pluginSlots.push({ pluginId, slot, id, order: o, spec });
  const mainWin: any = (windowState as any).getMainWindow ? (windowState as any).getMainWindow() : null;
  if (mainWin && mainWin.webContents) mainWin.webContents.send('shell-slot-register', { pluginId, slot, id, order: o, spec });
  return { success: true };
}

/** 注销一个插件槽位（返回是否删除了） */
function unregisterPluginSlot(pluginId: string, slot: string, id: string): boolean {
  const idx = pluginSlots.findIndex((s) => s.pluginId === pluginId && s.slot === slot && s.id === id);
  if (idx >= 0) { pluginSlots.splice(idx, 1); return true; }
  return false;
}

/** 列出所有插件槽位 */
function listPluginSlots(): PluginSlot[] { return pluginSlots.slice(); }

export { registerPluginSlot, unregisterPluginSlot, listPluginSlots };

/**
 * 加载插件"网页注入脚本"（CommonJS）。用 .cjs 临时副本，避免项目 type:module 干扰。
 * 返回模块导出（{ name, match, script }）或抛错。
 */
function loadPluginScriptModule(file: string): any {
  const tmpDir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cuckoo-pluginscript-'));
  const tmp = _path.join(tmpDir, _path.basename(file).replace(/\.js$/i, '') + '.cjs');
  try {
    _fs.copyFileSync(file, tmp);
    return require(tmp);
  } finally {
    try { _fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    try { _fs.rmdirSync(tmpDir); } catch (_) { /* ignore */ }
  }
}

/** 传输层单例（无状态，可复用） */
const httpGet = createElectronHttpGet();

/**
 * 读取插件根的 cordis.patch.yml 并解析为 config。
 * DSH 插件用它声明插入项；Cuckoo 把它作为 apply(ctx, config) 的 config 传入。
 * 找不到文件时返回 undefined（不报错）。
 */
function readPatchConfig(pluginDir: string, pluginId?: string): any {
  try {
    const patchFile = path.join(pluginDir, 'cordis.patch.yml');
    if (!fs.existsSync(patchFile)) return undefined;
    const text = fs.readFileSync(patchFile, 'utf-8');
    // 用 Cuckoo 的 patch 解析器，提取 insert 的 config
    const parsed = parseCordisPatch(text);
    if (!parsed.ok) return undefined;
    // 优先匹配插件 id/name 的 insert；找不到则用第一个带 config 的
    const hit = parsed.inserts.find(
      (i) => (pluginId && (i.id === pluginId || i.name === pluginId)) || (i.config && Object.keys(i.config).length > 0),
    );
    if (hit && hit.config) return hit.config;
    return undefined;
  } catch {
    return undefined;
  }
}

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
  // ===== P1：DSH plugin-manager RPC（对齐 remote.pluginManager / remote.pluginInventory）=====
  /** 把 profile 的插件列表 + patch 状态合成 BundleInfo[]（DSH 契约） */
  function buildBundleInfos(): any[] {
    const declared = listProfilePlugins();
    const entries = listProfilePluginEntries();
    const entryByName = new Map<string, any>();
    for (const e of entries) entryByName.set(e.name, e);
    return declared.map((p: any) => {
      const e = entryByName.get(p.name);
      let version: string | undefined;
      let description: string | undefined;
      let rows: any[] = [];
      let meta: any = undefined;
      try {
        if (p.dir) {
          const pkg = JSON.parse(fs.readFileSync(path.join(p.dir, "package.json"), "utf-8"));
          version = pkg.version;
          description = pkg.description;
          // meta：本地化显示（title + description）
          meta = { title: pkg.name || p.name, description: pkg.description };
          // rows：读 bundle patch（dsh.bundle.patch 指向的 cordis.patch.yml）
          const patchRel = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
          if (patchRel) {
            const patchPath = path.join(p.dir, patchRel);
            if (fs.existsSync(patchPath)) {
              const { parseBundlePatch } = require('../../plugins/profile/patch.js');
              const patchRows = parseBundlePatch(fs.readFileSync(patchPath, 'utf-8'));
              // 找 row 对应的 entryId（listPlugins 的 entryId = 包名转 kebab）
              const entries = listProfilePluginEntries();
              const entryByModule = new Map<string, any>();
              for (const en of entries) entryByModule.set(en.name, en);
              rows = patchRows.map((r: any) => {
                const entry = entryByModule.get(r.moduleName);
                return {
                  rowId: r.rowId,
                  moduleName: r.moduleName,
                  entryId: entry ? entry.id : undefined,  // ← 关键：前端用它判"可开关"
                  enabled: entry ? !!entry.enabled : false,
                };
              });
            }
          }
        }
      } catch (_) {}
      return {
        name: p.name, version, description, meta,
        enabled: e ? !!e.enabled : false,
        installed: !!p.installed,
        optional: false, removable: true,
        rows, overrides: [],
      };
    });
  }
  /** 把 profile 条目合成 PluginInfo[]（DSH 契约） */
  function buildPluginInfos(): any[] {
    return listProfilePluginEntries().map((e: any) => ({
      entryId: e.id, moduleName: e.name,
      enabled: !!e.enabled, fiberPhase: e.enabled ? "active" : null,
    }));
  }
  ipcMain.handle("plugin-manager-list-bundles", async () => {
    try { return { ok: true, value: buildBundleInfos() }; }
    catch (e: any) { return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } }; }
  });
  ipcMain.handle("plugin-manager-list-plugins", async () => {
    try { return { ok: true, value: buildPluginInfos() }; }
    catch (e: any) { return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } }; }
  });
  ipcMain.handle("plugin-manager-set-enabled", async (_e: any, { id, enabled }: any = {}) => {
    try {
      // 前端可能传"包名"（详情页）或"entryId"（rows 开关）——统一解析成包名
      const { packageNameToId } = await import('../../plugins/profile/installer.js');
      const raw = String(id || "");
      // 是包名？直接查 manifest.dependencies
      const { readProfileManifest } = await import('../../plugins/profile/manifest.js');
      const { getProfileDir } = await import('../../plugins/profile/paths.js');
      const { DEFAULT_PROFILE } = await import('../../plugins/profile/paths.js');
      const pdir = getProfileDir(DEFAULT_PROFILE);
      const deps = (readProfileManifest(pdir, DEFAULT_PROFILE).dependencies) || {};
      let pkgName = raw;
      if (!deps[raw]) {
        // 不是包名 → 可能是 entryId，反查
        for (const name of Object.keys(deps)) {
          if (packageNameToId(name) === raw) { pkgName = name; break; }
        }
      }
      const pid = packageNameToId(pkgName);
      const on = !!enabled;
      // 1) 写 cordis.patch.yml（用包名，对齐 listProfilePluginEntries 的检查）
      setPluginEnabledInProfile(pkgName, on);
      // 2) HMR：立即加载/卸载
      let hmrOk = false;
      let hmrError: string | undefined;
      try {
        console.log('[HMR] set-enabled: pkg=' + pkgName + ' id=' + pid + ' on=' + on);
        const { buildCuckooHost } = await import('../cuckoo-host.js');
        const host = buildCuckooHost({ db: (global as any).__globalDb, logicIdMap: (global as any).__globalLogicIdMap });
        if (on) {
          const r = await reloadPlugin(pid, toolRegistry, host);
          hmrOk = r.ok;
          if (!r.ok) hmrError = r.error;
        } else {
          hmrOk = unloadPlugin(pid, toolRegistry);
        }
        console.log('[HMR] 结果: ok=' + hmrOk + ' err=' + (hmrError || '无'));
      } catch (e: any) {
        hmrError = e && e.message ? e.message : String(e);
        console.log('[HMR] 异常: ' + hmrError);
      }
      // 3) 广播（带 hmr 结果 + 通知壳页面重载 client + 刷新壳）
      try {
        const { BrowserWindow } = require('electron');
        const allWins = BrowserWindow.getAllWindows();
        console.log('[HMR] 广播到 ' + allWins.length + ' 个窗口');
        for (const w of allWins) {
          if (!w.webContents || w.webContents.isDestroyed()) continue;
          w.webContents.send('plugin-manager-changed', { reason: 'bundle', reloaded: hmrOk, pluginId: pid, enabled: on });
          w.webContents.send('cuckoo-reload-dsh-clients', { pluginId: pkgName, enabled: on });
          // 壳页面自动刷新（确保槽状态/设置页与插件启停一致；800ms 让 IPC 响应先回去）
          setTimeout(() => { try { console.log('[HMR] reload 窗口 ' + w.id); w.webContents.reload(); } catch (e) { console.log('[HMR] reload 异常: ' + e); } }, 800);
        }
      } catch (e: any) { console.log('[HMR] 广播异常: ' + (e && e.message ? e.message : e)); }
      return {
        ok: true,
        value: {
          changed: true,
          application: hmrOk ? "applied" : "restart-required",
          ...(hmrError ? { error: { code: "operation-error", message: hmrError, diagnostic: hmrError } } : {}),
        },
      };
    }
    catch (e: any) { return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } }; }
  });
  ipcMain.handle("plugin-manager-remove-bundle", async (_e: any, { name }: any = {}) => {
    try {
      const pkgName = String(name || "");
      const r = await uninstallFromProfile(pkgName);
      if (!r.ok) return { ok: false, error: { code: "operation-error", message: r.error, diagnostic: r.error } };
      // HMR：卸载插件（若有加载）
      try {
        const { packageNameToId } = await import('../../plugins/profile/installer.js');
        unloadPlugin(packageNameToId(pkgName), toolRegistry);
      } catch (_) {}
      try {
        const { BrowserWindow } = require('electron');
        const allWins = BrowserWindow.getAllWindows();
        console.log('[HMR] remove 广播到 ' + allWins.length + ' 个窗口');
        for (const w of allWins) {
          if (!w.webContents || w.webContents.isDestroyed()) continue;
          w.webContents.send('plugin-manager-changed', { reason: 'remove' });
          w.webContents.send('cuckoo-reload-dsh-clients', { pluginId: pkgName, enabled: false });
          setTimeout(() => { try { console.log('[HMR] remove reload 窗口 ' + w.id); w.webContents.reload(); } catch (e) { console.log('[HMR] remove reload 异常: ' + e); } }, 800);
        }
      } catch (e: any) { console.log('[HMR] remove 广播异常: ' + (e && e.message ? e.message : e)); }
      return { ok: true, value: { changed: true, application: "applied", stage: "remove", target: pkgName } };
    } catch (e: any) { return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } }; }
  });
  ipcMain.handle("plugin-manager-install-bundle", async (_e: any, { spec, opts }: any = {}) => {
    try {
      const pkgName = String(spec || "");
      const requestId = (opts && opts.requestId) ? String(opts.requestId) : undefined;
      const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const mw: any = (windowState as any).getMainWindow ? (windowState as any).getMainWindow() : null;
      const send = (ch: string, d: any) => { try { if (mw && mw.webContents) mw.webContents.send(ch, d); } catch (_) {} };
      // 1) install-state: installing
      send('plugin-manager-install-state', { requestId, phase: 'installing' });
      // 2) 流式输出 → install-log
      const onData = (text: string) => {
        send('plugin-manager-install-log', { requestId, jobId, argv: ['pnpm', 'add', pkgName], cwd: '', stream: 'stdout', text });
      };
      const r = await installToProfile(pkgName, undefined as any, onData);
      // 3) 最终 log（exitCode）
      send('plugin-manager-install-log', { requestId, jobId, argv: ['pnpm', 'add', pkgName], cwd: '', stream: 'stdout', text: '', exitCode: r.ok ? 0 : 1 });
      if (!r.ok) {
        send('plugin-manager-install-state', { requestId, phase: 'applying' });
        return { ok: false, error: { code: "operation-error", message: r.error, diagnostic: r.error } };
      }
      // 4) bundle 检查：必须声明 dsh.bundle.patch（不是普通 npm 包）
      try {
        const pkgDir = r.pluginDir;
        let isBundle = false;
        if (pkgDir) {
          const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
          isBundle = !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch);
        }
        if (!isBundle) {
          // 回滚（卸载刚装的）
          try { const { uninstallFromProfile } = await import('../../plugins/profile/installer.js'); await uninstallFromProfile(pkgName); } catch (_) {}
          send('plugin-manager-install-state', { requestId, phase: 'applying' });
          return { ok: false, error: { code: "not-bundle", message: '这个包不是 DSH 插件 bundle（没有 dsh.bundle.patch）', diagnostic: '这个包不是 DSH 插件 bundle（没有 dsh.bundle.patch）' } };
        }
      } catch (_) {}
      send('plugin-manager-install-state', { requestId, phase: 'applying' });
      send('plugin-manager-changed', { reason: 'install' });
      return { ok: true, value: { changed: true, application: "restart-required", stage: "install", target: r.name, bundle: r.name } };
    } catch (e: any) { return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } }; }
  });
  ipcMain.handle("plugin-manager-inspect", async (_e: any, { spec }: any = {}) => {
    const s = String(spec || "").trim();
    if (!s) return { ok: true, value: { status: "refused", problem: "invalid-spec", reason: "包名不能为空" } };
    // ===== 真检查（对齐 DSH PluginSpecInspection 契约）=====
    try {
      // 1) 本地目录（path:）
      if (/^(file|link):|^\.\.?[/\\]/.test(s)) {
        try {
          const abs = path.resolve(s.replace(/^(file|link):/, ''));
          const pkgPath = path.join(abs, 'package.json');
          if (!fs.existsSync(pkgPath)) {
            return { ok: true, value: { status: "refused", problem: "not-found", reason: "目录下没有 package.json: " + abs } };
          }
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const isBundle = !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch);
          return { ok: true, value: { status: "accepted", kind: "path", name: pkg.name, version: pkg.version, description: pkg.description, bundle: isBundle, registry: null } };
        } catch (e: any) {
          return { ok: true, value: { status: "refused", problem: "invalid-spec", reason: "路径无效: " + (e && e.message ? e.message : String(e)) } };
        }
      }
      // 2) Git（github:owner/repo / git+https://...）
      if (/^(github:|git\+|git:)/.test(s) || /github\.com/.test(s)) {
        return { ok: true, value: { status: "accepted", kind: "git", name: s, bundle: null, registry: null, host: 'github.com' } };
      }
      // 3) tarball（http(s)://...tgz / .tar.gz）
      if (/^https?:\/\//.test(s) && /\.(tgz|tar\.gz)$/i.test(s)) {
        return { ok: true, value: { status: "accepted", kind: "tarball", name: s, bundle: null, registry: null } };
      }
      // 4) npm registry（默认）——查 registry 看包存不存在
      const bareName = s.replace(/@[\w.^~-]+$/, '');
      // 校验包名
      if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(bareName)) {
        return { ok: true, value: { status: "refused", problem: "invalid-spec", reason: "包名非法: " + s } };
      }
      const regUrl = 'https://registry.npmjs.org/' + encodeURIComponent(bareName).replace(/%40/g, '@').replace(/%2F/g, '/');
      let version: string | undefined;
      let description: string | undefined;
      let isBundle = false;
      let registryAnswer = true;
      try {
        const res = await httpGet({ url: regUrl, timeoutMs: 15000 });
        if (res.status === 404) {
          return { ok: true, value: { status: "refused", problem: "not-found", reason: "npm 上找不到这个包: " + bareName } };
        }
        if (res.status !== 200) {
          return { ok: true, value: { status: "refused", problem: "network", reason: "registry 返回 " + res.status } };
        }
        const meta = JSON.parse(res.body.toString('utf-8'));
        const latest = (meta && meta['dist-tags'] && meta['dist-tags'].latest) || undefined;
        version = latest;
        if (latest && meta.versions && meta.versions[latest]) {
          const v = meta.versions[latest];
          description = v.description || (meta.description) || undefined;
          isBundle = !!(v.dsh && v.dsh.bundle && v.dsh.bundle.patch);
        } else {
          description = meta.description;
        }
      } catch (e: any) {
        registryAnswer = false;
        // 网络失败——不阻断（让 pnpm 试）
        return { ok: true, value: { status: "accepted", kind: "registry", name: bareName, bundle: null, registry: null, host: 'registry.npmjs.org' } };
      }
      // 5) 不是 bundle → 拒绝（对齐 DSH "not-a-bundle"）
      if (registryAnswer && !isBundle) {
        return { ok: true, value: { status: "refused", problem: "not-a-bundle", reason: "这个包不是 DSH 插件 bundle（没有 dsh.bundle.patch）: " + bareName } };
      }
      return { ok: true, value: { status: "accepted", kind: "registry", name: bareName, version, description, bundle: isBundle, registry: null, host: 'registry.npmjs.org' } };
    } catch (e: any) {
      return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } };
    }
  });
  ipcMain.handle("plugin-manager-cancel-install", async () => ({ ok: true, value: { status: "not-running" } }));
  ipcMain.handle("plugin-inventory-list", async () => {
    try { return { ok: true, value: { managementAvailable: true, entries: buildPluginInfos() } }; }
    catch (e: any) { return { ok: false, error: { code: "operation-error", message: e && e.message ? e.message : String(e), diagnostic: e && e.message ? e.message : String(e) } }; }
  });

  // ===== 网页注入脚本：已启用插件的 scripts/*.js（供 bridge 注入 AI 页面主世界） =====
  ipcMain.handle('get-plugin-web-scripts', async () => {
    try {
      const out: any[] = [];
      for (const { pluginId, file } of getEnabledPluginWebScripts()) {
        try {
          const mod = loadPluginScriptModule(file);
          if (mod && typeof mod.script === 'string' && mod.script.trim()) {
            out.push({
              name: String(mod.name || pluginId),
              match: typeof mod.match === 'string' ? mod.match : '',
              script: mod.script,
            });
          }
        } catch (err: any) {
          console.error('[Plugin] 加载网页脚本失败:', file, err && err.message);
        }
      }
      return { success: true, scripts: out };
    } catch (err: any) {
      return { success: false, scripts: [], error: err && err.message ? err.message : String(err) };
    }
  });

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
        // 是否有配置 schema（决定是否显示"配置"按钮）
        hasConfig: !!(p.manifest.config && Object.keys(p.manifest.config).length > 0),
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
      // 广播：插件启用状态变了，通知所有窗口热重载 DSH/UI 插件
      try {
        for (const ctx of windowState.getAllContexts()) {
          const wc = ctx && ctx.view && ctx.view.webContents;
          if (wc && !wc.isDestroyed() && typeof wc.send === 'function') {
            wc.send('plugin-reload-needed');
          }
        }
      } catch { /* 无多窗口 API 时跳过 */ }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== DSH 风格插件：返回已启用插件的 dsh/*.js 源码 =====
  // 渲染进程读不了 fs，由主进程读源码后传给渲染进程执行。
  // 安全：只返回【已启用】插件的文件（与 providers 同级，默认关闭）。
  // 同时读取插件根的 cordis.patch.yml，解析出 config 一并回传（供 apply(ctx, config)）。
  ipcMain.handle('plugin-sources', async () => {
    try {
      const files = getEnabledPluginDshFiles();
      const plugins: Array<{ name: string; source: string; file: string; config?: any; pluginId: string }> = [];
      for (const file of files) {
        try {
          const source = fs.readFileSync(file, 'utf-8');
          const base = path.basename(file, '.js');
          // 插件目录 = dsh 的上一级
          const pluginDir = path.dirname(path.dirname(file));
          const pluginId = path.basename(pluginDir);
          // cordis.patch.yml 的 config + 用户配置（后者优先）
          let config = readPatchConfig(pluginDir, base);
          try {
            const { getPluginConfig } = await import('../../plugins/plugins-config.js');
            const userCfg = getPluginConfig(pluginId);
            if (userCfg && Object.keys(userCfg).length > 0) {
              config = Object.assign({}, config || {}, userCfg);
            }
          } catch (_) {}
          plugins.push({ name: base, source, file, config, pluginId });
        } catch (err: any) {
          console.error('[plugin-dsh] 读取失败:', file, err && err.message);
        }
      }
      return { success: true, plugins };
    } catch (err: any) {
      return { success: false, plugins: [], error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== UI 扩展：返回已启用插件的 ui/*.js 源码 =====
  ipcMain.handle('plugin-ui-sources', async () => {
    try {
      const files = getEnabledPluginUiFiles();
      const plugins: Array<{ name: string; source: string; file: string; pluginId: string; config?: any }> = [];
      for (const file of files) {
        try {
          const source = fs.readFileSync(file, 'utf-8');
          const base = path.basename(file, '.js');
          // 插件目录 = ui 的上一级；目录名即插件 id（与 ~/.cuckoo/plugins/<id>/ 约定一致）
          const pluginId = path.basename(path.dirname(path.dirname(file)));
          // 用户配置（plugins-config.json），供 apply(ctx, config) 用
          let config: any = undefined;
          try {
            const { getPluginConfig } = await import('../../plugins/plugins-config.js');
            config = getPluginConfig(pluginId);
          } catch (_) {}
          plugins.push({ name: base, source, file, pluginId, config });
        } catch (err: any) {
          console.error('[plugin-ui] 读取失败:', file, err && err.message);
        }
      }
      return { success: true, plugins };
    } catch (err: any) {
      return { success: false, plugins: [], error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 插件配置（用户改，壳页面用）=====
  // 取某插件的配置 schema（来自 plugin.json 的 config）+ 当前值
  ipcMain.handle('plugin-config-get', async (_event: any, { pluginId }: any = {}) => {
    try {
      if (!pluginId) return { success: false, error: '缺少 pluginId' };
      const plugins = listInstalledPlugins();
      const target = plugins.find((p: any) => p.manifest && p.manifest.id === pluginId);
      if (!target) return { success: false, error: '插件不存在: ' + pluginId };
      const schema = target.manifest.config || {};
      const { getPluginConfig } = await import('../../plugins/plugins-config.js');
      const values = getPluginConfig(pluginId, schema);
      return { success: true, schema, values };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 存某插件的配置
  ipcMain.handle('plugin-config-set', async (_event: any, { pluginId, values }: any = {}) => {
    try {
      if (!pluginId) return { success: false, error: '缺少 pluginId' };
      const { setPluginConfig } = await import('../../plugins/plugins-config.js');
      const ok = setPluginConfig(pluginId, values || {});
      return { success: ok, error: ok ? undefined : '写入失败' };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 插件工具注册（渲染进程 → 主进程）=====
  // 插件注册的工具，执行时会反向 IPC 回渲染进程执行。
  ipcMain.handle('plugin-tool-register', async (event: any, info: any = {}) => {
    try {
      const { registerPluginToolFromRenderer } = await import('../plugin-tools.js');
      return registerPluginToolFromRenderer(event.sender, info);
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('plugin-tool-unregister', async (_event: any, { toolId }: any = {}) => {
    try {
      const { unregisterPluginTool } = await import('../plugin-tools.js');
      unregisterPluginTool(toolId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.on('plugin-tool-result', (_event: any, { callId, result }: any = {}) => {
    const { resolvePendingToolCall } = require('../plugin-tools.js');
    resolvePendingToolCall(callId, result);
  });

  // ===== 插件调试日志（渲染进程 → 写文件，便于排查）=====
  ipcMain.on('plugin-debug-log', (_event: any, { msg }: any = {}) => {
    try {
      const dir = path.join(app.getPath('userData'), '..');
      const logFile = path.join(app.getPath('userData'), 'plugin-debug.log');
      const line = new Date().toISOString() + ' ' + String(msg || '') + '\n';
      fs.appendFileSync(logFile, line, 'utf-8');
    } catch (_) { /* ignore */ }
  });

  // ===== 系统总累计 token（主进程 token-stats.json）=====
  ipcMain.handle('plugin-token-total', async () => {
    try {
      const stats = await import('../token-stats.js');
      return { success: true, total: stats.getTotal() };
    } catch (err: any) {
      return { success: false, total: 0, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 注入代码到主世界（AI 页面主世界，contextIsolation 下）=====
  ipcMain.handle('plugin-inject-main-world', async (event: any, { code }: any = {}) => {
    try {
      if (typeof code !== 'string') return { success: false, error: '缺少 code' };
      // webContents.executeJavaScript 在"主世界"执行（等价 CDP）
      await event.sender.executeJavaScript(code);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 读插件资源文件（供 UI 插件加载模型/图片等）=====
  // 安全：只允许读【已启用插件】目录下的文件，且防路径穿越。
  ipcMain.handle('plugin-read-asset', async (_event: any, { pluginId, relPath }: any = {}) => {
    try {
      if (typeof pluginId !== 'string' || !pluginId) return { success: false, error: '缺少 pluginId' };
      if (typeof relPath !== 'string' || !relPath) return { success: false, error: '缺少 relPath' };
      // 找已安装插件目录
      const plugins = listInstalledPlugins();
      const target = plugins.find((p: any) => p.manifest && p.manifest.id === pluginId);
      if (!target) return { success: false, error: '插件不存在: ' + pluginId };
      if (!isPluginEnabled(pluginId)) return { success: false, error: '插件未启用: ' + pluginId };
      const root = target.dir;
      // 防路径穿越
      const abs = path.resolve(root, relPath);
      const prefix = root.endsWith(path.sep) ? root : root + path.sep;
      if (abs !== root && !abs.startsWith(prefix)) {
        return { success: false, error: '路径越界' };
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return { success: false, error: '文件不存在: ' + relPath };
      }
      const buf = fs.readFileSync(abs);
      return { success: true, base64: buf.toString('base64'), size: buf.length };
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

  // ===== Cuckoo 插件（DSH 兼容）：npm 安装 + 加载 + 启停 =====
  // 列表：已安装的 Cuckoo 插件（~/.cuckoo/cuckoo-plugins/）
  ipcMain.handle('cuckoo-plugin-list', async () => {
    try {
      const plugins = listProfilePluginEntries().map((entry) => {
        let name = entry.name, version = '', description = '';
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(entry.dir, 'package.json'), 'utf-8'));
          name = pkg.name || entry.name; version = pkg.version || ''; description = pkg.description || '';
        } catch (_) { /* ignore */ }
        return { id: entry.id, name, version, description, enabled: entry.enabled };
      });
      return { success: true, plugins };
    } catch (err: any) {
      return { success: false, plugins: [], error: err && err.message ? err.message : String(err) };
    }
  });

  // 安装（npm 下载 + 加载 + 注册工具）
  ipcMain.handle('cuckoo-plugin-install', async (_event: any, { pkgName }: any = {}) => {
    try {
      if (!pkgName || typeof pkgName !== 'string') return { success: false, error: '缺少包名' };
      const r = await installAndLoad(pkgName, toolRegistry);
      return { success: true, id: r.id, pluginName: r.pluginName, tools: r.tools };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 卸载（从 profile 移除；重启生效）
  ipcMain.handle('cuckoo-plugin-uninstall', async (_event: any, { id }: any = {}) => {
    try {
      const ok = await uninstallCuckooPlugin(id);
      if (!ok) return { success: false, error: '未找到插件: ' + id };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 启用/禁用（写 cordis.patch.yml；重启生效；启用时若工具未注册则立即注册）
  ipcMain.handle('cuckoo-plugin-toggle', async (_event: any, { id, enabled }: any = {}) => {
    try {
      if (!id || typeof id !== 'string') return { success: false, error: '缺少插件 id' };
      setPluginEnabledInProfile(id, !!enabled);
      if (enabled) {
        // 尝试立即加载（工具已注册会覆盖告警，无碍）
        const entry = listProfilePluginEntries().find((e) => e.id === id);
        if (entry) { try { await loadPluginFromDir(entry.dir, toolRegistry); } catch (_) { /* 已加载或失败，重启兜底 */ } }
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 打开 Cuckoo 插件目录（profile 目录）
  ipcMain.handle('cuckoo-plugin-open-dir', async () => {
    try {
      const dir = ensureProfile();
      fs.mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      return err ? { success: false, error: err } : { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 插件命令（ctx.command）=====
  ipcMain.handle('plugin-command-register', async (event: any, info: any = {}) => {
    try {
      const { registerCommandFromRenderer } = await import('../plugin-commands.js');
      return registerCommandFromRenderer(event.sender, info);
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.handle('plugin-command-unregister', async (_event: any, { commandId }: any = {}) => {
    try {
      const { unregisterCommand } = await import('../plugin-commands.js');
      unregisterCommand(commandId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.handle('plugin-command-list', async () => {
    try {
      const { listCommands } = await import('../plugin-commands.js');
      return { success: true, commands: listCommands() };
    } catch (err: any) {
      return { success: false, commands: [], error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.handle('plugin-command-invoke', async (_event: any, { commandId }: any = {}) => {
    try {
      const { invokeCommand } = await import('../plugin-commands.js');
      return await invokeCommand(commandId);
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.on('plugin-command-result', (_event: any, { runId, result }: any = {}) => {
    try {
      // 动态 import 拿 resolve
      import('../plugin-commands.js').then((m) => m.resolvePendingCommandRun(runId, result)).catch(() => {});
    } catch (_) {}
  });

  // ===== 插件槽位（通用挂载：具名槽位 + order，对标 DSH slots）=====
  // 存储与注册函数已提升到模块级（registerPluginSlot / unregisterPluginSlot / listPluginSlots），
  // 供 cuckoo-host 注入给插件 ctx（DSH 插件调 ctx.ui.slot.register 时直接落到这里）。
  ipcMain.handle('plugin-slot-register', async (_event: any, m: any = {}) => {
    try { return registerPluginSlot(m); }
    catch (err: any) { return { success: false, error: err && err.message ? err.message : String(err) }; }
  });
  ipcMain.handle('plugin-slot-unregister', async (_event: any, { pluginId, slot, id }: any = {}) => {
    try {
      const ok = unregisterPluginSlot(pluginId, slot, id);
      const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
      if (ok && mainWin && mainWin.webContents) mainWin.webContents.send('shell-slot-unregister', { pluginId, slot, id });
      return { success: true };
    } catch (err: any) { return { success: false, error: err && err.message ? err.message : String(err) }; }
  });
  ipcMain.handle('plugin-slot-list', async () => ({ success: true, slots: listPluginSlots() }));

  // ===== DSH 插件 client 入口源码（壳页面加载执行）=====
  // 返回已启用的 profile 插件的 ./client 源码。
  // 壳页面用最小 DSH 运行时（window.__ModuleLoader__ + React require）执行它。
  ipcMain.handle('cuckoo-plugin-client-sources', async () => {
    try {
      const out: Array<{ pluginId: string; pkgName: string; source: string }> = [];
      const { isIncompatibleDshPackage } = await import('../../plugins/profile/loader.js');
      for (const entry of listProfilePluginEntries()) {
        if (!entry.enabled) continue;
        // 跳过已知不兼容的 DSH 包（如 @deepseek-ai/dsh-experimental-*）
        if (isIncompatibleDshPackage(entry.name)) continue;
        try {
          const c = resolveClientEntry(entry.dir);
          if (!c) continue;
          const source = fs.readFileSync(c.file, 'utf-8');
          out.push({ pluginId: entry.id, pkgName: c.pkgName, source });
        } catch (err: any) {
          console.error('[plugin-client] 读取失败:', entry.dir, err && err.message);
        }
      }
      return { success: true, clients: out };
    } catch (err: any) {
      return { success: false, clients: [], error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 插件界面挂载（Cuckoo 壳页面：侧边栏/状态栏/工具栏）=====
  // 缓存已挂载请求（壳页面可能晚于插件加载；就绪后补发）
  const shellMounts: Array<{ pluginId: string; target: string; id: string; spec: any }> = [];
  ipcMain.handle('plugin-shell-mount', async (_event: any, { pluginId, target, id, spec }: any = {}) => {
    try {
      if (typeof pluginId !== 'string' || !pluginId) return { success: false, error: '缺少 pluginId' };
      if (typeof target !== 'string' || !target) return { success: false, error: '缺少 target' };
      // 记录（去重）
      const exist = shellMounts.find(m => m.pluginId === pluginId && m.target === target && m.id === id);
      if (exist) { exist.spec = spec; } else { shellMounts.push({ pluginId, target, id, spec }); }
      // 转发给壳页面
      const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
      try {
        const api0 = (globalThis as any);
        // 简易日志：写插件调试日志
        const { ipcMain: _im } = require('electron');
      } catch (_) {}
      if (!mainWin || !mainWin.webContents) return { success: false, error: '无主窗口' };
      mainWin.webContents.send('shell-plugin-mount', { pluginId, target, id, spec });
      return { success: true, _debug: { senderId: undefined, mainWinId: mainWin.id, webContentsId: mainWin.webContents.id, total: shellMounts.length } };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
  // 壳页面就绪后拉取（补发之前缓存的挂载）
  ipcMain.handle('plugin-shell-list', async () => {
    return { success: true, mounts: shellMounts };
  });

  // ===== 插件注入壳页面 CSS（对标 DSH styles.insert）=====
  // 插件往 Cuckoo 壳页面注入任意 CSS（壁纸/字体/布局）。不碰 AI 页面。
  const shellStyles: Array<{ pluginId: string; css: string }> = [];
  ipcMain.handle('plugin-shell-style-add', async (_event: any, { pluginId, css }: any = {}) => {
    try {
      if (typeof pluginId !== 'string' || !pluginId) return { success: false, error: '缺少 pluginId' };
      if (typeof css !== 'string' || !css) return { success: false, error: '缺少 css' };
      // 去重：同插件再注入则替换
      const exist = shellStyles.find(s => s.pluginId === pluginId);
      if (exist) exist.css = css; else shellStyles.push({ pluginId, css });
      const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
      if (mainWin && mainWin.webContents) {
        mainWin.webContents.send('shell-plugin-style', { pluginId, css });
      }
      // 纯净模式页面（harness）也推：让它的面板透明，透出下层壳页面壁纸
      try {
        for (const c of windowState.getAllContexts()) {
          const hv = (c as any).harnessView;
          if (hv && hv.webContents && !hv.webContents.isDestroyed()) {
            hv.webContents.send('harness-plugin-style', { pluginId, css });
          }
        }
      } catch (_) {}
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.handle('plugin-shell-style-remove', async (_event: any, { pluginId }: any = {}) => {
    try {
      const idx = shellStyles.findIndex(s => s.pluginId === pluginId);
      if (idx >= 0) shellStyles.splice(idx, 1);
      const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
      if (mainWin && mainWin.webContents) {
        mainWin.webContents.send('shell-plugin-style-remove', { pluginId });
      }
      try {
        for (const c of windowState.getAllContexts()) {
          const hv = (c as any).harnessView;
          if (hv && hv.webContents && !hv.webContents.isDestroyed()) {
            hv.webContents.send('harness-plugin-style-remove', { pluginId });
          }
        }
      } catch (_) {}
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.handle('plugin-shell-style-list', async () => {
    return { success: true, styles: shellStyles };
  });

  // ===== 插件设窗口材质（Win11 亚克力/Mica；纯 Electron 层）=====
  ipcMain.handle('plugin-set-window-material', async (_event: any, { material }: any = {}) => {
    try {
      const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
      if (!mainWin || mainWin.isDestroyed()) return { success: false, error: '无主窗口' };
      if (typeof mainWin.setBackgroundMaterial !== 'function') return { success: false, error: '当前平台不支持窗口材质（需 Win11）' };
      const m = typeof material === 'string' ? material : 'none';
      mainWin.setBackgroundMaterial(m);
      return { success: true };
    } catch (err: any) { return { success: false, error: err && err.message ? err.message : String(err) }; }
  });

  // ===== 插件背景图（基座负责对齐壳页面 + harness）=====
  let shellBackground: { pluginId: string; url: string; overlay: string } | null = null;
  const pushBackground = (): void => {
    const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
    const ctx = windowState.getMainContext ? windowState.getMainContext() : null;
    // 偏移用 harness view 的实际 bounds（它的位置才是对齐基准）
    let sbw = 0, tbh = 0, winW = 0, winH = 0;
    try {
      const c0 = windowState.getMainContext ? windowState.getMainContext() : null;
      const hv0 = c0 && (c0 as any).harnessView;
      if (hv0 && !hv0.webContents.isDestroyed() && hv0.getBounds) { const b = hv0.getBounds(); sbw = b.x; tbh = b.y; }
    } catch (_) {}
    if (!sbw && (mainWin as any).__ckSidebarWidth != null) sbw = (mainWin as any).__ckSidebarWidth;
    if (!tbh && (mainWin as any).__ckToolbarHeight != null) tbh = (mainWin as any).__ckToolbarHeight;
    try { const sz = mainWin.getContentSize(); winW = sz[0]; winH = sz[1]; } catch (_) {}
    if (mainWin && mainWin.webContents) {
      mainWin.webContents.send('shell-background', shellBackground ? { url: shellBackground.url, overlay: shellBackground.overlay, winW, winH } : null);
    }
    try {
      for (const c of windowState.getAllContexts()) {
        const hv = (c as any).harnessView;
        if (hv && hv.webContents && !hv.webContents.isDestroyed()) {
          hv.webContents.send('harness-background', shellBackground ? { url: shellBackground.url, overlay: shellBackground.overlay, offsetX: sbw, offsetY: tbh, winW, winH } : null);
        }
      }
    } catch (_) {}
  };
  ipcMain.handle('plugin-shell-background', async (_event: any, { pluginId, url, overlay }: any = {}) => {
    try {
      if (url === null || url === undefined) { shellBackground = null; }
      else shellBackground = { pluginId: String(pluginId || ''), url: String(url), overlay: String(overlay || 'rgba(10,12,20,0.5)') };
      pushBackground();
      return { success: true };
    } catch (err: any) { return { success: false, error: err && err.message ? err.message : String(err) }; }
  });
  ipcMain.handle('plugin-shell-background-list', async () => {
    const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
    const ctx = windowState.getMainContext ? windowState.getMainContext() : null;
    let sbw = 0, tbh = 0;
    try { const v = ctx && ctx.view; if (v && v.getBounds) { const b = v.getBounds(); sbw = b.x; tbh = b.y; } } catch (_) {}
    let winW = 0, winH = 0;
    try { const sz = mainWin.getContentSize(); winW = sz[0]; winH = sz[1]; } catch (_) {}
    return { success: true, background: shellBackground, offsetX: sbw, offsetY: tbh, winW, winH };
  });

  // ===== 插件控制 AI 视图（DS 页面）显隐（纯 Electron 层，不碰页面）=====
  ipcMain.handle('plugin-set-webview-visible', async (event: any, { visible }: any = {}) => {
    try {
      const view = windowState.getViewByWebContents(event.sender);
      if (!view || !view.webContents || view.webContents.isDestroyed()) return { success: false, error: '视图不可用' };
      try { view.setVisible(!!visible); } catch (_) {}
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // ===== 插件覆盖层（overlay）：Cuckoo 自己的透明置顶视图，插件 UI 住这里 =====
  // 让插件"不注入 AI 页面"，从根上避免污染第三方页面。
  const findOverlayView = (event: any): any => {
    try {
      // 最稳：直接从窗口对象拿（ensureOverlay 把 view 挂在 win.__ckOverlayView）
      const mainWin: any = windowState.getMainWindow ? windowState.getMainWindow() : null;
      if (mainWin && mainWin.__ckOverlayView) return mainWin.__ckOverlayView;
      // 回退：ctx.overlayView
      const main = windowState.getMainContext();
      if (main && main.overlayView) return main.overlayView;
      const all = windowState.getAllContexts ? windowState.getAllContexts() : [];
      for (const ctx of all) {
        if (ctx.overlayView) return ctx.overlayView;
        if (ctx.win && ctx.win.__ckOverlayView) return ctx.win.__ckOverlayView;
      }
    } catch (_) {}
    return null;
  };

  // 覆盖层上报"桌宠区域矩形" → 主进程定时轮询鼠标位置，切鼠标穿透
  let overlayRects: number[][] = [];
  let overlayWinRef: any = null;
  let overlayIgnore = true;
  ipcMain.on('plugin-overlay-msg', (event: any, { channel, data }: any = {}) => {
    if (channel === 'overlay-hit-rects') {
      overlayRects = Array.isArray(data) ? data : [];
      if (!overlayWinRef) overlayWinRef = findOverlayView(event);
    }
  });
  // 定时轮询鼠标（200ms，够用且省）；鼠标没动则跳过，进一步省 CPU
  let lastPtX = -1, lastPtY = -1;
  setInterval(() => {
    try {
      if (!overlayWinRef || (overlayWinRef.isDestroyed && overlayWinRef.isDestroyed())) return;
      const { screen } = require('electron');
      const pt = screen.getCursorScreenPoint();
      if (pt.x === lastPtX && pt.y === lastPtY) return;  // 鼠标没动 → 跳过
      lastPtX = pt.x; lastPtY = pt.y;
      const b = overlayWinRef.getBounds();
      const lx = pt.x - b.x, ly = pt.y - b.y;
      let hit = false;
      for (const r of overlayRects) {
        if (lx >= r[0] && lx <= r[2] && ly >= r[1] && ly <= r[3]) { hit = true; break; }
      }
      if (hit !== !overlayIgnore) {
        overlayIgnore = !hit;
        overlayWinRef.setIgnoreMouseEvents(overlayIgnore, { forward: true });
      }
    } catch (_) {}
  }, 200);

  // 初始化覆盖层（创建/显示）
  ipcMain.handle('plugin-overlay-init', async (event: any) => {
    try {
      // 优先：按 event.sender 反查所属窗口
      let ctx: any = null;
      try {
        const byWc = windowState.getContextByWebContents(event.sender);
        if (byWc) ctx = byWc;
      } catch (_) {}
      // 回退：主窗口上下文
      if (!ctx) { try { ctx = windowState.getMainContext(); } catch (_) {} }
      if (!ctx) {
        // 再回退：任意窗口
        const all = windowState.getAllContexts ? windowState.getAllContexts() : [];
        if (all && all.length) ctx = all[0];
      }
      if (!ctx) return { success: false, error: '无可用窗口' };
      // 触发 overlay 创建（ensureOverlay 挂在 window 对象上）
      const ensure = ctx.__ckEnsureOverlay || (ctx.win && ctx.win.__ckEnsureOverlay);
      if (typeof ensure !== 'function') return { success: false, error: '窗口未挂 overlay 创建器' };
      ensure();
      // 立即回写 ctx.overlayView（ensureOverlay 里会写，但可能有延迟）
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 在覆盖层执行 JS（插件 UI 的真正宿主）
  ipcMain.handle('plugin-overlay-eval', async (event: any, { code }: any = {}) => {
    try {
      if (typeof code !== 'string') return { success: false, error: '缺少 code' };
      const ov = findOverlayView(event);
      if (!ov) return { success: false, error: '覆盖层不存在' };
      const r = await ov.webContents.executeJavaScript(code);
      return { success: true, result: r };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 向覆盖层注入一段 HTML（插件 UI）
  ipcMain.handle('plugin-overlay-html', async (event: any, { html }: any = {}) => {
    try {
      if (typeof html !== 'string') return { success: false, error: '缺少 html' };
      const ov = findOverlayView(event);
      if (!ov) return { success: false, error: '覆盖层不存在' };
      const code = 'document.getElementById("__ck_overlay_root").innerHTML = ' + JSON.stringify(html) + ';';
      await ov.webContents.executeJavaScript(code);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

export { registerPluginIpc };

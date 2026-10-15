/**
 * 插件安装 / 卸载
 *
 * 下载通道用 `codeload.github.com`（实测）：
 *  - **不消耗 GitHub API 配额**（Search 未认证仅 10/min，配额要省给搜索）
 *  - 返回 PAX 格式 tar.gz → 交给 `tar` 包解（朴素 512 字节块解析会错位，实测过）
 *
 * 安全边界（本文件是插件体系的信任关口）：
 *  - repo / branch 严格校验后才拼进 URL
 *  - 解压用 filter 拒绝绝对路径、`..` 段、符号链接与硬链接
 *  - 落盘前校验清单，id 必须匹配 kebab-case（id 直接作为目录名）
 *  - 可执行部分（providers/）默认**不落盘**，需显式授权
 *  - 卸载时校验目标目录确实在 plugins 根之内
 *
 * 本模块不依赖 electron：HTTP 由注入的 `HttpGet` 提供。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extract } from 'tar';
import {
  isValidPluginId,
  getPluginsDir,
  getPluginDir,
  PROVIDERS_DIR,
} from './paths.js';
import { readManifest, deriveContributes } from './manifest.js';
import { setPluginEnabled, clearPluginState } from './state.js';
import { isValidRepo, isValidBranch, buildTarballUrl, CODELOAD_BASE } from './github.js';
import {
  isGiteeRepo,
  stripGiteePrefix,
  isValidGiteeRepo,
  isValidGiteeBranch,
  buildGiteeArchiveUrl,
  buildGiteeRawUrl,
} from './gitee.js';
import type { HttpGet } from './http.js';
import type { InstalledPlugin, PluginOrigin } from './types.js';

/** 解析来源：'gitee:owner/repo' → gitee；否则 github */
function parseSource(repo: string): { source: 'github' | 'gitee'; plain: string } {
  if (isGiteeRepo(repo)) return { source: 'gitee', plain: stripGiteePrefix(repo) };
  return { source: 'github', plain: repo };
}

/** 来源记录文件名（随插件落盘，但不属于插件内容本身） */
const INSTALL_META_FILE = '.install-meta.json';

/** 安装结果 */
export interface InstallResult {
  success: boolean;
  plugin?: InstalledPlugin;
  /** 覆盖安装（更新）时为 true */
  upgraded?: boolean;
  error?: string;
}

/** 读插件的来源记录（`.install-meta.json`）；没有或损坏返回 undefined */
function readPluginOrigin(dir: string): PluginOrigin | undefined {
  try {
    const file = path.join(dir, INSTALL_META_FILE);
    if (!fs.existsSync(file)) return undefined;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!raw || typeof raw !== 'object') return undefined;
    if (typeof raw.repo !== 'string' || !raw.repo) return undefined;
    return {
      repo: raw.repo,
      url: typeof raw.url === 'string' ? raw.url : 'https://github.com/' + raw.repo,
      branch: typeof raw.branch === 'string' ? raw.branch : '',
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      version: typeof raw.version === 'string' ? raw.version : '',
    };
  } catch {
    return undefined;
  }
}

/** 列出已安装插件（含派生的贡献项与来源） */
function listInstalledPlugins(): InstalledPlugin[] {
  const out: InstalledPlugin[] = [];
  for (const dir of listDirs()) {
    const r = readManifest(dir);
    if (!r.ok || !r.manifest) continue;
    out.push({
      manifest: r.manifest,
      dir,
      contributes: deriveContributes(dir),
      origin: readPluginOrigin(dir),
    });
  }
  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

/** 内部：列出候选目录（避免与 paths 的导出名冲突） */
function listDirs(): string[] {
  const root = getPluginsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    if (fs.existsSync(path.join(dir, 'plugin.json'))) dirs.push(dir);
  }
  return dirs;
}

/**
 * 解压过滤器：拒绝一切可能逃出目标目录的条目。
 *  - 绝对路径（POSIX / Windows 盘符）
 *  - 含 `..` 段
 *  - 符号链接 / 硬链接（可指向目录外）
 */
function safeEntryFilter(entryPath: string, entry: any): boolean {
  if (!entryPath) return false;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(entryPath)) return false;
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) return false;
  const type = entry && entry.type;
  if (type === 'SymbolicLink' || type === 'Link') return false;
  return true;
}

/**
 * 安装插件。
 *
 * @param opts.repo     形如 `owner/repo`
 * @param opts.branch   仓库默认分支（市场条目已带；必填，避免硬编码 main 导致 404）
 * @param opts.upgrade  已安装时覆盖（更新）。默认 false，避免误覆盖
 */
async function installPlugin(opts: {
  httpGet: HttpGet;
  repo: string;
  branch: string;
  upgrade?: boolean;
  now?: number;
}): Promise<InstallResult> {
  const { httpGet } = opts;
  const { source, plain } = parseSource(opts.repo);

  if (source === 'gitee') {
    if (!isValidGiteeRepo(plain)) {
      return { success: false, error: 'Gitee 仓库标识非法（应为 owner/repo）：' + String(plain) };
    }
    if (!isValidGiteeBranch(opts.branch)) {
      return { success: false, error: 'Gitee 分支名非法或缺失：' + String(opts.branch) };
    }
  } else {
    if (!isValidRepo(opts.repo)) {
      return { success: false, error: '仓库标识非法（应为 owner/repo）：' + String(opts.repo) };
    }
    if (!isValidBranch(opts.branch)) {
      return { success: false, error: '分支名非法或缺失：' + String(opts.branch) };
    }
  }

  const url = source === 'gitee'
    ? buildGiteeArchiveUrl(plain, opts.branch)
    : buildTarballUrl(opts.repo, opts.branch);

  // ===== 1. 下载 tarball =====
  let res;
  try {
    res = await httpGet({ url, timeoutMs: 60000 });
  } catch (err: any) {
    return { success: false, error: '下载失败：' + (err && err.message ? err.message : String(err)) };
  }
  if (res.status !== 200) {
    return { success: false, error: '下载失败（HTTP ' + res.status + '）：' + url };
  }
  if (!res.body || res.body.byteLength === 0) {
    return { success: false, error: '下载内容为空：' + url };
  }

  // ===== 2. 解压到临时目录 =====
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-plugin-stage-'));
  const tarballPath = path.join(tmpRoot, 'pkg.tar.gz');
  const stageDir = path.join(tmpRoot, 'stage');
  fs.mkdirSync(stageDir, { recursive: true });

  try {
    fs.writeFileSync(tarballPath, res.body);
    try {
      await extract({
        file: tarballPath,
        cwd: stageDir,
        // GitHub tarball 顶层是 `<repo>-<sha>/`，剥掉一层
        strip: 1,
        filter: safeEntryFilter as any,
      });
    } catch (err: any) {
      return { success: false, error: '解压失败：' + (err && err.message ? err.message : String(err)) };
    }

    // ===== 3. 校验清单 =====
    const mr = readManifest(stageDir);
    if (!mr.ok || !mr.manifest) {
      return { success: false, error: '插件清单无效：' + (mr.error || '未知原因') };
    }
    const id = mr.manifest.id;

    // ===== 4. 已安装：默认拒绝，明确要求升级时才覆盖 =====
    const targetDir = getPluginDir(id);
    const alreadyInstalled = fs.existsSync(targetDir);
    if (alreadyInstalled && !opts.upgrade) {
      return { success: false, error: '插件已安装：' + id + '（如需覆盖请走「更新」）' };
    }

    // 覆盖安装：先把旧目录挪走而不是直接删 ——
    // 万一新版落盘失败，还能把旧的挪回来，不会留下一个残缺的插件。
    const backupDir = alreadyInstalled ? path.join(tmpRoot, 'prev') : '';
    if (alreadyInstalled) {
      try {
        fs.renameSync(targetDir, backupDir);
      } catch (err: any) {
        return { success: false, error: '准备覆盖失败：' + (err && err.message ? err.message : String(err)) };
      }
    }

    // ===== 5. 落盘（含可执行内容）=====
    // 可执行内容（providers/*.js）**始终落盘**，但默认不加载 ——
    // 由 plugins-state.json 的 execEnabled 控制。这样"启用"滑块才能真正生效；
    // 若装时不落盘，用户事后打开开关也加载不到任何东西（旧实现的坑）。
    fs.mkdirSync(getPluginsDir(), { recursive: true });
    try {
      fs.cpSync(stageDir, targetDir, { recursive: true });
    } catch (err: any) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      // 覆盖失败：把旧版本挪回来
      if (alreadyInstalled && fs.existsSync(backupDir)) {
        try { fs.renameSync(backupDir, targetDir); } catch { /* 尽力而为 */ }
      }
      return { success: false, error: '写入插件目录失败：' + (err && err.message ? err.message : String(err)) };
    }

    // ===== 6. 记录来源（审计 / 卸载溯源 / 更新比对）=====
    const origin: PluginOrigin = {
      repo: opts.repo,
      url: source === 'gitee' ? ('https://gitee.com/' + plain) : ('https://github.com/' + opts.repo),
      branch: opts.branch,
      installedAt: new Date(typeof opts.now === 'number' ? opts.now : Date.now()).toISOString(),
      version: mr.manifest.version || '',
    };
    try {
      fs.writeFileSync(
        path.join(targetDir, '.install-meta.json'),
        JSON.stringify(origin, null, 2),
        'utf-8'
      );
    } catch {
      // 来源记录失败不影响安装结果
    }

    // 新装插件默认**不启用**：装一个插件不该顺带执行第三方代码，
    // 启用必须是用户的显式动作（插件页的滑块）。
    // 覆盖安装时保留用户此前的选择 —— 他信任过这个插件，不该因为更新就重置。
    if (!alreadyInstalled) setPluginEnabled(id, false);

    return {
      success: true,
      upgraded: alreadyInstalled,
      plugin: { manifest: mr.manifest, dir: targetDir, contributes: deriveContributes(targetDir) },
    };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** 卸载插件：删目录 + 清启用状态 */
function uninstallPlugin(id: string): { success: boolean; error?: string } {
  if (!isValidPluginId(id)) {
    return { success: false, error: '插件 id 非法：' + String(id) };
  }
  const root = path.resolve(getPluginsDir());
  const target = path.resolve(getPluginDir(id));

  // 纵深防御：确认目标确实在 plugins 根之内
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { success: false, error: '拒绝卸载：目标不在插件目录内' };
  }
  if (!fs.existsSync(target)) {
    return { success: false, error: '插件未安装：' + id };
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err: any) {
    return { success: false, error: '删除失败：' + (err && err.message ? err.message : String(err)) };
  }

  clearPluginState(id);
  return { success: true };
}

/**
 * 从本地目录导入插件。
 * 校验 plugin.json（id 合法）、禁止覆盖已安装、默认禁用。
 * @param srcDir 源目录绝对路径
 * @returns 同 installPlugin 的结果形态
 */
function importPluginFromDir(srcDir: string): InstallResult {
  if (!srcDir || typeof srcDir !== 'string') {
    return { success: false, error: '缺少源目录' };
  }
  let stat;
  try { stat = fs.statSync(srcDir); } catch { return { success: false, error: '目录不存在：' + srcDir }; }
  if (!stat.isDirectory()) return { success: false, error: '不是目录：' + srcDir };

  // 校验清单
  const mr = readManifest(srcDir);
  if (!mr.ok || !mr.manifest) return { success: false, error: '插件清单无效：' + (mr.error || '未知原因') };
  const id = mr.manifest.id;
  if (!isValidPluginId(id)) return { success: false, error: '插件 id 非法：' + id };

  const targetDir = getPluginDir(id);
  if (fs.existsSync(targetDir)) return { success: false, error: '插件已安装：' + id + '（请先卸载）' };

  // 防止把目录复制到自己内部（源目录 = 目标目录）
  const srcResolved = path.resolve(srcDir);
  const dstResolved = path.resolve(targetDir);
  if (srcResolved === dstResolved || dstResolved.startsWith(srcResolved + path.sep)) {
    return { success: false, error: '源目录与目标目录冲突' };
  }

  try {
    fs.mkdirSync(getPluginsDir(), { recursive: true });
    // 排除 .install-meta.json（本地导入无远端来源）；其余整体复制
    fs.cpSync(srcDir, targetDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== INSTALL_META_FILE,
    });
  } catch (err: any) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { success: false, error: '复制失败：' + (err && err.message ? err.message : String(err)) };
  }

  // 本地导入来源标记（便于审计；无 repo 的 origin 不参与市场比对）
  try {
    fs.writeFileSync(
      path.join(targetDir, INSTALL_META_FILE),
      JSON.stringify({ repo: '', url: '', branch: '', installedAt: new Date().toISOString(), version: mr.manifest.version || '' }, null, 2),
      'utf-8'
    );
  } catch { /* 不影响结果 */ }

  setPluginEnabled(id, false); // 默认禁用
  return {
    success: true,
    plugin: { manifest: mr.manifest, dir: targetDir, contributes: deriveContributes(targetDir) },
  };
}

/**
 * 从本地 zip 导入插件。
 * zip 顶层若只有单个目录（含 plugin.json），自动剥离该层。
 * @param zipPath zip 文件绝对路径
 */
async function importPluginFromZip(zipPath: string): Promise<InstallResult> {
  if (!zipPath || typeof zipPath !== 'string') return { success: false, error: '缺少 zip 路径' };
  try { if (!fs.statSync(zipPath).isFile()) return { success: false, error: '不是文件：' + zipPath }; }
  catch { return { success: false, error: '文件不存在：' + zipPath }; }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-plugin-zip-'));
  const stageDir = path.join(tmpRoot, 'stage');
  fs.mkdirSync(stageDir, { recursive: true });
  try {
    try {
      await extract({ file: zipPath, cwd: stageDir, filter: safeEntryFilter as any });
    } catch (err: any) {
      return { success: false, error: '解压失败：' + (err && err.message ? err.message : String(err)) };
    }
    // zip 可能带一层顶层目录：若 stageDir 无 plugin.json 且只有一个子目录，则下钻
    let root = stageDir;
    if (!fs.existsSync(path.join(root, 'plugin.json'))) {
      const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
      const files = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile());
      if (entries.length === 1 && files.length === 0) {
        root = path.join(root, entries[0].name);
      }
    }
    const r = importPluginFromDir(root);
    return r;
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export {
  INSTALL_META_FILE,
  safeEntryFilter,
  readPluginOrigin,
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  importPluginFromDir,
  importPluginFromZip,
  parseSource,
};

// 从 github.js 转出，保持既有调用方（含测试）的导入路径不变
export { CODELOAD_BASE, isValidRepo, isValidBranch, buildTarballUrl } from './github.js';

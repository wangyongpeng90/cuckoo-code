/**
 * Profile 安装器（纯 node + pnpm 子进程）
 *
 * 对齐 DSH 的安装语义：
 *  - 安装：pnpm add <pkg> 到 profile 目录 → 更新 manifest 的 dependencies + bundles
 *  - 卸载：pnpm remove <pkg> → 从 manifest 移除
 *  - 列出：读 manifest 的 dependencies（+ 检测是否真的装了）
 *
 * 注：安装/卸载都"改 manifest + 跑 pnpm"——顺序是：
 *   1. 先跑 pnpm（成功才改 manifest）——避免"manifest 说有，实际没装"
 *   2. pnpm 成功 → 写 manifest
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getProfileDir,
  getProfileManifestPath,
  getProfileModulesDir,
  DEFAULT_PROFILE,
} from './paths.js';
import { readProfileManifest, writeProfileManifest, addDependency, removeDependency } from './manifest.js';
import { ensureProfile } from './init.js';
import { runPnpm, isPnpmAvailable } from './pnpm.js';
import { readProfilePatch, writeProfilePatch, removePatchEntry } from './patch.js';

export interface ProfileInstallResult {
  ok: boolean;
  /** 插件 id（包名转 kebab） */
  id?: string;
  /** 裸包名（含 scope，如 @scope/name） */
  name?: string;
  /** profile 目录 */
  dir?: string;
  /** 插件包目录（真正装好的地方） */
  pluginDir?: string;
  error?: string;
}

/** 从包名提取"插件 id"（@scope/name → scope-name） */
export function packageNameToId(pkgName: string): string {
  return String(pkgName || '').replace(/^@/, '').replace(/\//g, '-').toLowerCase();
}

/**
 * 安装一个 npm 包到 profile。
 * @param pkgName 包名（可带版本，如 dshmarket 或 dshmarket@1.66.14）
 */
export async function installToProfile(pkgName: string, profileName: string = DEFAULT_PROFILE, onData?: (s: string) => void): Promise<ProfileInstallResult> {
  const raw = String(pkgName || '').trim();
  if (!raw) return { ok: false, error: '包名不能为空' };
  // 校验包名（宽松：允许 @scope/name@version）
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~-]+)?$/i.test(raw)) {
    return { ok: false, error: '包名非法: ' + raw };
  }
  const bareName = raw.replace(/@[\w.^~-]+$/, '');
  const id = packageNameToId(bareName);

  if (!isPnpmAvailable()) return { ok: false, error: 'pnpm 不可用（resources/runtime/pnpm 缺失）' };

  const dir = ensureProfile(profileName);
  try {
    // 1. 先跑 pnpm add（用 --dir 指定 profile；-w 因为它是 workspace root）
    const res = await runPnpm(['add', raw, '-w'], dir, onData ? { onData } : undefined);
    if (res.code !== 0) {
      return { ok: false, error: 'pnpm add 失败: ' + (res.stderr || res.stdout).slice(-500) };
    }
    // 2. pnpm 成功 → 写 manifest（记录依赖 + bundles）
    // 版本从装好的 node_modules/<pkg>/package.json 读（比解析 pnpm 输出可靠）
    const installedVersion = readInstalledVersion(dir, bareName);
    const manifest = readProfileManifest(dir, profileName);
    const updated = addDependency(manifest, bareName, installedVersion ? '^' + installedVersion : 'latest');
    writeProfileManifest(dir, updated);
    const pluginDir = path.join(getProfileModulesDir(dir), bareName);
    return { ok: true, id, name: bareName, dir, pluginDir };
  } catch (e: any) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** 读装好的包的版本（node_modules/<pkg>/package.json 的 version） */
function readInstalledVersion(profileDir: string, pkgName: string): string | null {
  try {
    const pkgJson = path.join(getProfileModulesDir(profileDir), pkgName, 'package.json');
    const obj = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
    return typeof obj.version === 'string' && obj.version ? obj.version : null;
  } catch {
    return null;
  }
}

/**
 * 从 profile 卸载一个包。
 * @param pkgName 包名（bare，不含版本）
 */
export async function uninstallFromProfile(pkgName: string, profileName: string = DEFAULT_PROFILE): Promise<ProfileInstallResult> {
  const bare = String(pkgName || '').replace(/@[\w.^~-]+$/, '').trim();
  if (!bare) return { ok: false, error: '包名不能为空' };
  if (!isPnpmAvailable()) return { ok: false, error: 'pnpm 不可用' };

  const dir = ensureProfile(profileName);
  try {
    const res = await runPnpm(['remove', bare, '-w'], dir);
    if (res.code !== 0) {
      return { ok: false, error: 'pnpm remove 失败: ' + (res.stderr || res.stdout).slice(-500) };
    }
    const manifest = readProfileManifest(dir, profileName);
    writeProfileManifest(dir, removeDependency(manifest, bare));
    // 清 patch（包名 + 插件 id 两种形态都清）
    try {
      const patches = readProfilePatch(dir);
      const cleaned = removePatchEntry(removePatchEntry(patches, bare), packageNameToId(bare));
      writeProfilePatch(dir, cleaned);
    } catch (_) { /* ignore */ }
    return { ok: true, name: bare, dir };
  } catch (e: any) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export interface ProfilePluginInfo {
  /** 包名（manifest 的 dependency key） */
  name: string;
  /** manifest 声明的版本（或 spec） */
  spec: string;
  /** 包是否真的在 node_modules 里 */
  installed: boolean;
  /** 包目录（若已装） */
  dir?: string;
}

/** 列出 profile 里声明的插件 */
export function listProfilePlugins(profileName: string = DEFAULT_PROFILE): ProfilePluginInfo[] {
  const dir = getProfileDir(profileName);
  const manifest = readProfileManifest(dir, profileName);
  const deps = manifest.dependencies || {};
  const modsDir = getProfileModulesDir(dir);
  const out: ProfilePluginInfo[] = [];
  for (const [name, spec] of Object.entries(deps)) {
    const pkgDir = path.join(modsDir, name);
    const installed = fs.existsSync(path.join(pkgDir, 'package.json'));
    out.push({ name, spec, installed, dir: installed ? pkgDir : undefined });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 读 manifest 文件路径（供调试） */
export function profileManifestPath(profileName: string = DEFAULT_PROFILE): string {
  return getProfileManifestPath(getProfileDir(profileName));
}

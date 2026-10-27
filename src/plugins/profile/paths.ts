/**
 * DSH Profile 路径约定（纯 node，无 electron 依赖）
 *
 * 对齐 DSH 的 profile 结构（格式对齐，代码自写）：
 *  - 用户根：~/.cuckoo（CUCKOO_HOME 可覆盖）
 *  - profile 根：<root>/profiles/<name>/
 *  - 默认 profile 名：'default'（Cuckoo 单 profile）
 *
 * profile 目录内容（对齐 DSH）：
 *  - package.json      依赖 + dsh.profile.bundles
 *  - cordis.patch.yml  补丁层（启用/禁用 + 配置覆盖）
 *  - node_modules/     pnpm 装的插件
 *  - local-plugins/    本地插件（file: 依赖）
 *  - .dsh-market/      市场状态（收藏/分组/备注）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveResourceRoot } from '../app-root.js';

/** 默认 profile 名（Cuckoo 单 profile） */
const DEFAULT_PROFILE = 'default';

/** profile 内的关键文件名 */
const PROFILE_MANIFEST_FILE = 'package.json';
const PROFILE_PATCH_FILE = 'cordis.patch.yml';
const PROFILE_LOCK_FILE = 'pnpm-lock.yaml';
const PROFILE_WORKSPACE_FILE = 'pnpm-workspace.yaml';
const PROFILE_LOCAL_DIR = 'local-plugins';

function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

/** profile 根目录（<root>/profiles/） */
function getProfilesDir(): string {
  return path.join(getUserDir(), 'profiles');
}

/** 某个 profile 的目录 */
function getProfileDir(name: string = DEFAULT_PROFILE): string {
  return path.join(getProfilesDir(), name);
}

/** profile 的 package.json */
function getProfileManifestPath(dir: string): string {
  return path.join(dir, PROFILE_MANIFEST_FILE);
}

/** profile 的 cordis.patch.yml */
function getProfilePatchPath(dir: string): string {
  return path.join(dir, PROFILE_PATCH_FILE);
}

/** profile 的 pnpm-lock.yaml */
function getProfileLockPath(dir: string): string {
  return path.join(dir, PROFILE_LOCK_FILE);
}

/** profile 的 pnpm-workspace.yaml */
function getProfileWorkspacePath(dir: string): string {
  return path.join(dir, PROFILE_WORKSPACE_FILE);
}

/** profile 的 local-plugins 目录 */
function getProfileLocalDir(dir: string): string {
  return path.join(dir, PROFILE_LOCAL_DIR);
}

/** profile 的 node_modules */
function getProfileModulesDir(dir: string): string {
  return path.join(dir, 'node_modules');
}

/** 内置（预置）插件目录：开发版 = <项目根>/resources/bundled-plugins；打包版 = resources/bundled-plugins（extraResources） */
function getBundledPluginsDir(): string {
  return path.join(resolveResourceRoot(), 'bundled-plugins');
}

/** 内置插件的目录（按包名），不存在返回 null */
function getBundledPluginDir(pkgName: string): string | null {
  const dir = path.join(getBundledPluginsDir(), pkgName);
  return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
}

/** 列出所有 profile 名（一层子目录） */
function listProfiles(): string[] {
  const root = getProfilesDir();
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export {
  DEFAULT_PROFILE,
  PROFILE_MANIFEST_FILE,
  PROFILE_PATCH_FILE,
  PROFILE_LOCK_FILE,
  PROFILE_WORKSPACE_FILE,
  PROFILE_LOCAL_DIR,
  getUserDir,
  getProfilesDir,
  getProfileDir,
  getProfileManifestPath,
  getProfilePatchPath,
  getProfileLockPath,
  getProfileWorkspacePath,
  getProfileLocalDir,
  getProfileModulesDir,
  getBundledPluginsDir,
  getBundledPluginDir,
  listProfiles,
};

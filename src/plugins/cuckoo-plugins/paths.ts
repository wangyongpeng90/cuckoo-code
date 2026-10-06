/**
 * Cuckoo 插件（DSH 兼容）的目录约定。
 * 纯 node，无 electron 依赖。
 *
 * 目录：
 *  - 用户根：~/.cuckoo（CUCKOO_HOME 可覆盖）
 *  - 插件目录：<root>/cuckoo-plugins/<id>/（每个插件一个 npm 包目录）
 *  - 启用状态：<root>/cuckoo-plugins-state.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isValidPluginId(id: unknown): id is string {
  return typeof id === 'string' && PLUGIN_ID_RE.test(id);
}

function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

/** Cuckoo 插件（DSH 兼容）根目录 */
function getCuckooPluginsDir(): string {
  return path.join(getUserDir(), 'cuckoo-plugins');
}

/** 某个插件的安装目录 */
function getCuckooPluginDir(id: string): string {
  return path.join(getCuckooPluginsDir(), id);
}

function getCuckooPluginsStateFile(): string {
  return path.join(getUserDir(), 'cuckoo-plugins-state.json');
}

/** 列出已安装的 Cuckoo 插件目录（含 package.json 的目录） */
function listCuckooPluginDirs(): string[] {
  const root = getCuckooPluginsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    if (fs.existsSync(path.join(dir, 'package.json'))) out.push(dir);
  }
  return out;
}

export {
  isValidPluginId,
  getUserDir,
  getCuckooPluginsDir,
  getCuckooPluginDir,
  getCuckooPluginsStateFile,
  listCuckooPluginDirs,
};

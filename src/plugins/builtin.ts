/**
 * 内置插件：随应用分发的插件（打包进 resources/plugins/）。
 *
 * 启动时把内置插件同步到 ~/.cuckoo/plugins/<id>/（若已存在则不覆盖，
 * 用户可自行升级/修改）。同步后走现有插件加载链路。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPluginsDir } from './paths.js';
import { setPluginEnabled, readStateTable } from './state.js';

/** 内置插件源目录：开发态在项目根 resources/plugins/，打包态在 process.resourcesPath/plugins */
function getBuiltinPluginsDir(): string | null {
  const candidates: string[] = [];
  try {
    // 打包态：extraResources 到 resources/plugins
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'plugins'));
  } catch (_) { /* ignore */ }
  try {
    // 开发态：项目根/resources/plugins
    candidates.push(path.resolve(process.cwd(), 'resources', 'plugins'));
  } catch (_) { /* ignore */ }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch (_) { /* ignore */ }
  }
  return null;
}

/** 递归复制目录 */
function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

/**
 * 同步内置插件到用户插件目录（已存在则跳过，不覆盖用户版本）。
 * @returns 同步的插件 id 列表
 */
function syncBuiltinPlugins(): string[] {
  const src = getBuiltinPluginsDir();
  if (!src) return [];
  const dstRoot = getPluginsDir();
  const synced: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(src, { withFileTypes: true }); }
  catch { return []; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const srcDir = path.join(src, ent.name);
    // 必须含 plugin.json 才视为插件
    if (!fs.existsSync(path.join(srcDir, 'plugin.json'))) continue;
    const dstDir = path.join(dstRoot, ent.name);
    if (fs.existsSync(dstDir)) continue; // 已存在（用户版或已同步），不覆盖
    try {
      copyDir(srcDir, dstDir);
      synced.push(ent.name);
    } catch (err: any) {
      console.error('[builtin-plugin] 同步失败 ' + ent.name + ':', err && err.message);
    }
  }
  // 内置插件默认启用（用户从未设置过时才设，尊重用户的手动禁用）
  const table = readStateTable();
  for (const id of synced) {
    if (!(id in table)) { try { setPluginEnabled(id, true); } catch (_) { /* ignore */ } }
  }
  return synced;
}

export { syncBuiltinPlugins, getBuiltinPluginsDir };

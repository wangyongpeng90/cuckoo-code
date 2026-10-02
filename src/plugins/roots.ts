/**
 * 已启用插件的扫描根与可执行文件清单
 *
 * **所有查询都以"插件已启用"为前提**（`plugins-state.json` 的 `enabled`）。
 * 未启用的插件对系统而言等价于不存在：技能/代理/规则不被扫描、
 * `mcp.json` 不被读取、`providers/*.js` 不被加载。
 *
 * 为什么不让 scanner 自己 import 本模块：
 *   skills ← plugins 与 plugins → skills 会形成依赖环，
 *   违反 docs/arch/02-dependency.md 的单向依赖铁律。
 *   由依赖序更上的层居中传递，两边都不需要互相认识。
 */
import fs from 'node:fs';
import path from 'node:path';
import { listInstalledPluginDirs, SKILLS_DIR, AGENTS_DIR, RULES_DIR, MCP_FILE, PROVIDERS_DIR } from './paths.js';
import { readManifest } from './manifest.js';
import { isPluginEnabled } from './state.js';

/** 各扩展线的插件扫描根 */
export interface PluginScanRoots {
  skillDirs: string[];
  agentDirs: string[];
  ruleDirs: string[];
  /** 各插件 mcp.json 的绝对路径（存在才收录） */
  mcpFiles: string[];
}

/** 已启用的插件目录（含 manifest），供下面各查询复用 */
function listEnabledPlugins(): Array<{ id: string; dir: string }> {
  const out: Array<{ id: string; dir: string }> = [];
  for (const dir of listInstalledPluginDirs()) {
    const mr = readManifest(dir);
    if (!mr.ok || !mr.manifest) continue;
    if (!isPluginEnabled(mr.manifest.id)) continue;
    out.push({ id: mr.manifest.id, dir });
  }
  return out;
}

/** 计算所有**已启用**插件贡献的扫描根 */
export function getPluginScanRoots(): PluginScanRoots {
  const roots: PluginScanRoots = { skillDirs: [], agentDirs: [], ruleDirs: [], mcpFiles: [] };
  for (const { dir } of listEnabledPlugins()) {
    roots.skillDirs.push(path.join(dir, SKILLS_DIR));
    roots.agentDirs.push(path.join(dir, AGENTS_DIR));
    roots.ruleDirs.push(path.join(dir, RULES_DIR));
    roots.mcpFiles.push(path.join(dir, MCP_FILE));
  }
  return roots;
}

/**
 * 已启用插件的 provider 文件（绝对路径，已排序）。
 *
 * `providers/*.js` 会被 `require` 执行，等同于在本机运行第三方代码 ——
 * 所以只有插件被显式启用后才会出现在这里。
 */
export function getEnabledPluginProviderFiles(): string[] {
  const out: string[] = [];
  for (const { dir } of listEnabledPlugins()) {
    const providersDir = path.join(dir, PROVIDERS_DIR);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(providersDir, { withFileTypes: true });
    } catch {
      continue; // 无 providers 目录 = 该插件没带可执行内容
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith('.js')) continue;
      out.push(path.join(providersDir, ent.name));
    }
  }
  return out.sort();
}

/**
 * 已启用插件的 `mcp.json`（含所属插件 id）。
 *
 * 为什么 MCP 与 provider 共用同一个开关：MCP server 定义会 spawn 子进程
 * （`command` + `args`），安全等级与 `providers/*.js` **同级** ——
 * 都是"在本机运行第三方代码"。
 */
export function getEnabledPluginMcpFiles(): Array<{ pluginId: string; file: string }> {
  const out: Array<{ pluginId: string; file: string }> = [];
  for (const { id, dir } of listEnabledPlugins()) {
    const file = path.join(dir, MCP_FILE);
    if (!fs.existsSync(file)) continue;
    out.push({ pluginId: id, file });
  }
  return out.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

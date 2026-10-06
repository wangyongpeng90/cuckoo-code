/**
 * 插件路径解析（**纯 node，无 electron 依赖**，可在 vitest 直接测）
 *
 * 目录约定（对齐 skills/agents/rules 的 ~/.cuckoo 约定）：
 *  - 用户级根：`~/.cuckoo`（可用 CUCKOO_HOME 覆盖，供测试隔离）
 *  - 插件目录：`<root>/plugins/<id>/`
 *  - 启用状态：`<root>/plugins-state.json`
 *  - 市场缓存：`<root>/plugin-market-cache.json`
 *  - 市场配置：`<root>/plugin-market.json`（可选 GitHub token）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 清单文件名（唯一必需文件） */
const MANIFEST_FILE = 'plugin.json';

/** 插件目录下按约定识别的贡献项 */
const SKILLS_DIR = 'skills';
const AGENTS_DIR = 'agents';
const RULES_DIR = 'rules';
const MCP_FILE = 'mcp.json';
const PROVIDERS_DIR = 'providers';
/** 插件入口目录（第 6 条扩展线：可执行插件，写法参考 DSH） */
const DSH_DIR = 'dsh';
/** UI 扩展目录（第 7 条扩展线：向界面注入 HTML/JS/CSS） */
const UI_DIR = 'ui';
/** 网页注入脚本（按 URL 匹配注入 AI 页面主世界，见 bridge/entry.ts） */
const SCRIPTS_DIR = 'scripts';

/**
 * 插件 id 约束：小写 kebab-case，首字符必须是字母或数字。
 * 该 id 会直接作为安装目录名，所以必须排除 `.`、`..`、路径分隔符等。
 */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** id 是否合法（同时保证作为目录名安全） */
function isValidPluginId(id: unknown): id is string {
  return typeof id === 'string' && PLUGIN_ID_RE.test(id);
}

/** 用户级根目录。默认 ~/.cuckoo；CUCKOO_HOME 可覆盖（测试隔离 / 用户自定义）。 */
function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

function getPluginsDir(): string {
  return path.join(getUserDir(), 'plugins');
}

function getPluginsStateFile(): string {
  return path.join(getUserDir(), 'plugins-state.json');
}

function getMarketCacheFile(): string {
  return path.join(getUserDir(), 'plugin-market-cache.json');
}

/** 远端 plugin.json 解读结果的缓存（版本 / 最低应用版本） */
function getManifestCacheFile(): string {
  return path.join(getUserDir(), 'plugin-manifest-cache.json');
}

function getMarketConfigFile(): string {
  return path.join(getUserDir(), 'plugin-market.json');
}

/** 某个插件的安装目录（调用前须先校验 id） */
function getPluginDir(id: string): string {
  return path.join(getPluginsDir(), id);
}

/** 清单文件绝对路径 */
function getManifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILE);
}

/**
 * 列出已安装插件目录（一层子目录）。
 * 只返回**含 plugin.json** 的目录 —— 半途失败留下的残骸不会被当成插件。
 */
function listInstalledPluginDirs(): string[] {
  const root = getPluginsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // 目录不存在或无权限，静默跳过
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    if (fs.existsSync(getManifestPath(dir))) out.push(dir);
  }
  return out;
}

export {
  MANIFEST_FILE,
  SKILLS_DIR,
  AGENTS_DIR,
  RULES_DIR,
  MCP_FILE,
  PROVIDERS_DIR,
  DSH_DIR,
  UI_DIR,
  SCRIPTS_DIR,
  PLUGIN_ID_RE,
  isValidPluginId,
  getUserDir,
  getPluginsDir,
  getPluginsStateFile,
  getMarketCacheFile,
  getManifestCacheFile,
  getMarketConfigFile,
  getPluginDir,
  getManifestPath,
  listInstalledPluginDirs,
};

/**
 * 插件用户配置（~/.cuckoo/plugins-config.json）
 *
 * 结构：{ "<plugin-id>": { "key": value, ... } }
 * 与 plugins-state.json 同目录；纯 node，无 electron 依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getUserDir } from './paths.js';

function getConfigFile(): string {
  return path.join(getUserDir(), 'plugins-config.json');
}

/** 读整个配置表（损坏时按空表） */
function readConfigTable(): Record<string, Record<string, any>> {
  try {
    const file = getConfigFile();
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** 写整个配置表 */
function writeConfigTable(table: Record<string, Record<string, any>>): boolean {
  try {
    const file = getConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(table, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** 取某插件的配置（用户值 + 默认值合并） */
function getPluginConfig(pluginId: string, defaults?: Record<string, any>): Record<string, any> {
  const user = readConfigTable()[pluginId] || {};
  const out: Record<string, any> = {};
  if (defaults) {
    for (const [k, f] of Object.entries(defaults)) {
      const field: any = f;
      out[k] = field && field.default !== undefined ? field.default : undefined;
    }
  }
  for (const [k, v] of Object.entries(user)) out[k] = v;
  return out;
}

/** 设某插件的配置（整体覆盖） */
function setPluginConfig(pluginId: string, values: Record<string, any>): boolean {
  if (!pluginId) return false;
  const table = readConfigTable();
  table[pluginId] = values && typeof values === 'object' ? values : {};
  return writeConfigTable(table);
}

export { getPluginConfig, setPluginConfig, readConfigTable };

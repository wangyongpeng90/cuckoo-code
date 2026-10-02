/**
 * 插件启用状态（`~/.cuckoo/plugins-state.json`）
 *
 * 单独成文件而非放在 installer 里：状态需要被"扫描插件内容"的多条路径读取，
 * 而 installer 依赖 `tar` —— 不该让只想读状态的一方把 tar 拖进模块图。
 *
 * 结构：`{ "<plugin-id>": { "enabled": boolean } }`
 * 对齐 MCP 的 `mcp-state.json` 既有约定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPluginsStateFile, isValidPluginId } from './paths.js';
import type { PluginState } from './types.js';

/** 读取整张状态表（损坏时按空表处理） */
function readStateTable(): Record<string, PluginState> {
  try {
    const file = getPluginsStateFile();
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** 写入整张状态表 */
function writeStateTable(table: Record<string, PluginState>): boolean {
  try {
    const file = getPluginsStateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(table, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 插件是否已启用。
 *
 * 兼容旧字段 `execEnabled`：本功能尚未发布，但开发期可能已留下旧状态文件；
 * 把旧值当作总开关的初值，避免升级后已启用的插件突然失效。
 */
function isPluginEnabled(id: string): boolean {
  const st = readStateTable()[id];
  if (!st || typeof st !== 'object') return false;
  if (typeof st.enabled === 'boolean') return st.enabled;
  if (typeof st.execEnabled === 'boolean') return st.execEnabled;
  return false;
}

/** 读取单个插件的状态（对外仍给规范化后的形态） */
function readPluginState(id: string): PluginState {
  return { enabled: isPluginEnabled(id) };
}

/** 设置插件总开关。默认关闭 —— 启用是显式动作，不是默认值。 */
function setPluginEnabled(id: string, enabled: boolean): boolean {
  if (!isValidPluginId(id)) return false;
  const table = readStateTable();
  const next: PluginState = { enabled: !!enabled };
  table[id] = next; // 覆盖写入，顺带清掉旧的 execEnabled 字段
  return writeStateTable(table);
}

/** 清除某个插件的状态（卸载时调用） */
function clearPluginState(id: string): void {
  const table = readStateTable();
  if (table[id]) {
    delete table[id];
    writeStateTable(table);
  }
}

export {
  readStateTable,
  writeStateTable,
  isPluginEnabled,
  readPluginState,
  setPluginEnabled,
  clearPluginState,
};
/**
 * [261101-ym9l98] 跨窗口通用设置存储（主进程唯一真相源）
 *
 * 设计：
 *   - 内存 Map 为运行时唯一真相源，所有窗口读同一份
 *   - 持久化到 cuckoo.db 的 meta 表（键前缀 "setting:"），重启不丢
 *   - 写入后向所有窗口广播，AI 页面刷新本地缓存（仅本次新增的两个池走这里，
 *     历史 localStorage 设置一律不动）
 *
 * 为什么不用 localStorage：按 profile partition 隔离，无法跨窗口共享。
 */
import type { DatabaseSync } from 'node:sqlite';

const PREFIX = 'setting:';

/** 内存缓存：key（不含前缀）→ 字符串值（不存在则缺省） */
const cache = new Map<string, string>();
let dbRef: DatabaseSync | null = null;

/**
 * 初始化：绑定数据库并从 meta 表载入全部设置到内存。
 * @param db 应用启动时创建的全局 DatabaseSync
 */
function initSettingsStore(db: DatabaseSync): void {
  dbRef = db;
  cache.clear();
  try {
    const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'setting:%'").all() as any[];
    for (const row of rows) {
      if (row && typeof row.key === 'string') {
        cache.set(row.key.slice(PREFIX.length), String(row.value ?? ''));
      }
    }
    console.log('[Settings] 已从数据库载入 ' + cache.size + ' 项通用设置');
  } catch (err: any) {
    console.error('[Settings] 载入失败:', err && err.message);
  }
}

/** 取单个设置（未设置返回 undefined） */
function getSetting(key: string): string | undefined {
  return cache.get(key);
}

/** 取多个设置（缺失的键不出现在结果里） */
function getSettings(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = cache.get(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 取全部设置（供 AI 页面启动时拉一次） */
function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of cache) out[k] = v;
  return out;
}

/**
 * 写入一项设置（内存 + DB）。
 * @returns 是否成功
 */
function setSetting(key: string, value: string): boolean {
  cache.set(key, value);
  if (!dbRef) return false;
  try {
    dbRef.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(PREFIX + key, value);
    return true;
  } catch (err: any) {
    console.error('[Settings] 写入失败 (' + key + '):', err && err.message);
    return false;
  }
}

/** 批量写入（任一失败返回 false，但已写入的保留） */
function setSettings(values: Record<string, string>): boolean {
  let ok = true;
  for (const [k, v] of Object.entries(values)) {
    if (!setSetting(k, v)) ok = false;
  }
  return ok;
}

/** 删除一项设置（内存 + DB），用于"恢复默认" */
function removeSetting(key: string): boolean {
  cache.delete(key);
  if (!dbRef) return false;
  try {
    dbRef.prepare('DELETE FROM meta WHERE key = ?').run(PREFIX + key);
    return true;
  } catch (err: any) {
    console.error('[Settings] 删除失败 (' + key + '):', err && err.message);
    return false;
  }
}

/** 批量删除 */
function removeSettings(keys: string[]): boolean {
  let ok = true;
  for (const k of keys) {
    if (!removeSetting(k)) ok = false;
  }
  return ok;
}

export {
  initSettingsStore,
  getSetting,
  getSettings,
  getAllSettings,
  setSetting,
  setSettings,
  removeSetting,
  removeSettings,
};

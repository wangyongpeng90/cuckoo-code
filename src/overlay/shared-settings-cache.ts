/**
 * [261101-ym9l98] 通用设置的 AI 页面本地缓存
 *
 * 数据源在主进程（所有窗口共享一份）。这里只是启动时拉一次快照，
 * 供同步消费方（如 pickJsResultPhrase）使用；收到变更广播时整份替换。
 *
 * 仅承载本次新增的两个文案池，历史 localStorage 设置不经过这里。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

let snapshot: Record<string, string> = {};
let initialized = false;

/** 从主进程拉一次全量快照（bridge/entry 启动时调用） */
async function initSharedSettingsCache(): Promise<void> {
  try {
    const r = await ipcRenderer.invoke('get-shared-settings');
    if (r && r.success && r.data) snapshot = r.data;
    initialized = true;
    // 一次性迁移：数据库里没有、但本机 localStorage 里已有（上一版本遗留），推到主进程
    await migrateFromLocalStorage();
    console.log('[Cuckoo Code][设置] 通用设置已载入，共 ' + Object.keys(snapshot).length + ' 项');
  } catch (err: any) {
    console.error('[Cuckoo Code][设置] 载入通用设置失败:', err && err.message);
  }
}

/** 把上一版本存在 localStorage 的两个池搬到主进程（仅这两个键，且只在 DB 缺失时） */
async function migrateFromLocalStorage(): Promise<void> {
  const keys = ['cuckoo-js-result-phrases', 'cuckoo-js-result-item-templates'];
  const values: Record<string, string> = {};
  for (const k of keys) {
    if (snapshot[k] !== undefined) continue;
    try {
      const v = localStorage.getItem(k);
      if (v) values[k] = v;
    } catch (_) { /* ignore */ }
  }
  if (Object.keys(values).length === 0) return;
  try {
    const r = await ipcRenderer.invoke('save-shared-settings', { data: values });
    if (r && r.success) {
      Object.assign(snapshot, values);
      console.log('[Cuckoo Code][设置] 已迁移 ' + Object.keys(values).length + ' 项旧设置到数据库');
    }
  } catch (_) { /* ignore */ }
}

/** 同步读一项（未初始化 / 未设置返回 undefined） */
function getSharedSetting(key: string): string | undefined {
  return snapshot[key];
}

/** 批量写入（主进程持久化 + 广播；本地快照由广播刷新） */
async function saveSharedSettingValues(values: Record<string, string>): Promise<boolean> {
  try {
    const r = await ipcRenderer.invoke('save-shared-settings', { data: values });
    return !!(r && r.success);
  } catch (_) {
    return false;
  }
}

/** 批量删除（恢复默认） */
async function removeSharedSettingKeys(keys: string[]): Promise<boolean> {
  try {
    const r = await ipcRenderer.invoke('reset-shared-settings', { keys });
    return !!(r && r.success);
  } catch (_) {
    return false;
  }
}

/** 订阅主进程的变更广播：整份替换快照 */
function subscribeSharedSettings(): void {
  ipcRenderer.on('cuckoo-shared-settings-changed', (_e: any, payload: any) => {
    if (!payload) return;
    if (payload.values) {
      Object.assign(snapshot, payload.values);
    }
    if (Array.isArray(payload.removed)) {
      for (const k of payload.removed) delete snapshot[k];
    }
  });
}

export {
  initSharedSettingsCache,
  getSharedSetting,
  saveSharedSettingValues,
  removeSharedSettingKeys,
  subscribeSharedSettings,
  initialized as _initialized,
};

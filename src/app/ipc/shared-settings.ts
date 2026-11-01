/**
 * IPC：跨窗口通用设置（主进程内存 + meta 表）
 *
 * [261101-ym9l98] 与上方「壳页面 ↔ AI 页面 localStorage」转发链路并存：
 *   - 历史设置仍走 localStorage（每窗口独立，本次不动）
 *   - 本次新增的文案池走这里（所有窗口共享一份）
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { getAllSettings, setSettings, removeSettings } from '../settings-store.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

/** 广播给所有窗口（AI 页面 + 壳页面 + harness），让各自刷新本地缓存 */
function broadcastChanged(payload: any): void {
  for (const ctx of windowState.getAllContexts()) {
    const hv = (ctx as any).harnessView;
    const targets = [ctx.view && ctx.view.webContents, ctx.win && ctx.win.webContents, hv && hv.webContents];
    for (const wc of targets) {
      if (!wc || wc.isDestroyed()) continue;
      try { wc.send('cuckoo-shared-settings-changed', payload); } catch (_) { /* ignore */ }
    }
  }
}

function registerSharedSettingsIpc(): void {
  // 读全部通用设置
  ipcMain.handle('get-shared-settings', async () => {
    try {
      return { success: true, data: getAllSettings() };
    } catch (err: any) {
      return { success: false, error: err && err.message };
    }
  });

  // 保存（批量）：写内存 + DB，成功后广播
  ipcMain.handle('save-shared-settings', async (_event: any, { data }: any) => {
    const values: Record<string, string> = {};
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') values[k] = v;
      }
    }
    const ok = setSettings(values);
    if (ok) broadcastChanged({ values });
    return ok ? { success: true } : { success: false, error: '写入数据库失败' };
  });

  // 恢复默认：删除指定键
  ipcMain.handle('reset-shared-settings', async (_event: any, { keys }: any) => {
    const list = Array.isArray(keys) ? keys.filter((k: any) => typeof k === 'string') : [];
    const ok = removeSettings(list);
    if (ok) broadcastChanged({ removed: list });
    return ok ? { success: true } : { success: false, error: '删除失败' };
  });
}

export { registerSharedSettingsIpc, broadcastChanged };

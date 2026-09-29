/**
 * IPC：overlay 设置（主进程 settings.json 的读 / 写 / 重置 / 旧数据迁移）
 * save/reset/migrate 成功后向所有窗口的 AI 页面广播 'settings-changed'（携带完整设置），
 * 各窗口据此刷新内存缓存并重镜像 hook 键，保持同 partition 多窗口设置互通。
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import type { Settings } from '../../bridge/api-types.js';
import { getSettings, saveSettings, resetSettings, applyLegacyMigration } from '../settings-store.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

/** 把最新设置广播给所有窗口的 AI 页面 view（模式同 shell.ts 的 broadcastSystemTotal） */
function broadcastSettings(settings: Settings): void {
  for (const ctx of windowState.getAllContexts()) {
    try {
      const wc = ctx && ctx.view && ctx.view.webContents;
      if (wc && !wc.isDestroyed()) wc.send('settings-changed', settings);
    } catch (_) {}
  }
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings-get', async () => {
    return getSettings();
  });

  ipcMain.handle('settings-set', async (_event: any, payload: any) => {
    const patch = payload && typeof payload === 'object' ? payload.patch : null;
    const settings = saveSettings(patch);
    broadcastSettings(settings);
    return { success: true, settings };
  });

  ipcMain.handle('settings-reset', async () => {
    const settings = resetSettings();
    broadcastSettings(settings);
    return { success: true, settings };
  });

  // 旧版 localStorage 设置迁入：主进程按 migrated 标记只应用一次
  ipcMain.handle('settings-migrate', async (_event: any, payload: any) => {
    const patch = payload && typeof payload === 'object' ? payload.patch : null;
    const applied = applyLegacyMigration(patch);
    if (applied) broadcastSettings(getSettings());
    return { success: true, applied };
  });
}

export { registerSettingsIpc, broadcastSettings };

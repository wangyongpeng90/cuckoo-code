/**
 * IPC：设置读写（壳页面设置页 ↔ AI 页面 localStorage）
 *
 * 背景：设置以 AI 页面 localStorage 为唯一数据源（loop / hook 需同步读）。
 * 壳页面与 AI 页面是不同 origin 的 webContents，无法直接互访，
 * 因此由主进程做"请求-响应"转发：
 *   壳页面 ──invoke──▶ 主进程 ──send──▶ AI 页面（读写 localStorage）
 *        ◀──回执(带reqId)──         ◀──send('cuckoo-settings-result')──
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

let reqSeq = 0;
/** reqId → { resolve, timer } */
const pending = new Map<string, any>();

/** 收到 AI 页面回执 */
function onResult(_event: any, payload: any): void {
  const { reqId } = payload || {};
  if (!reqId || !pending.has(reqId)) return;
  const p = pending.get(reqId);
  pending.delete(reqId);
  if (p.timer) clearTimeout(p.timer);
  p.resolve(payload);
}

/** 向指定窗口的 AI 页面请求设置操作，等回执（超时 5s） */
function requestFromAiPage(shellEvent: any, channel: string, data?: any): Promise<any> {
  return new Promise((resolve) => {
    const ctx = windowState.getContextByWebContents(shellEvent.sender);
    const view = ctx && ctx.view;
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      resolve({ ok: false, error: '未找到 AI 页面' });
      return;
    }
    const reqId = 'set-' + (++reqSeq) + '-' + Date.now();
    const timer = setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId);
        resolve({ ok: false, error: 'AI 页面响应超时' });
      }
    }, 5000);
    pending.set(reqId, { resolve, timer });
    try {
      view.webContents.send(channel, { reqId, data });
    } catch (err: any) {
      pending.delete(reqId);
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    }
  });
}

function registerSettingsIpc(): void {
  // AI 页面回执入口
  ipcMain.on('cuckoo-settings-result', onResult);
  ipcMain.on('cuckoo-autocompact-result', onResult);

  // 读设置
  ipcMain.handle('get-settings', async (event: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-get-settings');
    return r.ok ? { success: true, data: r.data } : { success: false, error: r.error };
  });

  // 保存设置
  ipcMain.handle('save-settings', async (event: any, { data }: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-save-settings', data);
    return r.ok ? { success: true, data: r.data } : { success: false, error: r.error };
  });

  // 恢复默认
  ipcMain.handle('reset-settings', async (event: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-reset-settings');
    return r.ok ? { success: true, data: r.data } : { success: false, error: r.error };
  });

  // 自动压缩配置：读
  ipcMain.handle('get-autocompact', async (event: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-get-autocompact');
    return r.ok ? { success: true, data: r.data } : { success: false, error: r.error };
  });
  // 自动压缩配置：保存
  ipcMain.handle('save-autocompact', async (event: any, { data }: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-save-autocompact', data);
    return r.ok ? { success: true, data: r.data } : { success: false, error: r.error };
  });
  // 手动触发压缩
  ipcMain.handle('trigger-compact', async (event: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-trigger-compact');
    return r.ok ? { success: true } : { success: false, error: r.error };
  });
  // 手动触发"整理长期记忆"
  ipcMain.handle('trigger-organize-memory', async (event: any) => {
    const r = await requestFromAiPage(event, 'cuckoo-trigger-organize-memory');
    return r.ok ? { success: true } : { success: false, error: r.error };
  });
}

export { registerSettingsIpc };

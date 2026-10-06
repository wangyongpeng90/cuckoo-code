/**
 * IPC：主题（主进程权威 ↔ 渲染进程）
 *
 * 端点：
 *   theme-get        取当前快照
 *   theme-set        切换偏好（light/dark/system 或已注册主题 id）
 *   theme-list       列出已注册主题
 *   theme-register   注册主题（返回 disposer token）
 *   theme-override   叠加覆盖层（返回 disposer token）
 *   theme-dispose    撤销某次注册/覆盖（按 token）
 *   theme-subscribe  订阅变化（变化时推 'theme-changed'）
 */
import { createRequire } from 'node:module';
import * as themeManager from '../theme/theme-manager.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerThemeIpc(): void {
  ipcMain.handle('theme-get', () => {
    return { success: true, snapshot: themeManager.snapshot() };
  });

  ipcMain.handle('theme-set', (_e: any, { id }: any = {}) => {
    try {
      const snap = themeManager.setTheme(id);
      return { success: true, snapshot: snap };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('theme-list', () => {
    return { success: true, themes: themeManager.list() };
  });

  ipcMain.handle('theme-register', (_e: any, { definition }: any = {}) => {
    try {
      const token = themeManager.register(definition);
      return { success: true, token };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('theme-override', (_e: any, { source, tokens }: any = {}) => {
    try {
      const token = themeManager.overrideTokens(source, tokens);
      return { success: true, token };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('theme-dispose', (_e: any, { token }: any = {}) => {
    return { success: themeManager.dispose(token) };
  });

  ipcMain.handle('theme-subscribe', (event: any) => {
    const wc = event && event.sender;
    if (!wc) return { success: false, error: 'no sender' };
    const off = themeManager.subscribe(wc);
    // 立刻推一次当前快照
    try { wc.send('theme-changed', themeManager.snapshot()); } catch (_) { /* ignore */ }
    // 无法在 IPC 里持有 off 到渲染进程销毁；用 once('destroyed') 清理
    try { wc.once('destroyed', () => off()); } catch (_) { /* ignore */ }
    return { success: true };
  });
}

export { registerThemeIpc };

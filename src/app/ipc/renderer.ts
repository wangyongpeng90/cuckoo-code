/**
 * IPC：与渲染进程的原生交互（通知、输入事件注入）
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import * as profileManager from '../profile.js';
import * as toolActivity from '../tool-activity.js';

const require = createRequire(import.meta.url);
const { ipcMain, Notification } = require('electron');

function registerRendererIpc(): void {
  // AI 回复完成时：窗口已聚焦则不打扰；否则弹通知并让任务栏/Dock 闪烁
  ipcMain.handle('show-ai-notification', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const win = ctx ? ctx.win : windowState.getMainWindow();

      if (win && !win.isDestroyed() && win.isFocused()) {
        return { success: true, skipped: true, reason: 'window-focused' };
      }

      if (win && !win.isDestroyed()) {
        let windowName = 'Cuckoo Code';
        if (ctx && ctx.profileId) {
          const profile = profileManager.getProfileById(ctx.profileId);
          if (profile && profile.name) windowName = profile.name;
        }

        const notification = new Notification({
          title: windowName + ' - AI任务已完成',
          body: 'AI 已完成回复',
        });
        notification.show();

        win.flashFrame(true);
        win.once('focus', () => {
          if (!win.isDestroyed()) win.flashFrame(false);
        });
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 站点原生发送：向聚焦输入框注入真实级 Enter（智谱只响应 isTrusted=true 的输入，合成事件免疫）
  ipcMain.handle('chat-send-enter', async (event: any) => {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return false;
    try {
      sender.sendInputEvent({ type: 'keyDown', keyCode: 'Return', key: 'Enter' });
      sender.sendInputEvent({ type: 'char', keyCode: 'Return', key: '\r' });
      sender.sendInputEvent({ type: 'keyUp', keyCode: 'Return', key: 'Enter' });
      return true;
    } catch (err: any) {
      console.error('[Cuckoo Code] ❌ 原生 Enter 发送失败:', err.message);
      return false;
    }
  });

  // 模拟真实鼠标事件（isTrusted=true），用于需要原生点击的站点
  // action: 'move' | 'click'；x/y 为相对视口的 CSS 像素坐标
  ipcMain.handle('simulate-mouse', async (event: any, { action, x, y }: any = {}) => {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return false;
    const px = Math.round(Number(x) || 0);
    const py = Math.round(Number(y) || 0);
    try {
      if (action === 'move') {
        sender.sendInputEvent({ type: 'mouseMove', x: px, y: py });
      } else {
        sender.sendInputEvent({ type: 'mouseMove', x: px, y: py });
        sender.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
        sender.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
      }
      return true;
    } catch (err: any) {
      console.error('[Cuckoo Code] ❌ simulate-mouse 失败:', err.message);
      return false;
    }
  });

  // ===== 任务面板：工具活动上报 / 历史拉取 / 清空（历史存主进程内存，按窗口隔离）=====

  // AI 页面 executor 上报工具活动（同 id 从 running 更新为 done）→ 存历史 + 转发壳页面任务面板
  ipcMain.handle('report-tool-activity', async (event: any, { entry }: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed() || !entry || !entry.id) {
      return { success: false };
    }
    const normalized = toolActivity.upsertEntry(ctx.win.id, entry);
    try {
      // 转发归一化副本（与历史存储一致），不转发渲染进程原始对象
      if (normalized) ctx.win.webContents.send('shell-tool-activity', normalized);
    } catch (_) { /* 壳页面未就绪时历史已存，面板打开时会拉全量 */ }
    return { success: true };
  });

  // 壳页面打开任务面板时拉取本窗口全量历史（转发是增量的，面板后开需要补全）
  ipcMain.handle('shell-get-tool-history', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
      return { success: true, entries: [] };
    }
    return { success: true, entries: toolActivity.getHistory(ctx.win.id) };
  });

  // 任务面板「清空」按钮：清掉本窗口历史
  ipcMain.handle('shell-clear-tool-history', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
      return { success: false };
    }
    toolActivity.clearHistory(ctx.win.id);
    return { success: true };
  });
}

export { registerRendererIpc };

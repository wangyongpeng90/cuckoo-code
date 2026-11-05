/**
 * IPC：与渲染进程的原生交互（通知、输入事件注入）
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import * as profileManager from '../profile.js';
import { pasteText, createClipboardLock } from './clipboard-paste.js';

const require = createRequire(import.meta.url);
const { ipcMain, Notification, clipboard } = require('electron');

// [261105-geaofb] 剪贴板借用串行锁：clipboard 是进程级全局资源，
// 多窗口并发粘贴会交错备份/恢复，必须全局串行。
const withClipboardLock = createClipboardLock();

function registerRendererIpc(): void {
  // [261105-geaofb] 真实系统粘贴：写剪贴板 → webContents.paste() → 立即恢复。
  // paste() 同步派发，数据快照即刻进入渲染进程，故占用窗口约 10~30ms；
  // 恢复早于 overlay 侧的读回校验，校验失败也不影响用户剪贴板。
  ipcMain.handle('chat-paste-text', async (event: any, text: string) => {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return { success: false, error: 'view-destroyed' };
    if (typeof text !== 'string' || !text) return { success: false, error: 'invalid-text' };

    return withClipboardLock(() => pasteText(clipboard, () => sender.paste(), text));
  });

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
      // 先让目标 view 获得键盘焦点——否则 sendInputEvent 的键盘事件送不到页面
      // （页面 document.hasFocus() === false 时 Enter 会落空，表现为「消息发不出去」）
      try { sender.focus(); } catch (_) { /* 部分环境不支持 */ }
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
}

export { registerRendererIpc };

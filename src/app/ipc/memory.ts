/**
 * IPC：用户记忆（Memories）管理
 * 壳页面通过 window.shellAPI 调用：
 *  - list-memories  ：列出全部
 *  - save-memories  ：整体覆盖保存
 *  - add-memory     ：新增一条
 *  - delete-memory  ：删除一条
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { listMemories, saveMemories, addMemory, removeMemory } from '../../infra/memories.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

/** 广播给所有窗口的壳页面，让它们刷新（多窗口同步） */
function broadcastChanged(): void {
  for (const ctx of windowState.getAllContexts()) {
    try {
      if (ctx && ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('shell-memories-changed');
      }
    } catch (_) {}
  }
}

function registerMemoryIpc(): void {
  ipcMain.handle('list-memories', async () => {
    return { success: true, memories: listMemories() };
  });

  ipcMain.handle('save-memories', async (_event: any, { memories }: any) => {
    const ok = saveMemories(memories);
    if (ok) broadcastChanged();
    return { success: ok, error: ok ? null : '保存失败' };
  });

  ipcMain.handle('add-memory', async (_event: any, { text }: any) => {
    const m = addMemory(text);
    if (m) broadcastChanged();
    return { success: !!m, memory: m, error: m ? null : '内容为空' };
  });

  ipcMain.handle('delete-memory', async (_event: any, { id }: any) => {
    const ok = removeMemory(id);
    if (ok) broadcastChanged();
    return { success: ok, error: ok ? null : '记忆不存在' };
  });

  // AI 正文标记 [记忆]xxx 触发
  ipcMain.handle('create-memory-marker', async (_event: any, { text }: any) => {
    const m = addMemory(text);
    if (m) broadcastChanged();
    return { success: !!m, memory: m, error: m ? null : '内容为空' };
  });
}

export { registerMemoryIpc };

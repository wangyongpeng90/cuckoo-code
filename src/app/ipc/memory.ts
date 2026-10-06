/**
 * IPC：长期记忆管理
 * 壳页面通过 window.shellAPI 调用：
 *  - list-memories   ：列出全部记忆
 *  - save-memory     ：新增一条
 *  - update-memory   ：更新一条
 *  - delete-memory   ：删除一条
 *  - export-memories ：导出（返回完整数组）
 *  - import-memories ：导入（整体替换或追加）
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import {
  listMemories, saveMemory, updateMemory, deleteMemory, replaceAllMemories,
} from '../../memory/index.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

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
    try {
      return { success: true, memories: await listMemories() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('save-memory', async (_event: any, { memory }: any) => {
    try {
      const id = await saveMemory(memory || {});
      broadcastChanged();
      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('update-memory', async (_event: any, { memory }: any) => {
    try {
      await updateMemory(memory);
      broadcastChanged();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-memory', async (_event: any, { id }: any) => {
    try {
      await deleteMemory(Number(id));
      broadcastChanged();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-memories', async () => {
    try {
      return { success: true, memories: await listMemories() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import-memories', async (_event: any, { memories }: any) => {
    try {
      if (!Array.isArray(memories)) return { success: false, error: '数据格式错误' };
      await replaceAllMemories(memories);
      broadcastChanged();
      return { success: true, count: memories.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerMemoryIpc };

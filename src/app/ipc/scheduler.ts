/**
 * IPC：定时任务管理
 */
import { createRequire } from 'node:module';
import { readTasks, writeTasks } from '../scheduler.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerSchedulerIpc(): void {
  // 列出所有定时任务
  ipcMain.handle('list-scheduled-tasks', async () => {
    try {
      return { success: true, tasks: readTasks() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 保存任务列表（整体覆盖）
  ipcMain.handle('save-scheduled-tasks', async (_event: any, { tasks }: any) => {
    try {
      const ok = writeTasks(Array.isArray(tasks) ? tasks : []);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerSchedulerIpc };

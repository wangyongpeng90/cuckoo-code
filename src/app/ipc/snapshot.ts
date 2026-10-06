/**
 * IPC：工作快照（Snapshots）管理
 * 壳页面通过 window.shellAPI 调用：
 *  - list-snapshots   ：列出全部（可传 projectDir 过滤）
 *  - create-snapshot  ：为指定项目创建快照
 *  - restore-snapshot ：恢复快照到项目目录
 *  - delete-snapshot  ：删除快照
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } from '../snapshots.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerSnapshotIpc(): void {
  ipcMain.handle('list-snapshots', async (_event: any, { projectDir }: any = {}) => {
    try {
      const all = listSnapshots();
      const list = projectDir ? all.filter((s) => s.projectDir === projectDir) : all;
      return { success: true, snapshots: list };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('create-snapshot', async (_event: any, { projectDir, name, description }: any) => {
    try {
      const m = createSnapshot(projectDir, name, description || '');
      return { success: true, snapshot: m };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('restore-snapshot', async (_event: any, { id }: any) => {
    try {
      const r = restoreSnapshot(id);
      return { success: true, restored: r.restored, projectDir: r.projectDir };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-snapshot', async (_event: any, { id }: any) => {
    try {
      const ok = deleteSnapshot(id);
      return { success: ok, error: ok ? null : '快照不存在' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // AI 正文标记 [快照]名称 触发（用当前窗口项目目录）
  ipcMain.handle('create-snapshot-marker', async (event: any, { name }: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const projectDir = (ctx && ctx.sessionStore && ctx.sessionStore.state.selectedProjectDir) || null;
      if (!projectDir) return { success: false, error: '项目目录未初始化' };
      const m = createSnapshot(projectDir, name, '由 AI 正文标记创建');
      return { success: true, snapshot: m };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerSnapshotIpc };

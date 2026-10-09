/**
 * IPC：插件文件系统代理（ctx.fs）
 *
 * 插件运行在 AI 页面渲染进程，无法直接访问 fs。本模块提供受控的文件读写，
 * 路径限定在：userData 下、当前项目目录下、插件目录（~/.cuckoo）下。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { getUserDir } from '../../plugins/paths.js';

const require = createRequire(import.meta.url);
const { ipcMain, app } = require('electron');

/** 判断目标路径是否在允许的根目录下 */
function isAllowed(norm: string, projectDir: string | null): boolean {
  const roots: string[] = [];
  try { roots.push(path.resolve(app.getPath('userData'))); } catch (_) { /* ignore */ }
  try { roots.push(path.resolve(getUserDir())); } catch (_) { /* ignore */ }
  if (projectDir) roots.push(path.resolve(projectDir));
  for (const r of roots) {
    if (norm === r || norm.startsWith(r + path.sep)) return true;
  }
  return false;
}

function resolveSafe(event: any, filePath: any): { ok: boolean; norm?: string; error?: string } {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: '路径为空' };
  let norm: string;
  try { norm = path.resolve(filePath); } catch (_) { return { ok: false, error: '路径非法' }; }
  const ctx = windowState.getContextByWebContents(event.sender);
  const store = ctx ? ctx.sessionStore : null;
  const projectDir = (store && store.state && store.state.selectedProjectDir) || null;
  if (!isAllowed(norm, projectDir)) return { ok: false, error: '路径超出允许范围' };
  return { ok: true, norm };
}

function registerPluginFsIpc(): void {
  ipcMain.handle('plugin-fs-read', async (event: any, { path: p }: any) => {
    try {
      const r = resolveSafe(event, p);
      if (!r.ok) return { success: false, error: r.error };
      if (!fs.existsSync(r.norm!)) return { success: false, error: '文件不存在' };
      return { success: true, content: fs.readFileSync(r.norm!, 'utf-8') };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('plugin-fs-write', async (event: any, { path: p, content }: any) => {
    try {
      const r = resolveSafe(event, p);
      if (!r.ok) return { success: false, error: r.error };
      fs.mkdirSync(path.dirname(r.norm!), { recursive: true });
      fs.writeFileSync(r.norm!, String(content == null ? '' : content), 'utf-8');
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('plugin-fs-append', async (event: any, { path: p, content }: any) => {
    try {
      const r = resolveSafe(event, p);
      if (!r.ok) return { success: false, error: r.error };
      fs.mkdirSync(path.dirname(r.norm!), { recursive: true });
      fs.appendFileSync(r.norm!, String(content == null ? '' : content), 'utf-8');
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('plugin-fs-exists', async (event: any, { path: p }: any) => {
    try {
      const r = resolveSafe(event, p);
      if (!r.ok) return { success: false, error: r.error };
      return { success: true, exists: fs.existsSync(r.norm!) };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('plugin-fs-mkdir', async (event: any, { path: p }: any) => {
    try {
      const r = resolveSafe(event, p);
      if (!r.ok) return { success: false, error: r.error };
      fs.mkdirSync(r.norm!, { recursive: true });
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('plugin-fs-readdir', async (event: any, { path: p }: any) => {
    try {
      const r = resolveSafe(event, p);
      if (!r.ok) return { success: false, error: r.error };
      if (!fs.existsSync(r.norm!)) return { success: true, items: [] };
      const items = fs.readdirSync(r.norm!, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      return { success: true, items };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  /** 会话 → 项目目录映射 */
  ipcMain.handle('plugin-session-project-dir', async (event: any, { sessionId }: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      let dir: string | null = null;
      if (store) {
        if (sessionId) dir = store.getProjectDirBySessionId(sessionId);
        if (!dir) dir = (store.state && store.state.selectedProjectDir) || null;
      }
      return { success: true, dir };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  /** 当前 userData 路径（插件存数据用） */
  ipcMain.handle('plugin-user-data-dir', async () => {
    try { return { success: true, dir: app.getPath('userData') }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });
}

export { registerPluginFsIpc };

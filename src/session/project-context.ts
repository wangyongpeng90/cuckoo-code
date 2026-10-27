/**
 * 项目初始化：目录选择、会话映射保存、系统提示词发送
 * 提示词组装已抽出到 prompt-builder.ts（P4.5）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from '../app/window.js';
import { buildPrompt, PROMPT_DIR } from './prompt-builder.js';
import type { WebId } from './ids.js';

const require = createRequire(import.meta.url);
const { app, dialog } = require('electron');

// ========== 全局"上次项目目录"（跨窗口共享，用于目录选择框的默认位置）==========
function getLastProjectDirFile(): string {
  return path.join(app.getPath('userData'), 'last-project-dir.json');
}
function readLastProjectDir(): string | null {
  try {
    const f = getLastProjectDirFile();
    if (fs.existsSync(f)) {
      const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
      return (d && d.dir) || null;
    }
  } catch (_) { /* ignore */ }
  return null;
}
function writeLastProjectDir(dir: string): void {
  if (!dir) return;
  try {
    fs.writeFileSync(getLastProjectDirFile(), JSON.stringify({ dir }), 'utf-8');
  } catch (_) { /* ignore */ }
}

function logWithFile(providerId: string, msg: string): void {
  console.log(msg);
}

/**
 * 纯选择目录 + 保存映射（不发提示词）
 */
async function selectProjectDir(
  windowContext: any = null,
  presetDir: string | null = null,
  noDialog: boolean = false,
  parentSessionId: string | null = null,
  isCompaction: boolean = false
): Promise<{ success: boolean; message: string; dir?: string }> {
  const ctx = windowContext || windowState.getMainContext();
  const mainWindow = ctx ? ctx.win : windowState.getMainWindow();
  const view = ctx ? ctx.view : null;
  const sessionStore = ctx ? ctx.sessionStore : null;
  const providerId = (ctx && ctx.providerId) || '';

  let selectedDir: string;
  if (presetDir) {
    selectedDir = presetDir;
    console.log('[Cuckoo Code] 使用预设目录（自动初始化）:', selectedDir);
  } else if (noDialog) {
    selectedDir = '';
    console.log('[Cuckoo Code] noDialog：跳过目录选择（无预设目录）');
  } else {
    let defaultPath: string | undefined;
    try {
      const winLast = sessionStore && sessionStore.state ? sessionStore.state.selectedProjectDir : null;
      const last = (winLast && fs.existsSync(winLast)) ? winLast : readLastProjectDir();
      if (last && fs.existsSync(last)) defaultPath = last;
    } catch (_) { /* ignore */ }
    
    const result = dialog.showOpenDialogSync(mainWindow, {
      properties: ['openDirectory'],
      buttonLabel: '选择目录',
      title: '请选择要分析的项目目录',
      defaultPath,
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.focus();
      }
    }

    if (!result || result.length === 0) {
      console.log('[Cuckoo Code] 用户取消了目录选择');
      return { success: false, message: '用户取消了目录选择' };
    }
    selectedDir = result[0];
    console.log('[Cuckoo Code] 用户选择目录:', selectedDir);
  }

  if (selectedDir) writeLastProjectDir(selectedDir);

  if (sessionStore) {
    sessionStore.state.selectedProjectDir = selectedDir;

    // [022] 压缩场景：新会话还没出现（当前 URL 还是分享页），
    // 不能把目录保存到旧 logicId 上——否则新会话拿不到目录，旧记录被污染。
    // 改为存 pendingProjectDir，等新 webId 出现时在 handleUrlChange 里消费。
    if (isCompaction) {
      sessionStore.state.pendingProjectDir = selectedDir;
      console.log(`[Cuckoo Code] 压缩场景：暂存项目目录 ${selectedDir}，等新会话出现后绑定`);
    } else if (sessionStore.state.currentSessionId) {
      sessionStore.saveSessionDirMapping(sessionStore.state.currentSessionId, selectedDir);
      console.log(`[Cuckoo Code] 已保存会话 ${sessionStore.state.currentSessionId} -> ${selectedDir}`);
    } else {
      let sessionId: WebId | null = null;
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        const url = view.webContents.getURL();
        sessionId = sessionStore.extractSessionIdFromUrl(url);
      }
      if (sessionId) {
        sessionStore.state.currentSessionId = sessionId;
        sessionStore.saveSessionDirMapping(sessionId, selectedDir);
        console.log(`[Cuckoo Code] 从URL提取会话ID并保存: ${sessionId} -> ${selectedDir}`);
      } else {
        sessionStore.state.pendingProjectDir = selectedDir;
        console.log(`[Cuckoo Code] 暂存项目目录 ${selectedDir}，等待会话ID出现后绑定`);
      }
    }
  }

  // 发送目录更新事件到渲染进程
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.send('project-dir-updated', selectedDir);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('shell-project-dir', selectedDir); } catch (_) {}
  }

  return { success: true, message: '项目目录已更新', dir: selectedDir };
}

/**
 * 发送系统提示词
 */
async function sendSystemPrompt(
  windowContext: any = null,
  selectedDir: string = '',
  isCompaction: boolean = false,
  extraPrompt: string = ''
): Promise<{ success: boolean; message: string }> {
  const ctx = windowContext || windowState.getMainContext();
  const view = ctx ? ctx.view : null;
  const providerId = (ctx && ctx.providerId) || '';
  const tStart = Date.now();
  const stepLog = (msg: string) => logWithFile(providerId, '[Cuckoo Code][耗时] ' + msg + ' +' + (Date.now() - tStart) + 'ms');

  const built = buildPrompt({ providerId, selectedDir, isCompaction });
  if (built.error) {
    return { success: false, message: built.error };
  }
  stepLog('提示词组装完成');

  let combined = built.prompt;
  if (extraPrompt) {
    combined += '\n\n---\n\n' + extraPrompt;
  }
  console.log('[Cuckoo Code] 准备发送初始提示（不含目录树），长度:', combined.length);
  
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.send('initial-prompt', combined);
    try {
      const hv = ctx && (ctx as any).harnessView;
      if (hv && !hv.webContents.isDestroyed()) {
        hv.webContents.send('harness-event', { type: 'framework-send', tag: '系统提示词', system: true });
      }
    } catch (_) { /* ignore */ }
  }
  stepLog('initial-prompt 已发送');

  return { success: true, message: '已发送系统提示词' };
}

/**
 * 初始化项目（组合方法，兼容旧调用）
 */
async function initProject(
  skipPrompt: boolean = false,
  windowContext: any = null,
  presetDir: string | null = null,
  isCompaction: boolean = false,
  extraPrompt: string = '',
  noDialog: boolean = false,
  parentSessionId: string | null = null
): Promise<any> {
  const ctx = windowContext || windowState.getMainContext();
  const sessionStore = ctx ? ctx.sessionStore : null;

  if (isCompaction && parentSessionId && sessionStore) {
    sessionStore.state.pendingLineage = { parentId: parentSessionId, kind: 'compaction', agentName: null };
  }

  // 1. 选目录（压缩场景传 isCompaction=true，避免目录写到旧 logicId 上）
  const dirRes = await selectProjectDir(ctx, presetDir, noDialog, parentSessionId, isCompaction);
  if (!dirRes.success) return dirRes;

  // 2. 如果只是更新目录，直接返回
  if (skipPrompt) {
    return { success: true, message: '项目目录已更新' };
  }

  // 3. 发提示词
  const promptRes = await sendSystemPrompt(ctx, dirRes.dir || '', isCompaction, extraPrompt);
  if (!promptRes.success) return promptRes;

  return { success: true, message: '初始化完成，已发送系统提示词、工具规则和工具库' };
}

export { PROMPT_DIR, initProject, selectProjectDir, sendSystemPrompt };

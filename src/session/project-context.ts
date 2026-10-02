/**
 * 项目初始化：目录选择、会话映射保存、系统提示词发送
 * 提示词组装已抽出到 prompt-builder.ts（P4.5）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from '../app/window.js';
import { buildPrompt, PROMPT_DIR } from './prompt-builder.js';

const require = createRequire(import.meta.url);
const { app, dialog } = require('electron');

/**
 * 同时输出到终端和对应平台的日志文件（与渲染进程日志同目录）
 */
function logWithFile(providerId: string, msg: string): void {
  console.log(msg);
  try {
    if (!app.isPackaged) {
      const logDir = path.join(app.getPath('userData'), 'wyp', 'log');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, (providerId || 'default') + '.log');
      fs.appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf-8');
    }
  } catch (_) {}
}

/**
 * 初始化项目：选择目录并发送 systemPrompt
 * 供 IPC 调用（用户点击初始化按钮时触发）
 * @param skipPrompt 如果为 true，只更新目录映射，不发送初始提示（用于修改目录）
 * @param windowContext 窗口上下文
 * @param presetDir 预设项目目录（如压缩后自动初始化）。提供时跳过目录选择对话框。
 * @param isCompaction 是否为压缩后初始化（末尾追加"请继续你之前的工作"）
 * @param extraPrompt 追加到提示词末尾的额外内容（子代理用它带上"代理系统提示 + 任务"）
 * @param noDialog 为 true 时不弹目录选择框（子代理场景：目录取不到就用空值继续）
 */
async function initProject(skipPrompt: boolean = false, windowContext: any = null, presetDir: string | null = null, isCompaction: boolean = false, extraPrompt: string = '', noDialog: boolean = false): Promise<any> {
  const ctx = windowContext || windowState.getMainContext();
  const mainWindow = ctx ? ctx.win : windowState.getMainWindow();
  // AI 页面在 WebContentsView 中（壳窗口的 win.webContents 是地址栏壳页面）
  const view = ctx ? ctx.view : null;
  const sessionStore = ctx ? ctx.sessionStore : null;
  // providerId 来自窗口上下文（可能为空，表示未确定平台）
  const providerId = (ctx && ctx.providerId) || '';

  let selectedDir: string;
  if (presetDir) {
    // 预设目录（压缩后自动初始化）：直接用，不弹框
    selectedDir = presetDir;
    console.log('[Cuckoo Code] 使用预设目录（自动初始化）:', selectedDir);
  } else if (noDialog) {
    // 子代理场景：不弹框，无目录则用空值继续（工具提示里 projectDir 为空）
    selectedDir = '';
    console.log('[Cuckoo Code] noDialog：跳过目录选择（无预设目录）');
  } else {
    // 先让用户选择目录
    const result = dialog.showOpenDialogSync(mainWindow, {
      properties: ['openDirectory'],
      buttonLabel: '选择目录',
      title: '请选择要分析的项目目录',
    });

    // 无论用户是否选择目录，对话框关闭后都恢复主窗口焦点（避免输入框失效）
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
  const tStart = Date.now();
  const stepLog = (msg: string) => logWithFile(providerId, '[Cuckoo Code][耗时] ' + msg + ' +' + (Date.now() - tStart) + 'ms');

  // 保存选中的项目目录（若该窗口有独立的 sessionStore）
  if (sessionStore) {
    sessionStore.state.selectedProjectDir = selectedDir;

    // ========== 持久化存储会话-目录映射 ==========
    if (sessionStore.state.currentSessionId) {
      sessionStore.saveSessionDirMapping(sessionStore.state.currentSessionId, selectedDir);
      console.log(`[Cuckoo Code] 已保存会话 ${sessionStore.state.currentSessionId} -> ${selectedDir}`);
    } else {
      // 如果未能获取会话ID，尝试从当前URL提取
      let sessionId: string | null = null;
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        const url = view.webContents.getURL();
        sessionId = sessionStore.extractSessionIdFromUrl(url);
      }
      if (sessionId) {
        sessionStore.state.currentSessionId = sessionId;
        sessionStore.saveSessionDirMapping(sessionId, selectedDir);
        console.log(`[Cuckoo Code] 从URL提取会话ID并保存: ${sessionId} -> ${selectedDir}`);
      } else {
        // 无法获取会话ID，暂存项目目录，等待URL变化后绑定
        sessionStore.state.pendingProjectDir = selectedDir;
        console.log(`[Cuckoo Code] 暂存项目目录 ${selectedDir}，等待会话ID出现后绑定`);
      }
    }
  }

  stepLog('目录保存完成');
  // 发送目录更新事件到渲染进程
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.send('project-dir-updated', selectedDir);
  }
  // 通知壳页面（地址栏显示项目目录）
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('shell-project-dir', selectedDir); } catch (_) {}
  }

  // 如果只是修改目录，跳过发送初始提示
  if (skipPrompt) {
    return { success: true, message: '项目目录已更新' };
  }

  // 组装提示词（模板读取 + 占位符填充 + MCP/平台/项目章节）
  const built = buildPrompt({ providerId, selectedDir, isCompaction });
  if (built.error) {
    return { success: false, message: built.error };
  }
  stepLog('提示词组装完成');

  let combined = built.prompt;
  // 子代理等场景：在完整系统提示词末尾追加"代理系统提示 + 任务"
  if (extraPrompt) {
    combined += '\n\n---\n\n' + extraPrompt;
  }
  console.log('[Cuckoo Code] 准备发送初始提示（不含目录树），长度:', combined.length);
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.send('initial-prompt', combined);
    // 主进程直接告诉纯净模式：框架正在驱动 AI 页面（不依赖 AI 页面 bridge 门控，
    // 因为此刻页面可能正处在导航/重载中，bridge 尚未就绪）。
    // 只反馈运行态，提示词内容不进对话流。
    try {
      const hv = ctx && (ctx as any).harnessView;
      if (hv && !hv.webContents.isDestroyed()) {
        hv.webContents.send('harness-event', { type: 'framework-send', tag: '系统提示词', system: true });
      }
    } catch (_) { /* ignore */ }
  }
  stepLog('initial-prompt 已发送');

  return { success: true, message: '初始化完成，已发送系统提示词、工具规则和工具库' };
}

export { PROMPT_DIR, initProject };

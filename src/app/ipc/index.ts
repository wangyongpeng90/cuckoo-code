/**
 * IPC 处理器注册总入口（渲染进程 → 主进程）
 * 按领域拆分为子注册器；本文件仅负责编排。
 */
import { registerProjectIpc } from './project.js';
import { registerSessionIpc } from './session.js';
import { registerCommandIpc } from './command.js';
import { registerToolIpc } from './tool.js';
import { registerRendererIpc } from './renderer.js';
import { registerShellIpc } from './shell.js';
import { registerSubagentIpc } from './subagent.js';
import { registerHarnessIpc } from './harness.js';
import { registerSnippetsIpc } from './snippets.js';
import { registerSettingsIpc } from './settings.js';
import { registerFeishuIpc } from './feishu.js';
import { registerPluginIpc } from './plugin.js';
import { registerWindowGroupsIpc, onSwitchShareResult } from './window-groups.js';
import { registerSchedulerIpc } from './scheduler.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerIpcHandlers(): void {
  // 窗口组切换：AI 页面分享回执
  ipcMain.on('cuckoo-switch-share-result', onSwitchShareResult);
  registerProjectIpc();
  registerSessionIpc();
  registerCommandIpc();
  registerToolIpc();
  registerRendererIpc();
  registerShellIpc();
  registerSubagentIpc();
  registerHarnessIpc();
  registerSnippetsIpc();
  registerSettingsIpc();
  registerFeishuIpc();
  registerPluginIpc();
  registerWindowGroupsIpc();
  registerSchedulerIpc();
}

export { registerIpcHandlers };

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

function registerIpcHandlers(): void {
  registerProjectIpc();
  registerSessionIpc();
  registerCommandIpc();
  registerToolIpc();
  registerRendererIpc();
  registerShellIpc();
  registerSubagentIpc();
}

export { registerIpcHandlers };

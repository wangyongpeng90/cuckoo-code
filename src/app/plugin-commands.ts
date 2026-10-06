/**
 * 插件命令（主进程侧）
 *
 * 插件用 ctx.command.register 注册命令；壳页面/其他入口列出并触发。
 * 触发时反向 IPC 到注册它的渲染进程执行（照 plugin-tools 模式）。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface RegisteredCommand {
  commandId: string;
  pluginName: string;
  title: string;
  webContentsId: number;
}

const registered = new Map<string, RegisteredCommand>();
const pendingRuns = new Map<string, (r: any) => void>();
let runSeq = 0;

/** 注册一个命令 */
function registerCommandFromRenderer(sender: any, info: any): { success: boolean; error?: string } {
  const { commandId, pluginName, title } = info || {};
  if (!commandId) return { success: false, error: '缺少 commandId' };
  registered.set(commandId, {
    commandId,
    pluginName: pluginName || '',
    title: title || commandId,
    webContentsId: sender.id,
  });
  return { success: true };
}

function unregisterCommand(commandId: string): void {
  if (!commandId) return;
  registered.delete(commandId);
}

/** 列出所有命令（供壳页面显示） */
function listCommands(): RegisteredCommand[] {
  return Array.from(registered.values()).map(r => ({
    commandId: r.commandId,
    pluginName: r.pluginName,
    title: r.title,
  })) as any;
}

/** 触发命令：反向 IPC 到注册者执行（支持裸 id：后缀匹配 '::id'）*/
function invokeCommand(commandId: string): Promise<any> {
  let reg = registered.get(commandId);
  if (!reg) {
    // 裸 id（如 'my-cmd'）→ 匹配 'plugin::my-cmd'
    const suffix = '::' + commandId;
    for (const r of registered.values()) {
      if (r.commandId === commandId || r.commandId.endsWith(suffix)) { reg = r; break; }
    }
  }
  if (!reg) return Promise.resolve({ success: false, error: '命令不存在: ' + commandId });
  const { webContents } = require('electron');
  const wc = webContents.fromId(reg.webContentsId);
  if (!wc || wc.isDestroyed()) return Promise.resolve({ success: false, error: '命令所属窗口已关闭' });
  const runId = 'plugin-cmd-' + (++runSeq) + '-' + Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRuns.delete(runId);
      resolve({ success: false, error: '命令执行超时' });
    }, 30000);
    pendingRuns.set(runId, (r: any) => {
      clearTimeout(timer);
      resolve(r || { success: true });
    });
    wc.send('plugin-command-invoke', { commandId: reg.commandId, runId });
  });
}

function resolvePendingCommandRun(runId: string, result: any): void {
  const resolve = pendingRuns.get(runId);
  if (resolve) {
    pendingRuns.delete(runId);
    resolve(result);
  }
}

export { registerCommandFromRenderer, unregisterCommand, listCommands, invokeCommand, resolvePendingCommandRun };

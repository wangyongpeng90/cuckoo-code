/**
 * 插件工具（主进程侧）
 *
 * 渲染进程的插件通过 ctx.tools.register 注册工具；这里：
 *   1. 收注册信息，建一个 PluginTool 加入 ToolRegistry
 *   2. 工具执行时，反向 IPC 到注册它的渲染进程执行
 *   3. 渲染进程回传结果
 *
 * 依赖方向：app 层，可用 electron（webContents 发 IPC）。
 */
import { createRequire } from 'node:module';
import { Tool } from '../tools/core/Tool.js';
import { ToolResult } from '../tools/core/ToolResult.js';

const require = createRequire(import.meta.url);
const { app } = require('electron');

/** 已注册的插件工具（toolId → 信息） */
interface RegisteredTool {
  toolId: string;
  pluginName: string;
  name: string;
  description: string;
  parameters: any;
  jsApi: string | null;
  /** 注册者：webContents.id（用于反向 IPC） */
  webContentsId: number;
}

const registered = new Map<string, RegisteredTool>();
/** 待回传的工具调用（callId → resolve） */
const pendingCalls = new Map<string, (r: any) => void>();

let callSeq = 0;

/** 取全局 ToolRegistry（与主流程共用一个实例） */
function getToolRegistry(): any {
  // toolRegistry 是 index.ts 里导出的单例
  const { toolRegistry } = require('../tools/index.js');
  return toolRegistry;
}

/** 一个插件工具（execute 时反向 IPC 到渲染进程） */
class PluginTool extends Tool {
  private reg: RegisteredTool;
  constructor(reg: RegisteredTool) {
    super(reg.name, reg.description, reg.parameters, reg.jsApi);
    this.reg = reg;
  }
  async execute(params: any): Promise<any> {
    const { webContents } = require('electron');
    const wc = webContents.fromId(this.reg.webContentsId);
    if (!wc || wc.isDestroyed()) {
      return ToolResult.error('插件工具所属窗口已关闭: ' + this.reg.name);
    }
    const callId = 'plugin-tool-' + (++callSeq) + '-' + Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(callId);
        resolve(ToolResult.error('插件工具执行超时: ' + this.reg.name));
      }, 30000);
      pendingCalls.set(callId, (r: any) => {
        clearTimeout(timer);
        if (r && r.success) {
          // 返回字符串化结果（与 Cuckoo 工具一致）
          try { resolve(typeof r.result === 'string' ? r.result : JSON.stringify(r.result)); }
          catch { resolve(String(r.result)); }
        } else {
          resolve(ToolResult.error((r && r.error) || '插件工具执行失败'));
        }
      });
      wc.send('plugin-tool-invoke', { toolId: this.reg.toolId, args: params, callId });
    });
  }
}

/** 渲染进程注册插件工具 */
function registerPluginToolFromRenderer(sender: any, info: any): { success: boolean; error?: string } {
  const { toolId, pluginName, name, description, parameters, jsApi } = info || {};
  if (!toolId || !name) return { success: false, error: '缺少 toolId 或 name' };
  // 先注销旧的（重载场景）
  unregisterPluginTool(toolId);
  const reg: RegisteredTool = {
    toolId, pluginName: pluginName || '', name, description: description || '',
    parameters: parameters || { type: 'object', properties: {} },
    jsApi: jsApi || null,
    webContentsId: sender.id,
  };
  registered.set(toolId, reg);
  try {
    getToolRegistry().register(new PluginTool(reg));
  } catch (err: any) {
    return { success: false, error: '注册到 ToolRegistry 失败: ' + (err && err.message) };
  }
  console.log('[plugin-tool] 注册: ' + toolId);
  return { success: true };
}

/** 注销插件工具 */
function unregisterPluginTool(toolId: string): void {
  if (!toolId) return;
  const reg = registered.get(toolId);
  if (!reg) return;
  registered.delete(toolId);
  try {
    const registry = getToolRegistry();
    if (registry && registry.tools && registry.tools.delete) {
      registry.tools.delete(reg.name);
    }
  } catch (_) { /* ignore */ }
  console.log('[plugin-tool] 注销: ' + toolId);
}

/** 渲染进程回传工具执行结果 */
function resolvePendingToolCall(callId: string, result: any): void {
  const resolve = pendingCalls.get(callId);
  if (resolve) {
    pendingCalls.delete(callId);
    resolve(result);
  }
}

export { registerPluginToolFromRenderer, unregisterPluginTool, resolvePendingToolCall };

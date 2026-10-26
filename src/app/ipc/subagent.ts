/**
 * IPC：子代理回复上报
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { onSubagentResponse, getGatewayStream } from '../subagent.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerSubagentIpc(): void {
  // 子代理 bridge 上报最终文本
  ipcMain.handle('subagent-response', async (event: any, { text }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (ctx && ctx.win && !ctx.win.isDestroyed()) {
      onSubagentResponse(ctx.win.id, text || '');
    }
    return { success: true };
  });

  // 子代理/网关 bridge 上报流式进度。
  // 网关窗口：把流式增量（思考/正文/done）转发给主进程的等待方（runGatewayQuery 的 onChunk）。
  ipcMain.on('subagent-progress', (event: any, payload: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
    const gwCb = getGatewayStream(ctx.win.id);
    if (gwCb) {
      try { gwCb({ think: payload.think, text: payload.text, preview: payload.preview, done: !!payload.done }); } catch (_) { /* ignore */ }
    }
  });
}

export { registerSubagentIpc };

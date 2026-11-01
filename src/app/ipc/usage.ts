/**
 * [261031-x7k9p2] AI 用量统计 IPC
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { insertUsageLog, getLastReplyToken, getUsageStats, calculateDiffToken } from '../../session/usage-log.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerUsageIpc(): void {
  // 接收来自渲染进程的打点（send / reply）
  ipcMain.on('log-ai-usage', (event: any, data: any) => {
    try {
      const db = (global as any).__globalDb;
      if (!db) return;

      const ctx = windowState.getContextByWebContents(event.sender);
      const logicId = ctx && ctx.sessionStore && ctx.sessionStore.state ? ctx.sessionStore.state.currentSessionId : null;
      const profileId = ctx ? ctx.profileId : null;
      const providerId = data.providerId || (ctx ? ctx.providerId : 'unknown');
      
      let totalToken = data.totalToken || 0;
      let diffToken = data.diffToken || 0;

      // 如果是 reply 事件，且带回了 totalToken，说明是 DeepSeek 的精确累计值
      if (data.eventType === 'reply' && totalToken > 0 && logicId) {
        const lastTotal = getLastReplyToken(db, logicId);
        diffToken = calculateDiffToken(totalToken, lastTotal);
      }

      console.log('[Usage IPC] 收到打点:', data.eventType, 'logicId=', logicId);

      insertUsageLog(db, logicId, profileId, providerId, data.eventType, totalToken, diffToken);
    } catch (err: any) {
      console.error('[Usage IPC] 记录失败:', err.message);
    }
  });

  // 查询图表数据
  ipcMain.handle('get-usage-stats', async (_event: any, { granularity, startTime, endTime, profileId }: any) => {
    try {
      const db = (global as any).__globalDb;
      if (!db) return { success: false, error: '数据库未初始化' };
      const data = getUsageStats(db, granularity || 'day', startTime, endTime, profileId);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerUsageIpc };

/**
 * 工具/JS 脚本执行器（与回复获取方式无关）
 * 拦截模式和 DOM 模式共用的执行逻辑：执行工具调用、执行 JS 脚本、通知 UI。
 * 任务预览/结果/历史走 reportToolActivity → 主进程 → 壳页面任务面板，
 * 不再写 overlay 内的命令预览/历史 UI。
 * command 存完整脚本（不截断）；列表截断显示、详情展开全文由 shell 任务面板负责。
 */
import { showToast } from '../../overlay/panel.js';
import type { ToolActivityEntry } from '../api-types.js';

// 是否正在执行命令或工具
let isExecuting = false;

/** 上报一条工具活动到任务面板（上报失败不影响执行主流程） */
function reportActivity(entry: ToolActivityEntry): void {
  try {
    const api = window.electronAPI;
    if (api && typeof api.reportToolActivity === 'function') {
      Promise.resolve(api.reportToolActivity(entry)).catch(() => {});
    }
  } catch (_) { /* 桥不可用时静默：执行结果照常返回 */ }
}

/**
 * 执行检测到的 JS 工具脚本
 * 执行中（running）与完成（done）各上报一次，同 id 更新任务面板条目。
 */
async function handleJsToolScript(code: string): Promise<{ code: string; result: any }> {
  isExecuting = true;
  showToast('开始执行命令');

  const callId = 'js_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const command = '[JS] ' + code;
  console.log('[Cuckoo Code] [诊断] 即将执行的代码(JSON转义): ' + JSON.stringify(code));

  reportActivity({
    id: callId,
    command,
    success: false,
    canceled: false,
    output: '',
    timestamp: Date.now(),
    status: 'running',
  });

  try {
    const result = await window.electronAPI.executeJs(code, callId);

    reportActivity({
      id: callId,
      command,
      success: !!result.success,
      canceled: false,
      output: result.success ? (result.output || '') : (result.error || '未知错误'),
      timestamp: Date.now(),
      status: 'done',
    });

    return { code, result };
  } catch (err: any) {
    console.error('[Cuckoo Code] JS 工具脚本执行异常:', err);
    reportActivity({
      id: callId,
      command,
      success: false,
      canceled: false,
      output: '系统异常: ' + (err.message || String(err)),
      timestamp: Date.now(),
      status: 'done',
    });
    return { code, result: { success: false, error: '系统异常: ' + (err.message || String(err)) } };
  } finally {
    isExecuting = false;
  }
}

export {
  handleJsToolScript,
};

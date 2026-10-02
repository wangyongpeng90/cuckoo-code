/**
 * goalDone 工具 —— 目标模式的显式结束动作
 *
 * AI 在 /goal 目标全部完成后调用本工具，主进程直接向该窗口的 harness 视图
 * 推送 goal-done 事件收束目标。取代旧版"回复末尾输出 [[GOAL_DONE]] 文本标记"
 * 的约定——文本标记靠模型自律，漏输出则目标永不收束，只能靠无进展兜底停表。
 */
import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { getWindowContext } from '../../app/window.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 19,
    category: '任务管理',
    name: 'goalDone',
    doc: [
      '宣告当前目标（/goal 设定的自动多轮任务）已全部完成，结束自动推进。',
      '仅在目标的所有要求都确实完成后调用；调用前先在正文给出完成情况总结。',
      '非目标模式的普通对话不需要调用本工具。',
    ].join('\n'),
    params: '',
    returns: 'Promise<string>',
    returnsDoc: '确认消息',
    throws: '缺少窗口上下文、窗口已关闭或纯净对话模式未开启时抛出异常',
  },
];

class GoalDoneTool extends Tool {
  constructor() {
    super(
      'goalDone',
      '宣告当前目标（/goal 设定的自动多轮任务）已全部完成，结束目标的自动推进。仅在目标的所有要求都确实完成后调用；调用前先在正文给出完成情况总结。非目标模式的普通对话不要调用本工具。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      'goalDone()'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:goalDone',
      order: 115,
      text: '当 /goal 目标的所有要求都确实完成后，调用 goalDone() 结束目标的自动推进；调用前先在正文给出完成情况总结。目标未完成或遇到阻碍时不要调用，继续推进或说明原因。普通对话（非目标模式）不要调用本工具。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { currentWindowId, windowId } = params || {};
    const targetWindowId = currentWindowId !== undefined && currentWindowId !== null ? currentWindowId : windowId;
    if (targetWindowId === undefined || targetWindowId === null) {
      return ToolResult.error('缺少窗口上下文，无法定位当前对话窗口');
    }
    const ctx: any = getWindowContext(targetWindowId);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
      return ToolResult.error('当前对话窗口不存在或已关闭');
    }
    const hv = ctx.harnessView;
    if (!hv || !hv.webContents || hv.webContents.isDestroyed()) {
      return ToolResult.error('纯净对话模式未开启，没有目标可结束');
    }
    try {
      hv.webContents.send('harness-event', { type: 'goal-done' });
    } catch (err: any) {
      return ToolResult.error('推送目标完成事件失败: ' + (err.message || String(err)));
    }
    console.log('[GoalDoneTool] AI 已宣告目标完成（window ' + targetWindowId + '）');
    return ToolResult.success({ message: '目标已完成，自动推进已结束。' });
  }
}

/** JsRunner 沙箱注入：定义 globalThis.goalDone。 */
export function bootstrap(__call: any): void {
  (globalThis as any).goalDone = async function () {
    return await __call('goalDone', {});
  };
}

export { GoalDoneTool };

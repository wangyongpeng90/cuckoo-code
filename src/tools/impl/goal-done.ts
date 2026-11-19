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

/**
 * 推送"目标完成"事件到该窗口的 harness 视图（由 app 层注入，避免 tools → app 的反向依赖）。
 * @returns { success, error? }
 */
export type GoalDonePusher = (windowId: number) => { success: boolean; error?: string };

let _pushGoalDone: GoalDonePusher | null = null;

/** 由 app 层注入实现 */
export function injectGoalDonePusher(fn: GoalDonePusher): void {
  _pushGoalDone = fn;
}

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 9.5,
    category: '任务管理',
    name: 'goalDone',
    doc: '宣告 /goal 自动多轮任务已全部完成并结束推进；仅在目标所有要求确实完成后调用，调用前先在正文总结。普通对话不要调用。',
    params: '',
    returns: 'Promise<string>',
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

  async execute(params: any): Promise<ToolResult> {
    const { currentWindowId, windowId } = params || {};
    const targetWindowId = currentWindowId !== undefined && currentWindowId !== null ? currentWindowId : windowId;
    if (targetWindowId === undefined || targetWindowId === null) {
      return ToolResult.error('缺少窗口上下文，无法定位当前对话窗口');
    }
    if (!_pushGoalDone) return ToolResult.error('目标完成推送器未初始化');
    const r = _pushGoalDone(targetWindowId);
    if (!r || !r.success) {
      return ToolResult.error(r && r.error ? r.error : '推送目标完成事件失败');
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

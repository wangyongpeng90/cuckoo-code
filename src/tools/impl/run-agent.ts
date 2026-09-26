import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { scanAgents } from '../../agents/index.js';

// ========== D12：API 契约元数据 ==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 14,
    category: 'Agent',
    name: 'runAgent',
    doc: '把任务委派给一个子代理（独立上下文的 AI 对话）执行，返回子代理的最终结果摘要。适合大范围搜索/分析、独立子任务，避免污染当前上下文。',
    params: 'name: string, task: string',
    returns: 'Promise<string>',
    paramDocs: {
      name: '子代理名称（见系统提示词「可用子代理」章节）',
      task: '要委派的任务描述',
    },
    returnsDoc: '子代理的最终文本结果',
    throws: '代理不存在、父窗口上下文缺失或执行超时时抛出异常',
  },
];

/**
 * 子代理执行器（由 app 层注入，避免 tools → app 的反向依赖）。
 * 接收 { agent, task, currentWindowId }，返回子代理最终文本。
 */
export type AgentRunner = (args: { agent: any; task: string; currentWindowId: number }) => Promise<string>;

let _runner: AgentRunner | null = null;

/** 由 app 层注入子代理执行实现 */
export function injectAgentRunner(fn: AgentRunner): void {
  _runner = fn;
}

class RunAgentTool extends Tool {
  constructor() {
    super(
      'runAgent',
      '把任务委派给子代理（独立上下文的 AI 对话），返回结果摘要。适合大范围搜索/分析、独立子任务。',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: '子代理名称（见「可用子代理」章节）' },
          task: { type: 'string', description: '要委派的任务描述' },
        },
        required: ['name', 'task'],
        additionalProperties: false,
      },
      'runAgent(name, task)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:runAgent',
      order: 113,
      text: '使用 runAgent(name, task) 把任务委派给子代理。子代理在独立上下文中完成，只把结果摘要返回。',
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { name, task, projectDir, currentWindowId } = params;
    if (!name || !task) return ToolResult.error('name 和 task 必填');
    if (typeof currentWindowId !== 'number') return ToolResult.error('缺少窗口上下文');
    // 防递归：子代理窗口不能再调 runAgent
    try {
      const { getWindowContext } = await import('../../app/window.js');
      const ctx = getWindowContext(currentWindowId);
      if (ctx && ctx.profileId && String(ctx.profileId).startsWith('subagent-')) {
        return ToolResult.error('子代理不允许再调用 runAgent（防递归）');
      }
    } catch (_) { /* ignore */ }

    // 找代理定义
    const agents = scanAgents(projectDir || null);
    const agent = agents.find((a) => a.name === name);
    if (!agent) return ToolResult.error('未找到子代理: ' + name);

    if (!_runner) return ToolResult.error('子代理执行器未初始化');

    try {
      const text = await _runner({ agent, task, currentWindowId });
      return ToolResult.success(text);
    } catch (err: any) {
      return ToolResult.error('子代理执行失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入 */
export function bootstrap(__call: any): void {
  (globalThis as any).runAgent = async function (name: any, task: any) {
    return await __call('runAgent', { name, task });
  };
}

export { RunAgentTool };

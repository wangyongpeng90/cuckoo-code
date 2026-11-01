import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';

// ========== D12：API 契约元数据 ==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 16,
    category: '会话',
    name: 'nameConversation',
    doc: '给当前对话起一个简短标题（用于工作区列表识别）。对话主题明确后调用一次即可。',
    usage: [
      '**对话命名（重要）**：每次对话的**首条用户消息**处理时，**立即**调用一次 nameConversation(title) 给本次对话起个简短标题（中文，≤20 字，概括用户意图）。',
      '这是本次对话的**第一个动作**，先命名再干别的。',
      '示例：用户说"帮我修复登录 bug" → 先 await nameConversation("修复登录 bug")，再开始干活。',
      '（若首条消息就很笼统如"你好"，可先用"打招呼"之类的标题，后续主题明确时可再调一次更新。）',
    ].join('\n'),
    params: 'title: string',
    returns: 'Promise<{ message: string }>',
    paramDocs: {
      title: '对话标题（简短，建议不超过 20 字）',
    },
    returnsDoc: '{ message: string }',
    throws: '缺少窗口上下文、当前无会话或标题为空时抛出异常',
  },
];

/** 设置当前会话标题的实现（由 app 层注入，避免 tools → app 反向依赖） */
export type SessionTitleSetter = (args: { windowId: number; title: string }) => Promise<{ success: boolean; error?: string }>;

let _setter: SessionTitleSetter | null = null;

/** 由 app 层注入 */
export function injectSessionTitleSetter(fn: SessionTitleSetter): void {
  _setter = fn;
}

class NameConversationTool extends Tool {
  constructor() {
    super(
      'nameConversation',
      '给当前对话起一个简短标题，便于在工作区列表识别。',
      {
        type: 'object',
        properties: {
          title: { type: 'string', description: '对话标题（简短，建议不超过 20 字）' },
        },
        required: ['title'],
        additionalProperties: false,
      },
      'nameConversation(title)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const { title, currentWindowId } = params;
    if (typeof currentWindowId !== 'number') return ToolResult.error('缺少窗口上下文');
    const t = String(title || '').trim();
    if (!t) return ToolResult.error('标题为空');
    if (!_setter) return ToolResult.error('会话标题设置器未初始化');
    try {
      const r = await _setter({ windowId: currentWindowId, title: t });
      if (!r || !r.success) return ToolResult.error((r && r.error) || '设置失败');
      return ToolResult.success({ message: '对话已命名为：' + t });
    } catch (err: any) {
      return ToolResult.error('设置对话标题失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入 */
export function bootstrap(__call: any): void {
  (globalThis as any).nameConversation = async function (title: any) {
    return await __call('nameConversation', { title: title });
  };
}

export { NameConversationTool };

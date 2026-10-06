import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';

// ========== D12：API 契约元数据 ==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 17,
    category: '记忆',
    name: 'remember',
    doc: '把用户明确表达的偏好、习惯或长期有用的事实记入长期记忆（跨会话、跨项目保留）。后续对话会自动注入这些记忆。',
    params: 'text: string',
    returns: 'Promise<{ id: string, message: string }>',
    paramDocs: {
      text: '要记住的内容（一句话，如"用户偏好用中文回复"）',
    },
    returnsDoc: '{ id: string, message: string }',
    throws: '缺少窗口上下文或内容为空时抛出异常',
  },
  {
    order: 18,
    category: '记忆',
    name: 'forgetMemory',
    doc: '按 id 删除一条长期记忆（当用户要求"忘掉"某事，或记忆已过时）。可用 listMemories 查看现有记忆及其 id。',
    params: 'id: string',
    returns: 'Promise<string>',
    paramDocs: {
      id: '要删除的记忆 id',
    },
    returnsDoc: '确认消息',
    throws: 'id 为空或记忆不存在时抛出异常',
  },
];

/** 记忆存储接口（由 app 层注入，避免 tools → app 反向依赖） */
export interface MemoryStore {
  add: (text: string) => { id: string } | null;
  remove: (id: string) => boolean;
  list: () => Array<{ id: string; text: string }>;
}

let _store: MemoryStore | null = null;

/** 由 app 层注入 */
export function injectMemoryStore(store: MemoryStore): void {
  _store = store;
}

class RememberTool extends Tool {
  constructor() {
    super(
      'remember',
      '把用户偏好、习惯或长期有用的事实记入长期记忆（跨会话保留）。',
      {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要记住的内容（一句话）' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      'remember(text)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:remember',
      order: 115,
      text: [
        '**长期记忆**：当用户明确表达**偏好、习惯或长期有用的事实**（如"以后都用中文回复"、"提交信息用中文"、"我讨厌写注释"）时，记下来——后续对话会自动带上这些记忆。',
        '两种记法：① 调用 remember(text)（推荐，正文干净）；② 在回复里**单独一行**输出 `[记忆]内容`（更轻，软件会自动捕获；注意标记会留在对话正文里）。标记必须在行首单独成行。',
        '只记**稳定、可复用**的信息；不要记一次性任务细节。',
        '记忆已过时或用户要求忘记时，用 forgetMemory(id) 删除。',
      ].join('\n'),
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const text = String(params.text || '').trim();
    if (!text) return ToolResult.error('记忆内容为空');
    if (!_store) return ToolResult.error('记忆存储未初始化');
    try {
      const r = _store.add(text);
      if (!r) return ToolResult.error('保存失败');
      return ToolResult.success({ id: r.id, message: '已记住：' + text });
    } catch (err: any) {
      return ToolResult.error('保存记忆失败: ' + err.message);
    }
  }
}

class ForgetMemoryTool extends Tool {
  constructor() {
    super(
      'forgetMemory',
      '按 id 删除一条长期记忆。',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的记忆 id' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      'forgetMemory(id)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const id = String(params.id || '').trim();
    if (!id) return ToolResult.error('id 为空');
    if (!_store) return ToolResult.error('记忆存储未初始化');
    try {
      const ok = _store.remove(id);
      if (!ok) return ToolResult.error('记忆不存在: ' + id);
      return ToolResult.success('已删除记忆: ' + id);
    } catch (err: any) {
      return ToolResult.error('删除记忆失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入 */
export function bootstrap(__call: any): void {
  (globalThis as any).remember = async function (text: any) {
    return await __call('remember', { text: text });
  };
  (globalThis as any).forgetMemory = async function (id: any) {
    return await __call('forgetMemory', { id: id });
  };
}

export { RememberTool, ForgetMemoryTool };

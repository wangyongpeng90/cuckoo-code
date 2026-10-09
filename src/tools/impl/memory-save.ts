import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { saveMemory } from '../../memory/index.js';

// ========== D12：API 契约元数据 ==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 12,
    category: '长期记忆',
    name: 'memorySave',
    types: [
      '/** 记忆类型：用户画像 / 行为反馈 / 话题上下文 / 参考资料 */',
      "type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';",
      '',
      '/** memorySave 的入参 */',
      'interface MemorySaveOptions {',
      '  /** 记忆类型 */',
      '  type: MemoryType;',
      '  /** 简短标题（如「用户职业」） */',
      '  name: string;',
      '  /** 记忆正文 */',
      '  content: string;',
      '  /** 补充描述 */',
      '  description?: string;',
      '  /** 标签（用于后续关键词匹配） */',
      '  tags?: string[];',
      '}',
    ].join('\n'),
    doc: '保存一条长期记忆。当用户透露身份/偏好、纠正你的行为、或出现重要决策时调用。',
    params: 'options: MemorySaveOptions',
    returns: 'Promise<string>',
    paramDocs: {
      options: '记忆内容：type/name/content 必填，description/tags 可选',
    },
    returnsDoc: '保存确认消息，如 "已保存记忆 #3：[user] 用户职业"',
    throws: 'name/content 为空、type 非法、写入失败时抛出异常',
  },
];

interface MemorySaveOptions {
  type: string;
  name: string;
  content: string;
  description?: string;
  tags?: string[];
}

class MemorySaveTool extends Tool {
  constructor() {
    super(
      'memorySave',
      '保存一条长期记忆。当用户透露身份/偏好/习惯、纠正你的回答方式、或出现重要技术决策时调用。仅保存长期有价值的信息，不保存一次性问答。',
      {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['user', 'feedback', 'topic', 'reference'],
            description: 'user=用户画像 / feedback=行为反馈 / topic=话题上下文 / reference=参考资料',
          },
          name: { type: 'string', description: '简短标题，如「用户职业」' },
          content: { type: 'string', description: '记忆正文' },
          description: { type: 'string', description: '补充描述（可选）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签，用于后续关键词匹配' },
        },
        required: ['type', 'name', 'content'],
        additionalProperties: false,
      },
      'memorySave({ type, name, content, description?, tags? })'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:memorySave',
      order: 125,
      text: [
        '保存长期记忆（跨对话复用）。当对话中出现以下情况时，你**必须**调用 memorySave：',
        '- 用户提到自己的身份、职业、角色',
        '- 用户表达偏好、习惯或工作方式',
        '- 用户纠正你的回答方式或行为',
        '- 出现重要的技术决策、架构选型',
        '- 用户明确说"记住"、"记下来"、"别忘了"等',
        '仅保存长期有价值的信息；不要重复保存"已有记忆"里已存在的信息。',
      ].join('\n'),
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { options, projectDir } = params;
    try {
      if (!options || typeof options !== 'object') throw new Error('缺少 options');
      // 方案 A：记忆绑定当前项目目录，不同项目隔离
      const id = await saveMemory({
        type: options.type,
        name: options.name,
        content: options.content,
        description: options.description,
        tags: options.tags,
        scope: projectDir ? 'project' : 'global',
        projectId: projectDir || undefined,
      });
      return ToolResult.success('已保存记忆 #' + id + '：[' + options.type + '] ' + String(options.name).trim());
    } catch (err: any) {
      return ToolResult.error('保存记忆失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.memorySave */
export function bootstrap(__call: any): void {
  (globalThis as any).memorySave = async function (options: any) {
    return await __call('memorySave', { options: options });
  };
}

export { MemorySaveTool };

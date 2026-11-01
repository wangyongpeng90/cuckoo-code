import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 16,
    category: 'MCP',
    name: 'mcpCall',
    usage: '调用 MCP 工具时使用 mcpCall(server, tool, args)。使用前先通过 mcpListServers() 和 mcpGetTools() 查询可用能力。',
    doc: [
      '调用 MCP server 提供的工具。',
      '使用前先调用 mcpListServers() 和 mcpGetTools() 查询可用能力。',
    ].join('\n'),
    params: 'server: string, tool: string, args?: Record<string, unknown>',
    returns: 'Promise<string>',
    paramDocs: {
      server: 'MCP server 名称',
      tool: '要调用的工具名',
      args: '工具参数对象',
    },
    returnsDoc: '工具执行结果（纯文本）',
    throws: '连接失败、工具不存在或调用出错时抛出异常',
  },
];

/**
 * MCP 调用工具 - 让 AI 通过 mcpCall 调用外部 MCP server 的工具。
 */
class McpCallTool extends Tool {
  constructor() {
    super(
      'mcpCall',
      '调用 MCP server 提供的工具。传入 server 名称、工具名和参数。',
      {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'MCP server 名称' },
          tool: { type: 'string', description: '要调用的工具名' },
          args: { type: 'object', description: '工具参数对象' }
        },
        required: ['server', 'tool'],
        additionalProperties: false
      },
      'mcpCall(server, tool, args)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const { server, tool, args, projectDir, currentWindowId } = params;
    try {
      if (!server || typeof server !== 'string') {
        return ToolResult.error('server 不能为空');
      }
      if (!tool || typeof tool !== 'string') {
        return ToolResult.error('tool 不能为空');
      }
      const winId = typeof currentWindowId === 'number' ? currentWindowId : null;
      // 惰性加载 MCP client（避免 tools 模块加载期依赖 electron）
      const mcpClient = await import('../../mcp/client.js');
      const result = await mcpClient.callMcpTool(server, tool, args || {}, projectDir || null, winId);

      // 提取纯文本内容
      const content = result.content || [];
      let text = '';
      let hasNonText = false;
      for (const item of content) {
        if (item && item.type === 'text' && typeof item.text === 'string') {
          text += (text ? '\n' : '') + item.text;
        } else if (item) {
          hasNonText = true;
        }
      }

      if (result.isError) {
        // 错误友好化：把错误信息作为失败返回
        const errText = text || 'MCP 工具返回错误';
        return ToolResult.error(server + '.' + tool + ': ' + errText);
      }

      // 成功：返回纯文本，若有非文本内容则附带提示
      return ToolResult.success(text);
    } catch (err: any) {
      return ToolResult.error('MCP 调用失败: ' + (err.message || String(err)));
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.mcpCall。 */
export function bootstrap(__call: any): void {
  (globalThis as any).mcpCall = async function (server: any, tool: any, args: any) {
    return await __call('mcpCall', { server: server, tool: tool, args: args || {} });
  };
}

export { McpCallTool };

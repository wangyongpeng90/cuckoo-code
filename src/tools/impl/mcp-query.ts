import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 17,
    category: 'MCP',
    name: 'mcpListServers',
    doc: [
      '列出所有已配置的 MCP server（含启用状态、连接状态和工具数量）。',
      '使用 MCP 前先调用此函数查看当前可用 server。',
    ].join('\n'),
    usage: 'mcpListServers() 列出已配置的 MCP server（含启用/连接状态）。',
    params: '',
    returns: 'Promise<string>',
    returnsDoc: '纯文本 server 列表',
  },
  {
    order: 18,
    category: 'MCP',
    name: 'mcpGetTools',
    doc: [
      '查看指定 MCP server 提供的工具列表（含描述和参数）。',
      '确认工具能力后再调用 mcpCall。',
    ].join('\n'),
    usage: 'mcpGetTools(serverName) 查看指定 MCP server 的工具和参数。',
    params: 'serverName: string',
    returns: 'Promise<string>',
    paramDocs: {
      serverName: 'MCP server 名称',
    },
    returnsDoc: '纯文本工具列表',
    throws: 'server 不存在或连接失败时抛出异常',
  },
];

/**
 * MCP 查询工具 - 列出已配置的 MCP server
 */
class McpListServersTool extends Tool {
  constructor() {
    super(
      'mcpListServers',
      '列出所有已配置的 MCP server（含启用状态、连接状态和工具数量）',
      {
        type: 'object',
        properties: {},
        required: []
      },
      'mcpListServers()'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const projectDir = (params && params.projectDir) || null;
    const windowId = (params && typeof params.currentWindowId === 'number') ? params.currentWindowId : null;
    try {
      // 惰性加载 MCP client（避免 tools 模块加载期依赖 electron）
      const mcpClient = await import('../../mcp/client.js');
      const servers = mcpClient.listConfiguredServers(projectDir);
      if (servers.length === 0) {
        return ToolResult.success('当前没有配置任何 MCP server。');
      }
      const lines: string[] = [];
      for (const s of servers) {
        const status = !s.enabled ? '禁用' : (s.connected ? '已连接' : '未连接');
        lines.push('- ' + s.name + ' [' + (s.source || 'user') + '/' + s.type + '] ' + status + '，工具数: ' + s.toolCount);
        if (s.connected) {
          try {
            const serverTools = await mcpClient.getToolsByServer(s.name, projectDir, windowId);
            for (const t of serverTools) lines.push('  - ' + t.name);
          } catch (_) {}
        }
      }
      return ToolResult.success(lines.join('\n'));
    } catch (err: any) {
      return ToolResult.error('获取 MCP server 列表失败: ' + (err.message || String(err)));
    }
  }
}

/**
 * MCP 查询工具 - 查看指定 server 的工具列表
 */
class McpGetToolsTool extends Tool {
  constructor() {
    super(
      'mcpGetTools',
      '查看指定 MCP server 提供的工具列表（含描述和参数）',
      {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'MCP server 名称' }
        },
        required: ['server']
      },
      'mcpGetTools(serverName)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const { server, projectDir, currentWindowId } = params;
    if (!server || typeof server !== 'string') {
      return ToolResult.error('server 不能为空');
    }
    const winId = typeof currentWindowId === 'number' ? currentWindowId : null;
    try {
      // 惰性加载 MCP client（避免 tools 模块加载期依赖 electron）
      const mcpClient = await import('../../mcp/client.js');
      const tools = await mcpClient.getToolsByServer(server, projectDir || null, winId);
      if (tools.length === 0) {
        return ToolResult.success('server "' + server + '" 没有提供任何工具。');
      }
      const lines = tools.map((t: any) => {
        let line = '- **' + t.name + '**' + (t.description ? ' - ' + t.description : '');
        const schema = t.inputSchema && t.inputSchema.properties;
        if (schema && Object.keys(schema).length > 0) {
          const props = Object.entries(schema).map(([k, v]: [string, any]) => {
            return k + ': ' + (v.type || 'any') + (v.description ? ' (' + v.description + ')' : '');
          });
          line += '\n  args: ' + props.join(', ');
        }
        return line;
      });
      return ToolResult.success(server + ' 的工具列表：\n\n' + lines.join('\n'));
    } catch (err: any) {
      return ToolResult.error('获取 "' + server + '" 的工具列表失败: ' + (err.message || String(err)));
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.mcpListServers / globalThis.mcpGetTools。 */
export function bootstrap(__call: any): void {
  (globalThis as any).mcpListServers = async function () {
    return await __call('mcpListServers', {});
  };
  (globalThis as any).mcpGetTools = async function (serverName: any) {
    return await __call('mcpGetTools', { server: serverName });
  };
}

export { McpListServersTool, McpGetToolsTool };

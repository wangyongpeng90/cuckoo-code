/**
 * 工具库统一入口
 * 导出所有可用工具（主进程注册工具的唯一入口，与 src/main/tool-registry.js 配套）
 */
import { ToolRegistry } from './core/ToolRegistry.js';
import { JsRunner } from './runtime/JsRunner.js';
import { WriteTool } from './impl/write.js';
import { ReadTool } from './impl/read.js';
import { ReadLinesTool } from './impl/read-lines.js';
import { EditTool } from './impl/edit.js';
import { GlobToolNew } from './impl/glob.js';
import { GrepToolNew } from './impl/grep.js';
import { TodoWriteTool } from './impl/todo-write.js';
import { BashTool } from './impl/bash.js';
import { PwshTool } from './impl/pwsh.js';
import { DeleteFileTool } from './impl/delete-file.js';
import { WebFetchTool } from './impl/web-fetch.js';
import { MySQLTool } from './impl/mysql.js';
import { OpenBrowserWindowTool } from './impl/open-browser-window.js';
import { InjectJSTool } from './impl/inject-js.js';
import { AttachFileTool } from './impl/attach-file.js';
import { McpCallTool } from './impl/mcp-call.js';
import { McpListServersTool, McpGetToolsTool } from './impl/mcp-query.js';
import { RunAgentTool } from './impl/run-agent.js';

// 创建全局工具注册表
const registry = new ToolRegistry();

// 注册所有工具
registry.register(new WriteTool());
registry.register(new ReadTool());
registry.register(new ReadLinesTool());
registry.register(new EditTool());
registry.register(new GlobToolNew());
registry.register(new GrepToolNew());
registry.register(new TodoWriteTool());
registry.register(new BashTool());
registry.register(new PwshTool());
registry.register(new DeleteFileTool());
registry.register(new WebFetchTool());
registry.register(new MySQLTool());
registry.register(new OpenBrowserWindowTool());
registry.register(new InjectJSTool());
registry.register(new AttachFileTool());
registry.register(new McpCallTool());
registry.register(new McpListServersTool());
registry.register(new McpGetToolsTool());
registry.register(new RunAgentTool());

// JS 工具脚本执行器（单例：AI 生成的 JS 代码调用工具函数）
const jsRunner = new JsRunner(registry);

// 导出
export {
  ToolRegistry,
  JsRunner,
  registry,
  jsRunner,
  WriteTool,
  ReadLinesTool,
  EditTool,
  GlobToolNew,
  GrepToolNew,
  TodoWriteTool,
  BashTool,
  PwshTool,
  DeleteFileTool,
  WebFetchTool,
  // 便捷方法
  getAllTools,
  getToolDescriptions,
  getFormattedToolsForPrompt,
  executeTool
};

function getAllTools(): ToolRegistry { return registry; }
function getToolDescriptions(): any { return registry.getDescriptions(); }
function getFormattedToolsForPrompt(): string { return registry.getFormattedToolsForPrompt(); }
function executeTool(name: string, params: any): Promise<any> { return registry.execute(name, params); }

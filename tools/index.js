/**
 * 工具库统一入口
 * 导出所有可用工具（主进程注册工具的唯一入口，与 src/main/tool-registry.js 配套）
 */
const { ToolRegistry } = require('./ToolRegistry');
const { JsRunner } = require('./JsRunner');
const { FileWriteTool } = require('./FileWriteTool');
const { WriteTool } = require('./WriteTool');
const { FileReadTool } = require('./FileReadTool');
const { ReadTool } = require('./ReadTool');
const { ReadLinesTool } = require('./ReadLinesTool');
const { FileEditTool } = require('./FileEditTool');
const { EditTool } = require('./EditTool');
const { GlobTool } = require('./GlobTool');
const { GlobToolNew } = require('./GlobToolNew');
const { GrepTool } = require('./GrepTool');
const { GrepToolNew } = require('./GrepToolNew');
const { TodoWriteTool } = require('./TodoWriteTool');
const { BashTool } = require('./BashTool');
const { PwshTool } = require('./PwshTool');
const { FileDeleteTool } = require('./FileDeleteTool');
const { WebFetchTool } = require('./WebFetchTool');
const { MySQLTool } = require('./MySQLTool');
const { OpenBrowserWindowTool } = require('./OpenBrowserWindowTool');
const { InjectJSTool } = require('./InjectJSTool');
const { McpCallTool } = require('./McpCallTool');
const { McpListServersTool, McpGetToolsTool } = require('./McpQueryTools');
const { SkillListTool, SkillLoadTool, SkillExecuteTool } = require('./SkillTools');

// 创建全局工具注册表
const registry = new ToolRegistry();

// 注册所有工具
registry.register(new FileWriteTool());
registry.register(new WriteTool());
registry.register(new FileReadTool());
registry.register(new ReadTool());
registry.register(new ReadLinesTool());
registry.register(new FileEditTool());
registry.register(new EditTool());
registry.register(new GlobTool());
registry.register(new GlobToolNew());
registry.register(new GrepTool());
registry.register(new GrepToolNew());
registry.register(new TodoWriteTool());
registry.register(new BashTool());
registry.register(new PwshTool());
registry.register(new FileDeleteTool());
registry.register(new WebFetchTool());
registry.register(new MySQLTool());
registry.register(new OpenBrowserWindowTool());
registry.register(new InjectJSTool());
registry.register(new McpCallTool());
registry.register(new McpListServersTool());
registry.register(new McpGetToolsTool());
registry.register(new SkillListTool());
registry.register(new SkillLoadTool());
registry.register(new SkillExecuteTool());

// 导出
module.exports = {
  ToolRegistry,
  JsRunner,
  registry,
  FileWriteTool,
  WriteTool,
  FileReadTool,
  ReadLinesTool,
  FileEditTool,
  EditTool,
  GlobTool,
  GlobToolNew,
  GrepTool,
  GrepToolNew,
  TodoWriteTool,
  BashTool,
  PwshTool,
  FileDeleteTool,
  WebFetchTool,
  McpCallTool,
  McpListServersTool,
  McpGetToolsTool,
  SkillListTool,
  SkillLoadTool,
  SkillExecuteTool,
  // 便捷方法
  getAllTools: () => registry,
  getToolDescriptions: () => registry.getDescriptions(),
  getFormattedToolsForPrompt: () => registry.getFormattedToolsForPrompt(),
  executeTool: (name, params) => registry.execute(name, params)
};

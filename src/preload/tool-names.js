/**
 * preload 可识别的工具名称集合
 * 替代原 preload.js 内联的 UnifiedToolManager：preload 只负责校验 AI 回复中的
 * toolName 是否存在（原实现仅使用 tools.has()/keys()），实际执行由主进程工具
 * 注册表（tools/index.js）完成。列表与顺序保持与原内联注册表一致。
 */
const TOOL_NAMES = [
  'file_write',
  'write',
  'file_read',
  'read',
  'read_lines',
  'file_edit',
  'edit',
  'file_glob',
  'glob',
  'file_grep',
  'grep',
  'todo_write',
  'bash',
  'pwsh',
  'mysql',
  'web_fetch',
  'open_browser_window',
  'inject_js',
  'attach_file',
  'mcp_list_servers',
  'mcp_get_tools',
];

/** 判断工具名是否存在（原 toolManager.tools.has(name)） */
function hasTool(name) {
  return TOOL_NAMES.includes(name);
}

/** 工具名列表字符串（原 Array.from(toolManager.tools.keys()).join(', ')） */
function toolNamesList() {
  return TOOL_NAMES.join(', ');
}

module.exports = { TOOL_NAMES, hasTool, toolNamesList };

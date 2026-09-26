// 本文件由 scripts/build-tool-api.mjs 自动生成，请勿手动编辑。
// 真相源：各工具的 bootstrap 函数（src/tools/impl/*.ts）。
// JsRunner 用它组装沙箱注入脚本（工具函数的 globalThis 定义）。

const TOOL_BOOTSTRAP = [
  "  globalThis.attachFile = async function (filePath) {\n      return await __call('attachFile', { filePath: filePath });\n  };",
  "  globalThis.bash = async function (command, options) {\n      options = options || {};\n      return await __call('bash', {\n          command: command,\n          description: options.description,\n          workdir: options.workdir || options.cwd,\n          timeoutMs: options.timeoutMs || options.timeout,\n      });\n  };",
  "  globalThis.deleteFile = async function (filePath) {\n      return await __call('deleteFile', { filePath: filePath });\n  };",
  "  globalThis.edit = async function (filePath, oldString, newString, replaceAll, dryRun) {\n      return await __call('edit', {\n          filePath: filePath,\n          oldString: oldString,\n          newString: newString,\n          replaceAll: replaceAll === true,\n          dryRun: dryRun === true,\n      });\n  };",
  "  globalThis.glob = async function (pattern, searchPath) {\n      return await __call('glob', { pattern: pattern, path: searchPath });\n  };",
  "  globalThis.grep = async function (pattern, options) {\n      options = options || {};\n      return await __call('grep', {\n          pattern: pattern,\n          path: options.path,\n          include: options.include,\n      });\n  };",
  "  globalThis.injectJS = async function (windowId, code) {\n      return await __call('injectJS', { windowId: windowId, code: code });\n  };",
  "  globalThis.mcpCall = async function (server, tool, args) {\n      return await __call('mcpCall', { server: server, tool: tool, args: args || {} });\n  };",
  "  globalThis.mcpListServers = async function () {\n      return await __call('mcpListServers', {});\n  };\n  globalThis.mcpGetTools = async function (serverName) {\n      return await __call('mcpGetTools', { server: serverName });\n  };",
  "  globalThis.mysql = async function (options) {\n      options = options || {};\n      return await __call('mysql', options);\n  };",
  "  globalThis.openBrowserWindow = async function (url, options) {\n      options = options || {};\n      return await __call('openBrowserWindow', {\n          url: url,\n          id: options.id,\n          width: options.width,\n          height: options.height,\n      });\n  };",
  "  globalThis.pwsh = async function (command, options) {\n      options = options || {};\n      return await __call('pwsh', {\n          command: command,\n          description: options.description,\n          workdir: options.workdir || options.cwd,\n          timeoutMs: options.timeoutMs || options.timeout,\n      });\n  };",
  "  globalThis.readLines = async function (filePath, options) {\n      options = options || {};\n      return await __call('readLines', {\n          filePath: filePath,\n          offset: options.offset,\n          limit: options.limit,\n      });\n  };",
  "  globalThis.read = async function (filePath, options) {\n      options = options || {};\n      return await __call('read', {\n          filePath: filePath,\n          offset: options.offset,\n          limit: options.limit,\n      });\n  };",
  "  globalThis.runAgent = async function (name, task) {\n      return await __call('runAgent', { name, task });\n  };",
  "  globalThis.todoWrite = async function (todos) {\n      return await __call('todoWrite', { todos: todos });\n  };",
  "  globalThis.webFetch = async function (url) {\n      return await __call('webFetch', { url: url });\n  };",
  "  globalThis.write = async function (filePath, content) {\n      return await __call('write', { filePath: filePath, content: content });\n  };",
].join('\n');

export { TOOL_BOOTSTRAP };

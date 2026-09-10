/**
 * JsRunner - 在受限的 Node vm 沙箱中执行 AI 生成的 JavaScript 工具代码
 *
 * 设计要点：
 * - 通过 vm.createContext 创建沙箱，禁用字符串代码生成（eval / Function 构造器均被禁用）
 * - AI 代码无法访问 require / process / global 等 Node 能力，只能使用注入的工具函数
 * - 工具函数（readFile / readFileWithLines / writeFile / editFile / glob / grep / bash / deleteFile / log）
 *   通过唯一的 __hostBridge 桥接函数回到主进程执行，宿主函数从不向沙箱抛出宿主对象
 * - 每个工具调用都带执行截止时间检查，防止死循环；整体运行有 60 秒超时
 */

const vm = require('vm');
const { exec } = require('child_process');
const path = require('path');
const { DANGEROUS_CMDS } = require('./BashTool');
const { decodeOutput, normalizeCommand } = require('./decodeOutput');

// 同步执行超时（vm timeout，覆盖无 await 的死循环）
const SYNC_TIMEOUT = 30 * 1000;
// 整体运行截止时间（配合宿主桥接检查，覆盖 async 死循环）
const RUN_DEADLINE = 60 * 1000;
// 长时工具：自身具备独立超时机制（如 subagent 默认 30 分钟），
// 调用期间豁免 JsRunner 的整体 60s 超时（双闸门豁免）。
const LONG_RUNNING_TOOLS = new Set(['subagent']);
// 输出长度上限
const OUTPUT_LIMIT = 20000;

/**
 * 沙箱初始化脚本：在沙箱上下文内定义所有工具函数
 * 注意：该脚本运行在沙箱 realm 内，其抛出的 Error 也是沙箱 realm 对象，无逃逸风险
 */
const BOOTSTRAP = [
"'use strict';",
"(function () {",
"  globalThis.__logs = [];",
"",
"  function __stringify(value) {",
"    if (typeof value === 'string') return value;",
"    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }",
"  }",
"",
"  globalThis.log = function () {",
"    var parts = [];",
"    for (var i = 0; i < arguments.length; i++) parts.push(__stringify(arguments[i]));",
"    globalThis.__logs.push(parts.join(' '));",
"  };",
"",
"  globalThis.projectDir = __projectDir;",
"",
"  async function __call(name, args) {",
"    var resText = await __hostBridge(name, JSON.stringify(args == null ? {} : args));",
"    var res;",
"    try { res = JSON.parse(resText); } catch (e) { throw new Error('工具结果解析失败: ' + e.message); }",
"    if (!res || res.success !== true) {",
"      throw new Error((res && res.error) || ('工具 ' + name + ' 执行失败'));",
"    }",
"    return res.data;",
"  }",
"",
"  globalThis.readFile = async function (filePath, encoding) {",
"    return await __call('file_read', { file_path: filePath, encoding: encoding || 'utf-8' });",
"  };",
"  globalThis.readFileWithLines = async function (filePath, encoding) {",
"    return await __call('file_read', { file_path: filePath, encoding: encoding || 'utf-8', line_numbers: true });",
"  };",
"  globalThis.read = async function (filePath, options) {",
"    options = options || {};",
"    return await __call('read', {",
"      file_path: filePath,",
"      offset: options.offset,",
"      limit: options.limit",
"    });",
"  };",
"  globalThis.readLines = async function (filePath, options) {",
"    options = options || {};",
"    return await __call('read_lines', {",
"      file_path: filePath,",
"      offset: options.offset,",
"      limit: options.limit",
"    });",
"  };",
"  globalThis.write = async function (filePath, content) {",
"    return await __call('write', { file_path: filePath, content: content });",
"  };",
"  globalThis.writeFile = async function (filePath, content, encoding) {",
"    return await __call('file_write', { file_path: filePath, content: content, encoding: encoding || 'utf-8' });",
"  };",
"  globalThis.edit = async function (filePath, oldString, newString, replaceAll, dryRun) {",
"    return await __call('edit', { file_path: filePath, old_string: oldString, new_string: newString, replaceAll: replaceAll === true, dryRun: dryRun === true });",
"  };",
"  globalThis.editFile = async function (filePath, oldString, newString, replaceAll) {",
"    return await __call('file_edit', { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll === true });",
"  };",
"  globalThis.glob = async function (pattern, searchPath) {",
"    return await __call('glob', { pattern: pattern, path: searchPath });",
"  };",
"  globalThis.grep = async function (pattern, options) {",
"    options = options || {};",
"    return await __call('grep', {",
"      pattern: pattern,",
"      path: options.path,",
"      include: options.include",
"    });",
"  };",
"  globalThis.todoWrite = async function (todos) {",
"    return await __call('todo_write', { todos: todos });",
"  };",
"  globalThis.bash = async function (command, options) {",
"    options = options || {};",
"    return await __call('__bash', {",
"      command: command,",
"      description: options.description,",
"      workdir: options.workdir || options.cwd,",
"      timeoutMs: options.timeoutMs || options.timeout",
"    });",
"  };",
"  globalThis.pwsh = async function (command, options) {",
"    options = options || {};",
"    return await __call('pwsh', {",
"      command: command,",
"      description: options.description,",
"      workdir: options.workdir || options.cwd,",
"      timeoutMs: options.timeoutMs || options.timeout",
"    });",
"  };",
"  globalThis.deleteFile = async function (filePath) {",
"    return await __call('file_delete', { file_path: filePath });",
"  };",
"  globalThis.webFetch = async function (url) {",
"    return await __call('web_fetch', { url: url });",
"  };",
"  globalThis.mysql = async function (options) {",
"    options = options || {};",
"    return await __call('mysql', options);",
"  };",
"  globalThis.mcpCall = async function (server, tool, args) {",
"    return await __call('mcp_call', { server: server, tool: tool, args: args || {} });",
"  };",
  "  globalThis.mcpListServers = async function () {",
  "    return await __call('mcp_list_servers', {});",
  "  };",
  "  globalThis.mcpGetTools = async function (serverName) {",
  "    return await __call('mcp_get_tools', { server: serverName });",
  "  };",
"  globalThis.openBrowserWindow = async function (url, options) {",
"    options = options || {};",
"    return await __call('open_browser_window', {",
"      url: url,",
"      id: options.id,",
"      width: options.width,",
"      height: options.height",
"    });",
"  };",
"  globalThis.injectJS = async function (windowId, code) {",
"    return await __call('inject_js', { windowId: windowId, code: code });",
"  };",
"  globalThis.subagent = async function (options) {",
"    options = options || {};",
"    return await __call('subagent', {",
"      agentType: options.agentType,",
"      task: options.task,",
"      timeoutMs: options.timeoutMs",
"    });",
"  };",
"",
"  if (!globalThis.projectDir) {",
"    globalThis.log('[提示] 尚未初始化项目目录，相对路径将基于系统目录解析。可点击覆盖层“初始化项目”。');",
"  }",
"})();",
"",
].join('\n');

/**
 * 解析命令工作目录（相对路径基于项目目录）
 */
function resolveDir(dir, projectDir) {
  if (!dir) return projectDir || process.env.USERPROFILE || path.resolve('.');
  const normalized = String(dir).replace(/\//g, path.sep);
  if (path.isAbsolute(normalized)) return normalized;
  if (projectDir) return path.join(projectDir, normalized);
  return path.resolve(normalized);
}

/**
 * 执行 shell 命令（JS API 专用实现）
 * 与 JSON 工具的 bash 不同：非零退出码不视为失败，而是通过 exitCode/error 字段返回，
 * 让 AI 代码可以像普通 shell 一样判断结果。
 */
function runBash(args, projectDir) {
  const command = normalizeCommand(String(args.command || '').trim());
  if (!command) return Promise.resolve({ success: false, error: 'invalid command: expected a non-empty string' });
  if (DANGEROUS_CMDS.some((pattern) => pattern.test(command))) {
    return Promise.resolve({ success: false, error: '命令被安全策略拒绝（危险命令）: ' + command });
  }
  const timeout = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : 30000;
  const cwd = resolveDir(args.workdir || args.cwd, projectDir);

  return new Promise((resolve) => {
    exec(command, { cwd, timeout, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
      const out = decodeOutput(stdout);
      const err = decodeOutput(stderr);

      // dsh 风格渲染：stdout + [stderr] 分节 + 状态标记
      let body = out;
      if (err && err.length > 0) {
        if (body.length > 0 && !body.endsWith('\n')) body += '\n';
        body += '[stderr]\n' + err;
      }
      if (body.length === 0) body = '(no output)';

      const markers = [];
      if (error) {
        if (error.killed) {
          markers.push('[timed out after ' + timeout + 'ms]');
        } else if (typeof error.code === 'number') {
          markers.push('[exit code: ' + error.code + ']');
        } else {
          markers.push('[exit code: 1]');
        }
      }

      if (markers.length > 0) {
        if (!body.endsWith('\n')) body += '\n';
        body += markers.join('\n');
      }

      // 非零退出也正常返回（success:true），模型看到标记自行判断
      resolve({ success: true, data: body });
    });
  });
}

/**
 * 安全的 JSON 序列化（处理循环引用等异常）
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    try {
      return String(value);
    } catch (e2) {
      return '[无法序列化的返回值]';
    }
  }
}

class JsRunner {
  /**
   * @param {import('./ToolRegistry').ToolRegistry} registry 工具注册表
   */
  constructor(registry, options = {}) {
    this.registry = registry;
    // 可注入的整体运行截止时间（测试用），默认 60s
    this.runDeadlineMs = typeof options.runDeadlineMs === 'number' && options.runDeadlineMs > 0
      ? options.runDeadlineMs
      : RUN_DEADLINE;
  }

  /**
   * 执行 AI 生成的 JS 工具代码
   * @param {string} code - AI 生成的 JavaScript 代码（无需函数包裹，支持顶层 await）
   * @param {string|null} projectDir - 当前项目目录（相对路径基准）
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  async run(code, projectDir) {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return { success: false, error: '无效的 JS 代码' };
    }

    let startTime = Date.now();
    const deadlineMs = this.runDeadlineMs;
    let settleTimer = null;
    let timeoutReject = null;

    // 唯一跨域桥接函数：AI 代码中的每个工具调用都通过它回到主进程执行。
    // 注意：该函数绝不向沙箱抛出宿主对象（错误一律包装成 { success:false, error } 结果），
    // 避免沙箱内出现宿主 realm 的 Error / Function 逃逸通道。
    const hostBridge = async (op, argsJson) => {
      // 长时工具豁免：调用前挂起整体超时定时器，返回后重置计时基准并重启
      const isLongRunning = LONG_RUNNING_TOOLS.has(op);
      if (isLongRunning && settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }

      if (Date.now() - startTime > deadlineMs) {
        return JSON.stringify({ success: false, error: 'JS 脚本执行超时（' + Math.round(deadlineMs / 1000) + ' 秒）' });
      }
      let args = {};
      try {
        args = JSON.parse(argsJson || '{}');
      } catch (e) {
        args = {};
      }

      let result;
      if (op === '__bash') {
        result = await runBash(args, projectDir);
      } else {
        const tool = this.registry.get(op);
        if (!tool) {
          result = { success: false, error: '未知工具: ' + op };
        } else {
          try {
            result = await tool.execute(Object.assign({}, args, { projectDir }));
          } catch (err) {
            result = { success: false, error: '工具 ' + op + ' 执行异常: ' + (err.message || String(err)) };
          }
        }
      }

      // 长时工具返回：重置超时基准，并重启整体超时定时器（配对）
      if (isLongRunning) {
        startTime = Date.now();
        if (timeoutReject) {
          settleTimer = setTimeout(
            () => timeoutReject(new Error('JS 脚本执行超时（' + Math.round(deadlineMs / 1000) + ' 秒）')),
            deadlineMs
          );
        }
      }

      return JSON.stringify(result);
    };

    // ========== 沙箱构建与加固 ==========
    const sandbox = {};
    Object.defineProperty(sandbox, '__hostBridge', {
      value: hostBridge, enumerable: true, writable: false, configurable: false,
    });
    Object.defineProperty(sandbox, '__projectDir', {
      value: projectDir || null, enumerable: true, writable: false, configurable: false,
    });
    // 截断沙箱对象与桥接函数的原型链，阻止经 constructor/__proto__ 逃逸到宿主 realm
    try { Object.setPrototypeOf(sandbox, null); } catch (e) { /* 尽力而为 */ }
    try { Object.setPrototypeOf(hostBridge, null); } catch (e) { /* 尽力而为 */ }

    let context;
    try {
      context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
        name: 'cuckoo-js-sandbox',
      });
    } catch (err) {
      // 兜底：极少数环境下 null 原型沙箱不可用
      const fallback = {};
      fallback.__hostBridge = hostBridge;
      fallback.__projectDir = projectDir || null;
      context = vm.createContext(fallback, {
        codeGeneration: { strings: false, wasm: false },
        name: 'cuckoo-js-sandbox',
      });
    }

    try {
      vm.runInContext(BOOTSTRAP, context, { filename: 'cuckoo-js-api.js' });
    } catch (err) {
      return { success: false, error: '沙箱初始化失败: ' + (err.message || String(err)) };
    }

    // 包装为 async IIFE：支持顶层 await、return 返回值
    const script = new vm.Script('(async () => {\n' + code + '\n})()', { filename: 'cuckoo-js-tool-script.js' });

    try {
      const deadline = new Promise((_resolve, reject) => {
        timeoutReject = reject;
        settleTimer = setTimeout(
          () => reject(new Error('JS 脚本执行超时（' + Math.round(deadlineMs / 1000) + ' 秒）')),
          deadlineMs
        );
      });

      const ret = await Promise.race([script.runInContext(context, { timeout: SYNC_TIMEOUT }), deadline]);

      // 收集 log() 输出
      let logs = [];
      try {
        const logsJson = vm.runInContext('JSON.stringify(globalThis.__logs || [])', context);
        logs = JSON.parse(logsJson);
      } catch (e) { /* 忽略日志收集失败 */ }

      const parts = [];
      if (Array.isArray(logs) && logs.length > 0) {
        parts.push(logs.join('\n'));
      }
      if (ret !== undefined && ret !== null) {
        parts.push(typeof ret === 'string' ? ret : safeStringify(ret));
      }

      let output = parts.filter(Boolean).join('\n\n');
      if (output.length > OUTPUT_LIMIT) {
        output = output.slice(0, OUTPUT_LIMIT) + '\n...[输出过长已截断]...';
      }

      return { success: true, output: output || '(脚本执行完成，无输出)\n如需输出请使用 log() 方法' };
    } catch (err) {
      console.error('[JsRunner] 脚本执行失败:', err && err.stack ? err.stack : String(err));
      console.error('[JsRunner] [诊断] 失败代码(JSON转义): ' + JSON.stringify(code));
      return { success: false, error: err && err.message ? err.message : String(err) };
    } finally {
      if (settleTimer) clearTimeout(settleTimer);
    }
  }
}

module.exports = { JsRunner };

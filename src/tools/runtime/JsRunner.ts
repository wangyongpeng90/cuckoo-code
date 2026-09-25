/**
 * JsRunner - 在受限的 Node vm 沙箱中执行 AI 生成的 JavaScript 工具代码
 *
 * 设计要点：
 * - 通过 vm.createContext 创建沙箱，禁用字符串代码生成（eval / Function 构造器均被禁用）
 * - AI 代码无法访问 require / process / global 等 Node 能力，只能使用注入的工具函数
 * - 工具函数（read / readLines / write / edit / glob / grep / bash / deleteFile / log）
 *   通过唯一的 __hostBridge 桥接函数回到主进程执行，宿主函数从不向沙箱抛出宿主对象
 * - 每个工具调用都带执行截止时间检查，防止死循环；整体运行有 60 秒超时
 */

import vm from 'node:vm';
import { TOOL_BOOTSTRAP } from './bootstrap.generated.js';
import { logRun, ToolFailure } from '../../infra/tool-error-log.js';

// 同步执行超时（vm timeout，覆盖无 await 的死循环）
const SYNC_TIMEOUT = 30 * 1000;
// 整体运行截止时间（配合宿主桥接检查，覆盖 async 死循环）
const RUN_DEADLINE = 60 * 1000;
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
TOOL_BOOTSTRAP,
"",
"  if (!globalThis.projectDir) {",
"    globalThis.log('[提示] 尚未初始化项目目录，相对路径将基于系统目录解析。可点击覆盖层“初始化项目”。');",
"  }",
"})();",
"",
].join('\n');

/**
 * 安全的 JSON 序列化（处理循环引用等异常）
 */
function safeStringify(value: any): string {
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
  registry: any;

  /**
   * @param registry 工具注册表
   */
  constructor(registry: any) {
    this.registry = registry;
  }

  /**
   * 执行 AI 生成的 JS 工具代码
   * @param {string} code - AI 生成的 JavaScript 代码（无需函数包裹，支持顶层 await）
   * @param {string|null} projectDir - 当前项目目录（相对路径基准）
   * @param {number|null} windowId - 当前对话窗口 id（attachFile 等需要窗口上下文的工具使用）
   * @param {object} [settings] - 附加设置（attachDelayMin/attachDelayMax 等），透传给工具
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  async run(code: any, projectDir: any, windowId: any, settings: any): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return { success: false, error: '无效的 JS 代码' };
    }

    const startTime = Date.now();
    const deadlineMs = RUN_DEADLINE;
    // 收集本次脚本里"工具级失败"（供开发版错误日志）
    const toolFailures: ToolFailure[] = [];

    // 唯一跨域桥接函数：AI 代码中的每个工具调用都通过它回到主进程执行。
    // 注意：该函数绝不向沙箱抛出宿主对象（错误一律包装成 { success:false, error } 结果），
    // 避免沙箱内出现宿主 realm 的 Error / Function 逃逸通道。
    const hostBridge = async (op: any, argsJson: any) => {
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
      const tool = this.registry.get(op);
      if (!tool) {
        result = { success: false, error: '未知工具: ' + op };
        toolFailures.push({ tool: op || 'unknown', args: args, error: result.error });
      } else {
        try {
          result = await tool.execute(Object.assign({}, settings || {}, args, { projectDir, currentWindowId: windowId }));
          if (result && result.success === false) {
            toolFailures.push({ tool: op, args: args, error: result.error || '未知错误' });
          }
        } catch (err: any) {
          result = { success: false, error: '工具 ' + op + ' 执行异常: ' + (err.message || String(err)) };
          toolFailures.push({ tool: op, args: args, error: result.error });
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

    let context: any;
    try {
      context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
        name: 'cuckoo-js-sandbox',
      });
    } catch (err) {
      // 兜底：极少数环境下 null 原型沙箱不可用
      const fallback: any = {};
      fallback.__hostBridge = hostBridge;
      fallback.__projectDir = projectDir || null;
      context = vm.createContext(fallback, {
        codeGeneration: { strings: false, wasm: false },
        name: 'cuckoo-js-sandbox',
      });
    }

    try {
      vm.runInContext(BOOTSTRAP, context, { filename: 'cuckoo-js-api.js' });
    } catch (err: any) {
      return { success: false, error: '沙箱初始化失败: ' + (err.message || String(err)) };
    }

    // 包装为 async IIFE：支持顶层 await、return 返回值
    const script = new vm.Script('(async () => {\n' + code + '\n})()', { filename: 'cuckoo-js-tool-script.js' });

    let settleTimer: any = null;
    try {
      const deadline = new Promise((_resolve, reject) => {
        settleTimer = setTimeout(
          () => reject(new Error('JS 脚本执行超时（' + Math.round(deadlineMs / 1000) + ' 秒）')),
          deadlineMs
        );
      });

      const ret = await Promise.race([script.runInContext(context, { timeout: SYNC_TIMEOUT }), deadline]);

      // 收集 log() 输出
      let logs: any[] = [];
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

      // 开发版：记录本次脚本里所有工具级失败（无工具失败则不写）
      logRun(code, toolFailures, null, { projectDir: projectDir || '(未设置)', windowId: windowId, 耗时ms: Date.now() - startTime });
      return { success: true, output: output || '(脚本执行完成，无输出)\n如需输出请使用 log() 方法' };
    } catch (err: any) {
      console.error('[JsRunner] 脚本执行失败:', err && err.stack ? err.stack : String(err));
      console.error('[JsRunner] [诊断] 失败代码(JSON转义): ' + JSON.stringify(code));
      // 开发版：脚本级失败 + 已收集的工具级失败，一并写日志
      logRun(code, toolFailures, err && err.message ? err.message : String(err), { projectDir: projectDir || '(未设置)', windowId: windowId, 耗时ms: Date.now() - startTime });
      return { success: false, error: err && err.message ? err.message : String(err) };
    } finally {
      if (settleTimer) clearTimeout(settleTimer);
    }
  }
}

export { JsRunner };




import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { exec } from 'node:child_process';
import path from 'node:path';
import { decodeOutput, normalizeCommand } from '../../infra/decode-output.js';
import { isDangerous, DANGEROUS_CMDS } from '../../infra/dangerous-commands.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 7,
    category: '命令执行',
    name: 'bash',
    types: [
      '/** bash 的选项 */',
      'interface BashOptions {',
      '  /** 命令用途说明（清晰、简洁、主动语态，5-10 词） */',
      '  description?: string;',
      '  /** 工作目录（相对路径基于项目根目录），默认项目根目录 */',
      '  workdir?: string;',
      '  /** 超时毫秒数，默认 30000 */',
      '  timeoutMs?: number;',
      '}',
    ].join('\n'),
    doc: [
      '执行 shell 命令（Windows 使用 cmd.exe；Linux/macOS 使用系统默认 shell，通常为 /bin/sh 或 bash）。',
      '返回纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）。',
      '必须用 log() 方法打印才能看到返回内容。',
      '非零退出不抛异常，通过 [exit code] 标记报告。',
      '危险命令会被安全策略拒绝并抛异常。',
    ].join('\n'),
    params: 'command: string, options?: BashOptions',
    returns: 'Promise<string>',
    paramDocs: {
      command: '要执行的 shell 命令',
      options: '可选，{ description?: string, workdir?: string, timeoutMs?: number }',
    },
    returnsDoc: '纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）',
    throws: '危险命令被安全策略拒绝时抛出异常',
  },
];

/**
 * JsRunner 沙箱注入：定义 globalThis.bash。
 * 源码经 scripts/build-tool-api.mjs 提取（.toString()），组装进 JsRunner 的 BOOTSTRAP。
 * 必须在沙箱内自包含（只能引用 __call）。
 */
export function bootstrap(__call: any): void {
  (globalThis as any).bash = async function (command: any, options: any) {
    options = options || {};
    return await __call('bash', {
      command: command,
      description: options.description,
      workdir: options.workdir || options.cwd,
      timeoutMs: options.timeoutMs || options.timeout,
    });
  };
}

/**
 * Bash 执行工具 - 最小移植 dsh 风格。
 * 非零退出正常返回，附 [exit code] 标记；输出纯文本。
 */
class BashTool extends Tool {
  constructor() {
    super(
      'bash', '执行 bash 命令。非零退出以 [exit code] 标记返回，不视为错误。',
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 shell 命令'
          },
          description: {
            type: 'string',
            description: '命令用途说明'
          },
          workdir: {
            type: 'string',
            description: '工作目录（相对路径基于项目根目录），默认项目根目录'
          },
          timeoutMs: {
            type: 'number',
            description: '超时毫秒数，默认 30000',
            default: 30000
          }
        },
        required: ['command'],
        additionalProperties: false
      },
      'bash(command, options?)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:bash',
      order: 105,
      text: '执行 shell 命令并返回 stdout/stderr（Windows 用 cmd.exe；Linux/macOS 用系统 shell）。每次调用在全新 shell 中运行：状态（cwd、变量、函数）不会跨调用保留——请用 workdir 参数而非 cd。非零退出以 [exit code: N] 标记报告。长输出会截断为尾部。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { command, description, workdir, timeoutMs, projectDir } = params;

    try {
      if (!command || typeof command !== 'string') {
        return ToolResult.error('invalid command: expected a non-empty string');
      }

      const trimmed = normalizeCommand(command.trim());
      if (!trimmed) {
        return ToolResult.error('invalid command: expected a non-empty string');
      }

      // 危险命令检查（统一检测：按 shell 控制符分段逐段匹配）
      if (isDangerous(trimmed)) {
        return ToolResult.error('命令被安全策略拒绝（危险命令）: ' + trimmed);
      }

      // 确定工作目录
      let workDir: string;
      if (workdir) {
        const normalized = workdir.replace(/\//g, path.sep);
        workDir = path.isAbsolute(normalized)
          ? normalized
          : (projectDir ? path.join(projectDir, normalized) : path.resolve(normalized));
      } else if (projectDir) {
        workDir = projectDir;
      } else {
        workDir = process.env.HOME || process.env.USERPROFILE || (process.platform === 'win32' ? 'C:\\' : '/');
      }

      const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 30000;

      console.log('[BashTool] 执行命令: ' + trimmed + ', cwd=' + workDir);

      return await new Promise<ToolResult>((resolve) => {
        exec(
          trimmed,
          { cwd: workDir, timeout, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'buffer' },
          (error, stdout, stderr) => {
            const out = decodeOutput(stdout);
            const err = decodeOutput(stderr);

            // dsh 风格渲染
            let body = out;
            if (err && err.length > 0) {
              if (body.length > 0 && !body.endsWith('\n')) body += '\n';
              body += '[stderr]\n' + err;
            }
            if (body.length === 0) body = '(no output)';

            const markers: string[] = [];
            if (error) {
              if ((error as any).killed) {
                markers.push('[timed out after ' + timeout + 'ms]');
              } else if (typeof (error as any).code === 'number') {
                markers.push('[exit code: ' + (error as any).code + ']');
              } else {
                markers.push('[exit code: 1]');
              }
            }

            if (markers.length > 0) {
              if (!body.endsWith('\n')) body += '\n';
              body += markers.join('\n');
            }

            resolve(ToolResult.success(body));
          }
        );
      });
    } catch (err: any) {
      return ToolResult.error('命令执行异常: ' + err.message);
    }
  }
}

export { BashTool, DANGEROUS_CMDS };

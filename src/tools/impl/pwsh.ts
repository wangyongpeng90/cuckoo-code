import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { decodeOutput } from '../../infra/decode-output.js';
import { isDangerous, DANGEROUS_CMDS } from '../../infra/dangerous-commands.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 8,
    category: '命令执行',
    name: 'pwsh',
    types: [
      '/** pwsh 的选项 */',
      'interface PwshOptions {',
      '  /** 命令用途说明（清晰、简洁、主动语态，5-10 词） */',
      '  description?: string;',
      '  /** 工作目录（相对路径基于项目根目录），默认项目根目录 */',
      '  workdir?: string;',
      '  /** 超时毫秒数，默认 30000 */',
      '  timeoutMs?: number;',
      '}',
    ].join('\n'),
    doc: [
      '执行命令行命令。Windows 上用 PowerShell（powershell -NoProfile -Command）；Linux/macOS 上用 bash（bash -lc）。',
      '返回纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）。',
      '必须用 log() 方法打印才能看到返回内容。',
      '非零退出不抛异常，通过 [exit code] 标记报告。',
      '危险命令会被安全策略拒绝并抛异常。',
    ].join('\n'),
    params: 'command: string, options?: PwshOptions',
    returns: 'Promise<string>',
    paramDocs: {
      command: '要执行的 PowerShell 命令',
      options: '可选，{ description?: string, workdir?: string, timeoutMs?: number }',
    },
    returnsDoc: '纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）',
    throws: '危险命令被安全策略拒绝时抛出异常',
  },
];

// 危险命令列表统一由 infra/dangerous-commands 提供（含 PowerShell 特有项）。
// 保留本别名仅为向后兼容既有引用；请勿在此另立一份列表。
const DANGEROUS_PWSH_CMDS = DANGEROUS_CMDS;

/**
 * pwsh 执行工具 - 仿照 dsh 的 pwsh 最小移植。
 * 使用 powershell -NoProfile -Command 执行命令。
 * 非零退出正常返回，附 [exit code] 标记；输出纯文本。
 */
class PwshTool extends Tool {
  constructor() {
    super(
      'pwsh',
      '执行命令行命令（Windows 用 PowerShell；Linux/macOS 用 bash）。非零退出以 [exit code] 标记返回，不视为错误。',
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 PowerShell 命令'
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
      'pwsh(command, options?)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:pwsh',
      order: 106,
      text: '执行命令行命令并返回 stdout/stderr（Windows 用 PowerShell 的 powershell -NoProfile -Command；Linux/macOS 用 bash -lc，语法按对应平台写：Windows 用 $env:NAME，Unix 用 $NAME）。每次调用在全新 shell 进程中运行：状态不会跨调用保留——请用 workdir 参数而非 cd。非零退出以 [exit code: N] 标记报告。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { command, description, workdir, timeoutMs, projectDir } = params;

    try {
      if (!command || typeof command !== 'string') {
        return ToolResult.error('invalid command: expected a non-empty string');
      }

      const trimmed = command.trim();
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

      console.log('[PwshTool] 执行命令: ' + trimmed + ', cwd=' + workDir);

      // 非 Windows（Linux/macOS）无 PowerShell：用系统 bash 执行等价命令，
      // 保持返回格式一致（stdout + [stderr] + [exit code]/[timed out]）。
      const isWin = process.platform === 'win32';
      const shellCmd = isWin ? 'powershell' : 'bash';
      const shellArgs = isWin ? ['-NoProfile', '-Command', trimmed] : ['-lc', trimmed];

      return await new Promise<ToolResult>((resolve) => {
        execFile(
          shellCmd,
          shellArgs,
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

/** JsRunner 沙箱注入：定义 globalThis.pwsh。 */
export function bootstrap(__call: any): void {
  (globalThis as any).pwsh = async function (command: any, options: any) {
    options = options || {};
    return await __call('pwsh', {
      command: command,
      description: options.description,
      workdir: options.workdir || options.cwd,
      timeoutMs: options.timeoutMs || options.timeout,
    });
  };
}

export { PwshTool, DANGEROUS_PWSH_CMDS };

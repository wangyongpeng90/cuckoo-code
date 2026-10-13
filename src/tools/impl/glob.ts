import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 5,
    category: '搜索',
    name: 'glob',
    doc: [
      '按 glob 模式查找文件路径，返回纯文本路径列表（以 / 分隔，如 "src/utils/a.js"）。',
      '使用 ripgrep，包含隐藏文件和已忽略文件；未指定 path 时默认排除 VCS 元数据目录（.git 等）与常见产物目录（node_modules、dist、out、build 等）。',
      'glob 语法：* 匹配单层内任意字符，** 匹配任意层级目录，? 匹配单个字符。',
      '结果包含 footer：未超限时 "(Found N files)"，超限时 "(Showing M of N paths...)"。',
    ].join('\n'),
    params: 'pattern: string, searchPath?: string',
    returns: 'Promise<string>',
    paramDocs: {
      pattern: 'glob 匹配模式，如 src 下所有 .js / .ts，或 *.json',
      searchPath: '搜索起始目录（相对路径），默认项目根目录',
    },
    throws: 'pattern 为空、搜索目录不存在或不是目录时抛出异常',
  },
];

// @vscode/ripgrep 是 ES Module，CommonJS 里不能用 require() 同步加载；
// 改为惰性动态 import()，只在首次执行 ripgrep 时解析一次。
let rgPathPromise: Promise<string> | null = null;
function getRgPath(): Promise<string> {
  if (!rgPathPromise) {
    rgPathPromise = import('@vscode/ripgrep').then(m => {
      // 打包后 @vscode/ripgrep 返回的路径在 app.asar 内，Windows 无法 spawn；
      // 通过 asarUnpack 解包到 app.asar.unpacked，这里做路径替换。
      let p = m.rgPath;
      if (p && p.includes('app.asar' + path.sep)) {
        p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      }
      return p;
    });
  }
  return rgPathPromise;
}

// 对齐 dsh GLOB_MAX_RESULTS
const MAX_RESULTS = 100;

// 对齐 dsh GLOB_VCS_EXCLUDES：ripgrep 不得进入的 VCS 元数据目录
const GLOB_VCS_EXCLUDES = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'];

// 常见产物/依赖目录：未显式指定 path 时默认排除，避免 node_modules 等
// 淹没项目自身文件（实测某仓库 **/*.ts 命中 1832 个，其中 1680 个在 node_modules）。
// 显式传 path 时不排除，尊重用户明确的搜索意图。
const GLOB_ARTIFACT_EXCLUDES = [
  'node_modules', 'dist', 'out', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', 'vendor',
];

/**
 * 对齐 dsh parseGlobArgs
 */
function parseGlobArgs(pattern: any, searchPath: any): { pattern: string; path?: string } {
  if (typeof pattern !== 'string' || pattern.trim().length === 0) {
    throw new Error('pattern must be a non-empty string');
  }
  // 空字符串 / 空白 / null 都视为"未提供"（用默认项目根），避免 AI 传空串时误报错
  if (searchPath !== undefined && searchPath !== null) {
    if (typeof searchPath !== 'string') {
      throw new Error('path must be a string when given');
    }
    if (searchPath.trim().length === 0) {
      return { pattern };
    }
    return { pattern, path: searchPath };
  }
  return { pattern };
}

/**
 * 对齐 dsh buildGlobCommand：构造 ripgrep --files argv。
 * 每个模型参数都是纯 argv 元素，无 shell 层。
 */
function buildGlobArgs(input: { pattern: string; path?: string }): string[] {
  const parts = [
    '--files',
    '--glob=' + input.pattern,
    '--no-ignore',
    '--hidden',
    ...GLOB_VCS_EXCLUDES.flatMap(name => [
      '--glob=!**/' + name,
      '--glob=!**/' + name + '/**',
    ]),
  ];
  // 仅在未显式指定 path 时排除产物目录；给了 path 说明用户明确要搜那里
  if (input.path === undefined) {
    for (const name of GLOB_ARTIFACT_EXCLUDES) {
      parts.push('--glob=!**/' + name, '--glob=!**/' + name + '/**');
    }
  }
  if (input.path !== undefined) parts.push('--', input.path);
  return parts;
}

/**
 * 执行 ripgrep，返回 stdout 字符串。
 */
async function runRipgrep(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const rgPath = await getRgPath();
  return new Promise((resolve, reject) => {
    // --no-config：与 grep 工具保持一致，避免用户 RIPGREP_CONFIG_PATH
    // 干扰 glob 结果（如自定义忽略规则/输出格式）
    const child = spawn(rgPath, ['--no-config', ...args], {
      cwd,
      windowsHide: true,
    });
    // 收集 Buffer 统一解码：按块 string += 会在 64KB 边界切断多字节
    // 字符（CJK/emoji 文件名）产生乱码（U+FFFD）
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => { stdoutChunks.push(d); });
    child.stderr.on('data', (d: Buffer) => { stderrChunks.push(d); });
    child.on('error', reject);
    child.on('close', code => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      // code 0 表示成功，code 1 表示无匹配
      if (code === 0 || code === 1) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(stderr.trim() || ('ripgrep exited with code ' + code)));
      }
    });
  });
}

/**
 * 检查 baseDir 下哪些"被默认忽略的产物目录"真实存在。
 * 返回提醒文案（无则空串），供 AI 知道"有目录被忽略、可显式传 path 搜索"。
 */
function buildIgnoreNote(baseDir: string): string {
  const existing = GLOB_ARTIFACT_EXCLUDES.filter((name) => {
    try {
      const p = path.join(baseDir, name);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch (_) { return false; }
  });
  if (existing.length === 0) return '';
  return '(Note: 以下目录存在但已被默认忽略：' + existing.join('、') +
    '。如需搜索这些目录，请显式传 path 参数指定该目录。)';
}

/**
 * 对齐 dsh formatGlobOutput：纯文本路径列表 + footer
 */
function formatGlobOutput(items: string[], seen: number, truncated: boolean): string {
  const body = items.join('\n');
  const footer = truncated
    ? '(Showing ' + items.length + ' of ' + seen + ' paths. Narrow pattern or path to see more.)'
    : '(Found ' + seen + ' files)';
  return body + '\n\n' + footer;
}

/**
 * glob 工具 - 仿照 dsh 的 glob。
 * 使用 ripgrep 搜索文件路径，返回匹配的文件路径列表。
 */
class GlobToolNew extends Tool {
  constructor() {
    super(
      'glob',
      '按 glob 模式查找文件路径。返回匹配的文件路径（不含目录），包括隐藏文件与已忽略文件。',
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'glob 匹配模式，如 **/*.js、src/**/*.ts、*.json'
          },
          path: {
            type: 'string',
            description: '搜索起始目录（相对路径基于项目根目录），默认项目根目录'
          }
        },
        required: ['pattern'],
        additionalProperties: false
      },
      'glob(pattern, searchPath?)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:glob',
      order: 103,
      text: '使用 glob 工具（而不是 shell find）按路径模式查找文件。不含 "/" 的模式匹配任意深度的 basename，所以 "*" 匹配树中所有文件而非仅顶层。结果只包含文件，永不包含目录，且包含隐藏和已忽略文件。默认排除 node_modules、dist 等产物目录；若确需搜索这些目录，请显式传 path。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { pattern, path: searchPath, projectDir } = params;

    try {
      const input = parseGlobArgs(pattern, searchPath);

      // 确定搜索目标：
      // - 有 path：如果 path 是绝对路径，搜索目标就是 path；否则 path 是相对于 projectDir 的子路径
      // - 无 path：搜索目标是 projectDir 或当前目录
      let searchTarget: string;
      let baseDir: string; // ripgrep cwd
      if (input.path) {
        if (path.isAbsolute(input.path)) {
          searchTarget = input.path.replace(/\\/g, '/');
          baseDir = input.path;
        } else if (projectDir) {
          searchTarget = input.path.replace(/\\/g, '/');
          baseDir = projectDir;
        } else {
          searchTarget = input.path.replace(/\\/g, '/');
          baseDir = path.resolve('.');
        }
      } else if (projectDir) {
        searchTarget = '.';
        baseDir = projectDir;
      } else {
        searchTarget = '.';
        baseDir = path.resolve('.');
      }

      // 检查搜索目标是否存在，类型是否为目录
      const targetAbs = path.isAbsolute(searchTarget) ? searchTarget : path.join(baseDir, searchTarget);
      if (!fs.existsSync(targetAbs)) {
        return ToolResult.error('搜索路径不存在: ' + targetAbs);
      }
      if (!fs.statSync(targetAbs).isDirectory()) {
        return ToolResult.error('搜索路径不是目录: ' + targetAbs);
      }

      const args = buildGlobArgs(input);
      const { stdout } = await runRipgrep(args, baseDir);

      // 未指定 path 时，检查哪些被忽略的产物目录"真实存在"——提醒 AI 别误判"文件不存在"
      const ignoreNote = input.path ? '' : buildIgnoreNote(baseDir);

      // 解析路径并按字母序排序（保持 cuckoo 现状）
      const allResults = stdout
        .split(/\r?\n/)
        .map((p: string) => p.replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter((p: string) => p.length > 0)
        .sort((a: string, b: string) => a.localeCompare(b));

      const truncated = allResults.length > MAX_RESULTS;
      const items = truncated ? allResults.slice(0, MAX_RESULTS) : allResults;

      console.log('[GlobTool] 搜索完成: pattern=' + input.pattern + ', baseDir=' + baseDir + ', 匹配 ' + allResults.length + ' 个文件');

      if (items.length === 0) {
        return ToolResult.success('No files found' + (ignoreNote ? '\n\n' + ignoreNote : ''));
      }

      const out = formatGlobOutput(items, allResults.length, truncated);
      return ToolResult.success(ignoreNote ? out + '\n\n' + ignoreNote : out);
    } catch (err: any) {
      return ToolResult.error('Glob 搜索失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.glob。 */
export function bootstrap(__call: any): void {
  (globalThis as any).glob = async function (pattern: any, searchPath: any) {
    return await __call('glob', { pattern: pattern, path: searchPath });
  };
}

export { GlobToolNew, parseGlobArgs, formatGlobOutput, MAX_RESULTS, GLOB_VCS_EXCLUDES, GLOB_ARTIFACT_EXCLUDES, buildGlobArgs, buildIgnoreNote };

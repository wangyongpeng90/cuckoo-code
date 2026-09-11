const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 对齐 dsh 默认上限
const GREP_MAX_MATCHES = 250;
const GREP_MAX_LINE_BYTES = 2000;

let rgPathPromise = null;
function getRgPath() {
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

/**
 * 对齐 dsh validateInclude：只允许单个正向 glob。
 */
function validateInclude(include) {
  if (include.trim().length === 0) {
    throw new Error('include must be a non-empty glob when given');
  }
  if (include.startsWith('!')) {
    throw new Error('include must be a positive glob filter; negated patterns ("!…") are not supported');
  }
  let braceDepth = 0;
  for (const char of include) {
    if (char === '{') braceDepth++;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ',' && braceDepth === 0) {
      throw new Error('include must be one glob, not a comma-separated list (use {a,b} alternation instead)');
    }
  }
}

/**
 * 对齐 dsh parseGrepArgs。
 */
function parseGrepArgs(pattern, searchPath, include) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('pattern must be a non-empty string');
  }
  if (searchPath !== undefined && searchPath !== null) {
    if (typeof searchPath !== 'string' || searchPath.trim().length === 0) {
      throw new Error('path must be a non-empty string when given');
    }
  }
  if (include !== undefined && include !== null) {
    validateInclude(include);
  }
  const out = { pattern };
  if (searchPath !== undefined && searchPath !== null) out.path = searchPath;
  if (include !== undefined && include !== null) out.include = include;
  return out;
}

/**
 * 对齐 dsh buildGrepCommand。
 */
function buildGrepCommand(input) {
  const parts = ['--json', '--regexp=' + input.pattern];
  if (input.include !== undefined) parts.push('--glob=' + input.include);
  if (input.path !== undefined) parts.push('--', input.path);
  return parts;
}

/**
 * 执行 ripgrep，返回完整 stdout。
 */
function runRipgrep(args, cwd) {
  return new Promise((resolve, reject) => {
    getRgPath().then(rgPath => {
      const child = spawn(rgPath, ['--no-config', ...args], {
        cwd,
        windowsHide: true,
        // stdin 必须忽略：无显式 path 参数时，rg 若发现 stdin 是管道（非 TTY）
        // 会改为从 stdin 读取搜索目标，导致无限等待、grep 卡死。
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0 || code === 1) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(stderr.trim() || ('ripgrep exited with code ' + code)));
        }
      });
    }).catch(reject);
  });
}

/**
 * 对齐 dsh parseRecord：解析一条 rg --json NDJSON。
 */
function parseRecord(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    throw new Error('grep received malformed ripgrep --json output (a line is not JSON)');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('grep received malformed ripgrep --json output (a record is not an object)');
  }
  if (parsed.type !== 'match') return undefined;
  if (typeof parsed.data !== 'object' || parsed.data === null) {
    throw new Error('grep received malformed ripgrep --json output (a match record has no data)');
  }
  const data = parsed.data;
  const pathText = typeof data.path === 'object' && data.path !== null ? data.path.text : undefined;
  if (typeof pathText !== 'string') {
    throw new Error('grep received malformed ripgrep --json output (a match record has no path text)');
  }
  if (typeof data.line_number !== 'number') {
    throw new Error('grep received malformed ripgrep --json output (a match record has no line number)');
  }
  if (typeof data.lines !== 'object' || data.lines === null) {
    throw new Error('grep received malformed ripgrep --json output (a match record has no line content)');
  }
  if (typeof data.lines.text === 'string') {
    return { path: pathText, lineNumber: data.line_number, line: data.lines.text.replace(/\r?\n$/, '') };
  }
  if (typeof data.lines.bytes === 'string') {
    return { path: pathText, lineNumber: data.line_number, line: '(line is not valid UTF-8)' };
  }
  throw new Error('grep received malformed ripgrep --json output (a match record has neither line text nor bytes)');
}

/**
 * 对齐 dsh parseGrepMatches：解析完整 stdout。
 */
function parseGrepMatches(stdout) {
  const matches = [];
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    const match = parseRecord(line);
    if (match !== undefined) matches.push(match);
  }
  return matches;
}

/**
 * 对齐 dsh formatGrepMatches：按文件分组。
 */
function formatGrepMatches(matches) {
  const byFile = new Map();
  for (const match of matches) {
    const group = byFile.get(match.path);
    if (group) group.push(match);
    else byFile.set(match.path, [match]);
  }
  const sections = [];
  for (const [file, group] of byFile) {
    sections.push(file + '\n' + group.map(m => 'Line ' + m.lineNumber + ': ' + m.line).join('\n'));
  }
  return sections.join('\n\n');
}

/**
 * UTF-8 安全截断，对齐 dsh previewLine。
 */
function previewLine(line, maxBytes) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= maxBytes) return line;
  const truncated = buf.slice(0, maxBytes).toString('utf8');
  return truncated + ' (line truncated)';
}

/**
 * 对齐 dsh formatGrepOutput：header + body + footer（无 spill）。
 */
function formatGrepOutput(retained) {
  const header = retained.truncated
    ? 'Found ' + retained.kept + ' of ' + retained.seen + ' matches'
    : 'Found ' + retained.seen + ' ' + (retained.seen === 1 ? 'match' : 'matches');
  const body = formatGrepMatches(retained.items);
  if (!retained.truncated) return header + '\n\n' + body;
  const recovery = 'The complete result could not be saved; narrow pattern, path, or include to see more.';
  return header + '\n\n' + body + '\n\n(' + recovery + ')';
}

/**
 * 对齐 dsh retainGrepMatches：截断到 maxMatches，并预览每行。
 */
function retainGrepMatches(matches, maxMatches, maxLineBytes) {
  const seen = matches.length;
  const truncated = seen > maxMatches;
  const items = matches.slice(0, maxMatches).map(m => ({
    path: m.path,
    lineNumber: m.lineNumber,
    line: previewLine(m.line, maxLineBytes),
  }));
  return { items, seen, kept: items.length, truncated };
}

/**
 * grep 工具 - 仿照 dsh 的 grep。
 * 使用 ripgrep 搜索文件内容。
 */
class GrepToolNew extends Tool {
  constructor() {
    super(
      'grep',
      '用 ripgrep 正则表达式搜索文件内容。返回匹配行及行号，按文件分组。返回前 ' + GREP_MAX_MATCHES + ' 条匹配。',
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '要搜索的正则表达式（ripgrep 语法）'
          },
          path: {
            type: 'string',
            description: '要搜索的文件或目录。默认为项目根目录；相对路径基于项目根目录解析'
          },
          include: {
            type: 'string',
            description: '过滤要搜索的文件，单个 glob（如 "*.ts"、"*.{js,jsx}"）。不支持否定和逗号列表'
          }
        },
        required: ['pattern'],
        additionalProperties: false
      },
      'grep(pattern, options?)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:grep',
      order: 104,
      text: '使用 grep 工具（而不是 shell grep 或 rg）搜索文件内容。需要查看匹配行的上下文时，对匹配文件使用 read。'
    };
  }

  async execute(params) {
    const { pattern, path: searchPath, include, projectDir } = params;

    try {
      const input = parseGrepArgs(pattern, searchPath, include);

      // 确定 cwd
      const baseDir = projectDir || path.resolve('.');

      if (!fs.existsSync(baseDir)) {
        return ToolResult.error('目录不存在: ' + baseDir);
      }

      // 执行 ripgrep
      const args = buildGrepCommand(input);
      let run;
      try {
        run = await runRipgrep(args, baseDir);
      } catch (err) {
        const msg = String(err.message || err);
        if (/regex parse error|error parsing glob/i.test(msg)) {
          return ToolResult.error('grep pattern rejected by ripgrep: ' + msg);
        }
        return ToolResult.error('grep search failed: ' + msg);
      }

      if (run.code === 1) {
        return ToolResult.success('No matches found');
      }

      // 解析匹配
      let all;
      try {
        all = parseGrepMatches(run.stdout);
      } catch (err) {
        return ToolResult.error(err.message);
      }

      // 路径统一为 / 分隔
      all = all.map(m => ({ ...m, path: m.path.replace(/\\/g, '/') }));

      const retained = retainGrepMatches(all, GREP_MAX_MATCHES, GREP_MAX_LINE_BYTES);

      console.log('[GrepTool] 搜索完成: pattern=' + input.pattern + ', 匹配 ' + all.length + ' 条');

      if (all.length === 0) {
        return ToolResult.success('No matches found');
      }

      return ToolResult.success(formatGrepOutput(retained));
    } catch (err) {
      return ToolResult.error('Grep 搜索失败: ' + err.message);
    }
  }
}

module.exports = { GrepToolNew, parseGrepArgs, validateInclude, parseGrepMatches, formatGrepOutput, retainGrepMatches, previewLine };

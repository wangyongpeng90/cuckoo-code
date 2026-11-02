import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import fs from 'node:fs';
import path from 'node:path';
import { stripBom } from '../../infra/decode-output.js';
import {
  READ_HEADER_FULL_KEY, READ_HEADER_PARTIAL_KEY,
  READ_FOOTER_FULL_KEY, READ_FOOTER_PARTIAL_KEY, READ_FOOTER_CAPPED_KEY,
  DEFAULT_READ_HEADER_FULL, DEFAULT_READ_HEADER_PARTIAL,
  DEFAULT_READ_FOOTER_FULL, DEFAULT_READ_FOOTER_PARTIAL, DEFAULT_READ_FOOTER_CAPPED,
  pickAndRender,
} from '../../infra/read-header-templates.js';

// [261101-ym9l98] 通用设置读取（由 app 层注入，避免 tools → app 反向依赖）
export type SettingReader = (key: string) => string | undefined;
let _readSetting: SettingReader | null = null;
export function injectSettingReader(fn: SettingReader): void {
  _readSetting = fn;
}

/** 供其他工具（如 glob）复用同一个设置读取注入，避免重复注入 */
export function readSettingRaw(key: string): string | undefined {
  if (!_readSetting) return undefined;
  try { return _readSetting(key); } catch (_) { return undefined; }
}

function readTemplatePool(key: string, fallback: string[]): string[] {
  if (!_readSetting) return fallback;
  let raw = '';
  try { raw = _readSetting(key) || ''; } catch (_) { return fallback; }
  const list = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 1,
    category: '文件读写',
    name: 'read',
    usage: '使用 read 工具（而不是 cat 等 shell 命令）来查看文本文件。结果包含行号。使用 offset 和 limit 继续读取大文件。',
    types: [
      '/** read 的选项 */',
      'interface ReadOptions {',
      '  /** 1-based 起始行号，默认 1 */',
      '  offset?: number;',
      '  /** 最大返回行数，默认 2000，上限 2000 */',
      '  limit?: number;',
      '}',
    ].join('\n'),
    doc: [
      '读取 UTF-8 文本文件并返回带行号的内容窗口。',
      '通过 offset 和 limit 分段读取大文件。输出为：',
      '首行是文件信息（路径 + 行号范围，模板可在设置里自定义），空行，',
      '然后正文是「行号: 内容」，最后一行是续读提示。',
    ].join('\n'),
    params: 'filePath: string, options?: ReadOptions',
    returns: 'Promise<string>',
    paramDocs: {
      filePath: '相对（基于项目根目录）或绝对路径',
      options: '可选，offset/limit',
    },
    throws: '文件不存在、不是文件、offset 越界或读取失败时抛出异常',
  },
];

// 与 dsh read 对齐的默认上限
const READ_LIMIT = 2000;
const READ_MAX_LINE_LENGTH = 2000;
const READ_MAX_BYTES = 50 * 1024;

/**
 * 校验并归一化 read 参数。
 * offset/limit 必须是正整数，limit 不能超过 READ_LIMIT。
 */
function parseReadArgs(filePath: any, offset: any, limit: any): { offset: number; limit: number } {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('filePath must be a non-empty string');
  }
  const parsedOffset = offset === undefined || offset === null ? 1 : Number(offset);
  const parsedLimit = limit === undefined || limit === null ? READ_LIMIT : Number(limit);
  if (!Number.isInteger(parsedOffset) || parsedOffset < 1) {
    throw new Error('offset must be a positive integer');
  }
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (parsedLimit > READ_LIMIT) {
    throw new Error('limit must be less than or equal to ' + READ_LIMIT);
  }
  return { offset: parsedOffset, limit: parsedLimit };
}

function truncateLine(line: string, maxLineLength: number): string {
  return line.length > maxLineLength
    ? line.substring(0, maxLineLength) + '... (line truncated to ' + maxLineLength + ' chars)'
    : line;
}

function lineByteSize(line: string, currentLineCount: number): number {
  return Buffer.byteLength(line, 'utf8') + (currentLineCount > 0 ? 1 : 0);
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

interface WindowRequest {
  offset: number;
  limit: number;
  maxLineLength: number;
  maxBytes: number;
}

interface WindowLine {
  number: number;
  text: string;
}

interface WindowResult {
  lines: WindowLine[];
  totalLines: number;
  truncatedByBytes: boolean;
}

/**
 * 从全文构建带行号的窗口，逻辑对齐 dsh read-render.buildWindow。
 */
function buildWindow(text: string, request: WindowRequest, displayPath: string): WindowResult {
  const acc = { lines: [] as WindowLine[], totalLines: 0, outputBytes: 0, truncatedByBytes: false };
  const rawLines = text.split(/\r?\n/);

  // 按行扫描：每行都计入 totalLines，但只保留窗口内的行
  for (const rawLine of rawLines) {
    acc.totalLines += 1;
    if (acc.truncatedByBytes || acc.totalLines < request.offset || acc.lines.length >= request.limit) continue;

    const lineText = stripCarriageReturn(rawLine);
    const text2 = truncateLine(lineText, request.maxLineLength);
    const bytes = lineByteSize(text2, acc.lines.length);
    if (acc.outputBytes + bytes > request.maxBytes) {
      acc.truncatedByBytes = true;
      continue;
    }
    acc.outputBytes += bytes;
    acc.lines.push({ number: acc.totalLines, text: text2 });
  }

  if (!acc.truncatedByBytes && request.offset > acc.totalLines && !(acc.totalLines === 0 && request.offset === 1)) {
    throw new Error('offset ' + request.offset + ' is out of range for "' + displayPath + '" (' + acc.totalLines + ' lines)');
  }

  return {
    lines: acc.lines,
    totalLines: acc.totalLines,
    truncatedByBytes: acc.truncatedByBytes,
  };
}

/**
 * [261101-ym9l98] 首行元信息可配置（完整 / 部分两套池）；
 * 正文「行号: 内容」与 footer 保持固定格式（AI 依赖其解析行号与续读）。
 */
function formatReadOutput(displayPath: string, outcome: any): string {
  const endLine = outcome.lines.length > 0
    ? outcome.lines[outcome.lines.length - 1].number
    : Math.max(0, outcome.offset - 1);

  let header: string;
  if (outcome.truncatedByBytes || endLine < outcome.totalLines) {
    const pool = readTemplatePool(READ_HEADER_PARTIAL_KEY, DEFAULT_READ_HEADER_PARTIAL);
    header = pickAndRender(pool, DEFAULT_READ_HEADER_PARTIAL, {
      path: displayPath,
      start: outcome.offset,
      end: endLine,
      total: outcome.totalLines,
      rest: Math.max(0, outcome.totalLines - endLine),
    });
  } else {
    const pool = readTemplatePool(READ_HEADER_FULL_KEY, DEFAULT_READ_HEADER_FULL);
    header = pickAndRender(pool, DEFAULT_READ_HEADER_FULL, {
      path: displayPath,
      total: outcome.totalLines,
    });
  }

  // [261101-ym9l98] footer 也走模板池；offset= 参数名由模板作者保证（内置模板均已包好）
  const nextOffset = endLine + 1;
  let footer: string;
  if (outcome.truncatedByBytes) {
    footer = pickAndRender(
      readTemplatePool(READ_FOOTER_CAPPED_KEY, DEFAULT_READ_FOOTER_CAPPED),
      DEFAULT_READ_FOOTER_CAPPED,
      { start: outcome.offset, end: endLine, next: nextOffset }
    );
  } else if (endLine < outcome.totalLines) {
    footer = pickAndRender(
      readTemplatePool(READ_FOOTER_PARTIAL_KEY, DEFAULT_READ_FOOTER_PARTIAL),
      DEFAULT_READ_FOOTER_PARTIAL,
      { start: outcome.offset, end: endLine, total: outcome.totalLines, next: nextOffset }
    );
  } else {
    footer = pickAndRender(
      readTemplatePool(READ_FOOTER_FULL_KEY, DEFAULT_READ_FOOTER_FULL),
      DEFAULT_READ_FOOTER_FULL,
      { total: outcome.totalLines }
    );
  }

  const body = outcome.lines.length > 0
    ? outcome.lines.map((line: WindowLine) => line.number + ': ' + line.text).join('\n') + '\n\n' + footer
    : footer;

  return header + '\n\n' + body;
}

/**
 * read 工具 - 完全仿照 dsh 的 read。
 * 返回带行号的文本窗口，支持 offset/limit 分段读取大文件。
 */
class ReadTool extends Tool {
  constructor() {
    super(
      'read',
      '读取 UTF-8 文本文件并返回带行号的内容窗口。支持 offset/limit 分段读取大文件。',
      {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要读取的文件路径（相对路径基于项目根目录，或绝对路径）'
          },
          offset: {
            type: 'number',
            description: '1-based 起始行号，默认 1'
          },
          limit: {
            type: 'number',
            description: '最大返回行数，默认 ' + READ_LIMIT + '，上限 ' + READ_LIMIT
          }
        },
        required: ['filePath'],
        additionalProperties: false
      },
      'read(filePath, options?)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const { filePath, offset, limit, projectDir } = params;

    try {
      const input = parseReadArgs(filePath, offset, limit);

      // 路径解析：相对路径基于 projectDir
      const normalizedPath = String(filePath).replace(/\//g, path.sep);
      let resolvedPath = normalizedPath;
      if (!path.isAbsolute(normalizedPath) && projectDir) {
        resolvedPath = path.join(projectDir, normalizedPath);
      } else if (!path.isAbsolute(normalizedPath)) {
        resolvedPath = path.resolve(normalizedPath);
      }

      // 文件存在性与类型检查
      if (!fs.existsSync(resolvedPath)) {
        return ToolResult.error('文件不存在: ' + resolvedPath);
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return ToolResult.error('不是文件: ' + resolvedPath);
      }

      // 读取整个文件内容（当前实现与 dsh 流式不同，但保证 totalLines 精确）
      // stripBom：PowerShell 写的 UTF-8 文件带 BOM，读回时首字符是看不见的 \uFEFF
      const content = stripBom(fs.readFileSync(resolvedPath, 'utf-8'));
      const request: WindowRequest = {
        offset: input.offset,
        limit: input.limit,
        maxLineLength: READ_MAX_LINE_LENGTH,
        maxBytes: READ_MAX_BYTES,
      };
      const window = buildWindow(content, request, filePath);

      console.log('[ReadTool] 已读取:', resolvedPath, 'offset=' + input.offset, 'limit=' + input.limit, 'totalLines=' + window.totalLines);
      return ToolResult.success(formatReadOutput(filePath, { ...window, offset: input.offset }));
    } catch (err: any) {
      return ToolResult.error('读取文件失败: ' + err.message);
    }
  }
}

/**
 * JsRunner 沙箱注入：定义 globalThis.read。
 * 源码经 scripts/build-tool-api.mjs 提取组装进 JsRunner 的 BOOTSTRAP。
 */
export function bootstrap(__call: any): void {
  (globalThis as any).read = async function (filePath: any, options: any) {
    options = options || {};
    return await __call('read', {
      filePath: filePath,
      offset: options.offset,
      limit: options.limit,
    });
  };
}

export { ReadTool, READ_LIMIT, READ_MAX_LINE_LENGTH, READ_MAX_BYTES, parseReadArgs, buildWindow, formatReadOutput };

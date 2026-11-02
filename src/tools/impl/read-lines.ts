import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import fs from 'node:fs';
import path from 'node:path';
import { stripBom } from '../../infra/decode-output.js';
import { READ_LIMIT, parseReadArgs, buildWindow } from './read.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 2,
    category: '文件读写',
    name: 'readLines',
    types: [
      '/** readLines 返回的单行数据 */',
      'interface ReadLine {',
      '  /** 1-based 行号 */',
      '  number: number;',
      '  /** 行文本（不含换行符） */',
      '  text: string;',
      '}',
      '',
      '/** readLines 的返回结果 */',
      'interface ReadLinesResult {',
      '  /** 窗口内的行数据 */',
      '  lines: ReadLine[];',
      '  /** 文件总行数 */',
      '  totalLines: number;',
      '  /** 本次起始行号 */',
      '  offset: number;',
      '  /** 是否因字节上限被截断 */',
      '  truncatedByBytes: boolean;',
      '}',
    ].join('\n'),
    doc: '读取 UTF-8 文本文件并返回结构化行数组，供 AI 在内存中精确处理。',
    usage: '使用 readLines 工具读取文件的结构化行数据（数组，每个元素含 number 和 text 字段），适合在内存中批量处理（如 map/filter/join 后写回）。如果只是查看文件内容，用 read 即可。',
    params: 'filePath: string, options?: ReadOptions',
    returns: 'Promise<ReadLinesResult>',
    paramDocs: {
      filePath: '相对（基于项目根目录）或绝对路径',
      options: '可选，offset/limit',
    },
    throws: '文件不存在、不是文件、offset 越界或读取失败时抛出异常',
  },
];

/**
 * readLines 工具 - 返回结构化行数据（数组），供 AI 在内存中精确处理。
 * 与 read 的区别：
 * - read 返回纯文本 envelope（给 AI "看"）
 * - readLines 返回结构化数组（给 AI "程序处理"）
 */
class ReadLinesTool extends Tool {
  constructor() {
    super(
      'readLines',
      '读取 UTF-8 文本文件并返回结构化行数组，供 AI 在内存中精确处理。支持 offset/limit 分段读取大文件。',
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
      'readLines(filePath, options?)'
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

      // 读取整个文件内容
      // stripBom：PowerShell 写的 UTF-8 文件带 BOM，读回时首字符是看不见的 \uFEFF
      const content = stripBom(fs.readFileSync(resolvedPath, 'utf-8'));
      const window = buildWindow(content, {
        offset: input.offset,
        limit: input.limit,
        maxLineLength: 2000,
        maxBytes: 50 * 1024,
      }, filePath);

      console.log('[ReadLinesTool] 已读取:', resolvedPath, 'offset=' + input.offset, 'limit=' + input.limit, 'totalLines=' + window.totalLines);

      // 返回结构化数据：lines 数组 + 元信息
      return ToolResult.success({
        lines: window.lines,
        totalLines: window.totalLines,
        offset: input.offset,
        truncatedByBytes: window.truncatedByBytes,
      });
    } catch (err: any) {
      return ToolResult.error('读取文件失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.readLines。 */
export function bootstrap(__call: any): void {
  (globalThis as any).readLines = async function (filePath: any, options: any) {
    options = options || {};
    return await __call('readLines', {
      filePath: filePath,
      offset: options.offset,
      limit: options.limit,
    });
  };
}

export { ReadLinesTool };

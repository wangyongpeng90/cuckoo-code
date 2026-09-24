import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { normalizeLineEndings, detectLineEndings, restoreLineEndings } from '../../infra/eol.js';
import fs from 'node:fs';
import path from 'node:path';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 3,
    category: '文件读写',
    name: 'write',
    doc: [
      '创建或完全覆盖 UTF-8 文本文件。',
      '返回格式化 envelope：<path>...</path><type>file</type><content>Created/Updated file</content>',
    ].join('\n'),
    params: 'filePath: string, content: string',
    returns: 'Promise<string>',
    paramDocs: {
      filePath: '相对（基于项目根目录）或绝对路径',
      content: '完整 UTF-8 文本内容；空字符串合法（写入空文件）',
    },
    throws: '路径为空、写入失败时抛出异常',
  },
];

/**
 * 校验 write 参数：
 * - filePath 必须是非空字符串
 * - content 允许为空字符串（写空文件是合法的）
 */
function parseWriteArgs(filePath: any, content: any): { filePath: string; content: string } {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('filePath must be a non-empty string');
  }
  if (typeof content !== 'string') {
    throw new Error('content must be a string');
  }
  return { filePath, content };
}

/**
 * 与 dsh formatWriteOutput 对齐：返回 envelope，不回显内容。
 */
function formatWriteOutput(displayPath: string, operation: string): string {
  const verb = operation === 'create' ? 'Created' : 'Updated';
  return '<path>' + displayPath + '</path>\n<type>file</type>\n<content>\n' + verb + ' file\n</content>';
}

/**
 * write 工具 - 仿照 dsh 的 write。
 * 创建或完全覆盖 UTF-8 文本文件。
 */
class WriteTool extends Tool {
  constructor() {
    super(
      'write',
      '创建或完全覆盖 UTF-8 文本文件。返回 Created/Updated 确认信息。',
      {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要写入的文件路径（相对路径基于项目根目录，或绝对路径）'
          },
          content: {
            type: 'string',
            description: '完整 UTF-8 文本内容。空字符串合法（写入空文件）'
          }
        },
        required: ['filePath', 'content'],
        additionalProperties: false
      },
      'write(filePath, content)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:write',
      order: 101,
      text: '使用 write 工具创建文件或完全替换文件内容。已有文件会被覆盖，所以覆盖前先 read 文件，针对局部修改优先用 edit。注意：read 输出的内容带行号和 footer，写入的 content 必须是文件原始内容，不要包含行号、<path>/<content> 包装或 footer 提示。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { filePath, content, projectDir } = params;

    try {
      const input = parseWriteArgs(filePath, content);

      // 路径解析：相对路径基于 projectDir
      const normalizedPath = input.filePath.replace(/\//g, path.sep);
      let resolvedPath = normalizedPath;
      if (!path.isAbsolute(normalizedPath) && projectDir) {
        resolvedPath = path.join(projectDir, normalizedPath);
      } else if (!path.isAbsolute(normalizedPath)) {
        resolvedPath = path.resolve(normalizedPath);
      }

      // 检查路径是否为目录
      if (fs.existsSync(resolvedPath)) {
        const stat = fs.statSync(resolvedPath);
        if (stat.isDirectory()) {
          return ToolResult.error('写入失败: 目标路径是目录，不是文件: ' + resolvedPath);
        }
      }

      // 判断是 create 还是 update（最小移植不读 before/after）
      const exists = fs.existsSync(resolvedPath);
      const operation = exists ? 'update' : 'create';

      // 换行符策略（dsh 方案）：
      //  - 已有文件：跟随其主导换行符（不改变文件风格）
      //  - 新文件：LF
      const contentLf = normalizeLineEndings(input.content);
      let finalContent = contentLf;
      if (exists) {
        const lineEndings = detectLineEndings(fs.readFileSync(resolvedPath, 'utf-8'));
        finalContent = restoreLineEndings(contentLf, lineEndings);
      }

      // 确保目录存在
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写文件
      fs.writeFileSync(resolvedPath, finalContent, 'utf-8');

      console.log('[WriteTool] ' + (operation === 'create' ? 'Created' : 'Updated') + ':', resolvedPath);
      return ToolResult.success(formatWriteOutput(input.filePath, operation));
    } catch (err: any) {
      return ToolResult.error('写入文件失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.write。 */
export function bootstrap(__call: any): void {
  (globalThis as any).write = async function (filePath: any, content: any) {
    return await __call('write', { filePath: filePath, content: content });
  };
}

export { WriteTool, parseWriteArgs, formatWriteOutput };

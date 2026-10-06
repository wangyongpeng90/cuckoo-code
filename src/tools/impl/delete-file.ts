import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { isProtectedPath } from '../../infra/protected-paths.js';
import fs from 'node:fs';
import path from 'node:path';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 10,
    category: '删除',
    name: 'deleteFile',
    types: [
      '/** deleteFile 的返回值 */',
      'interface FileDeleteResult {',
      '  message: string;',
      '  /** 被删除文件的绝对路径 */',
      '  path: string;',
      '}',
    ].join('\n'),
    doc: '删除指定文件（不可恢复，请谨慎使用；只能删除文件，不能删除目录）。',
    params: 'filePath: string',
    returns: 'Promise<FileDeleteResult>',
    paramDocs: {
      filePath: '要删除的文件路径',
    },
    throws: '文件不存在或路径不是文件时抛出异常',
  },
];

/**
 * 文件删除工具
 * 用于删除指定的文件（不可恢复）
 */
class DeleteFileTool extends Tool {
  constructor() {
    super(
      'deleteFile',
      '删除指定文件（不可恢复，请谨慎使用）。返回 { message, path }，其中 path 为被删除文件的绝对路径。',
      {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '要删除的文件的相对路径（相对于项目目录）' }
        },
        required: ['filePath']
      },
      'deleteFile(filePath)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:deleteFile',
      order: 112,
      text: '使用 deleteFile 工具永久删除文件。此操作不可撤销。返回 { message, path }，path 为被删除文件的绝对路径。删除前请仔细确认路径。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { filePath, projectDir } = params;
    if (!filePath) {
      return ToolResult.error('缺少参数 filePath');
    }

    // 解析绝对路径
    let absolutePath = filePath;
    if (!path.isAbsolute(absolutePath) && projectDir) {
      absolutePath = path.join(projectDir, filePath);
    } else if (!path.isAbsolute(absolutePath)) {
      absolutePath = path.resolve(filePath);
    }

    // 受保护路径检查（禁止删除快照/记忆数据）
    const guard = isProtectedPath(absolutePath);
    if (guard) return ToolResult.error('删除失败: 目标路径受保护 — ' + guard);

    try {
      // 检查文件是否存在
      await fs.promises.access(absolutePath, fs.constants.F_OK);
      // 检查是否为文件（不是目录）
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile()) {
        return ToolResult.error(`路径不是文件: ${absolutePath}`);
      }
      // 删除文件
      await fs.promises.unlink(absolutePath);
      return ToolResult.success({ message: `文件已删除: ${absolutePath}`, path: absolutePath });
    } catch (err: any) {
      return ToolResult.error(`删除文件失败: ${err.message}`);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.deleteFile。 */
export function bootstrap(__call: any): void {
  (globalThis as any).deleteFile = async function (filePath: any) {
    return await __call('deleteFile', { filePath: filePath });
  };
}

export { DeleteFileTool };

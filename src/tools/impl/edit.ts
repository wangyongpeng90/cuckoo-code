import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { normalizeLineEndings, detectLineEndings, restoreLineEndings } from '../../infra/eol.js';
import fs from 'node:fs';
import path from 'node:path';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 4,
    category: '文件读写',
    name: 'edit',
    doc: [
      '在现有 UTF-8 文本文件中精确替换 oldString 为 newString。',
      '默认 oldString 必须唯一匹配；多匹配需设置 replaceAll。',
      '返回 Claude-style 确认消息。',
    ].join('\n'),
    params: 'filePath: string, oldString: string, newString: string, replaceAll?: boolean, dryRun?: boolean',
    returns: 'Promise<string>',
    paramDocs: {
      filePath: '相对或绝对路径',
      oldString: '要替换的字面文本',
      newString: '替换后的字面文本（可空字符串删除匹配）',
      replaceAll: '是否替换所有匹配，默认 false',
      dryRun: '是否只预览不写入，默认 false；true 时返回将替换的处数和内容，不修改文件',
    },
    throws: '文件不存在、oldString 未找到、多匹配未设置 replaceAll、oldString===newString 时抛出异常',
  },
];

/**
 * 校验 edit 参数（对齐 dsh parseEditArgs）：
 * - filePath trim 后非空
 * - oldString 非空
 * - oldString !== newString（避免 no-op）
 */
function parseEditArgs(filePath: any, oldString: any, newString: any, replaceAll: any, dryRun: any) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('filePath must be a non-empty string');
  }
  if (typeof oldString !== 'string' || oldString.length === 0) {
    throw new Error('oldString must be a non-empty string');
  }
  if (typeof newString !== 'string') {
    throw new Error('newString must be a string');
  }
  if (oldString === newString) {
    throw new Error('oldString and newString must differ');
  }
  return {
    filePath,
    oldString,
    newString,
    replaceAll: replaceAll === true,
    dryRun: dryRun === true,
  };
}

/**
 * 对齐 dsh formatEditOutput：Claude-style 确认语。
 */
function formatEditOutput(displayPath: string, replaceAll: boolean, occurrences: number = 1): string {
  const noun = occurrences === 1 ? 'occurrence' : 'occurrences';
  return replaceAll
    ? 'The file ' + displayPath + ' has been updated. Replaced ' + occurrences + ' ' + noun + ' successfully.'
    : 'The file ' + displayPath + ' has been updated successfully. Replaced 1 occurrence.';
}

/**
 * dry-run 预览输出：不写文件，只返回将要替换的信息。
 */
function formatDryRunOutput(displayPath: string, oldString: string, newString: string, occurrences: number, replaceAll: boolean): string {
  const action = replaceAll
    ? '将全部替换 ' + occurrences + ' 处'
    : '将替换 1 处';
  return '[DRY-RUN] 文件未修改。' + displayPath + '：' + action +
    '。old: ' + JSON.stringify(oldString) + ' → new: ' + JSON.stringify(newString);
}

/**
 * edit 工具 - 仿照 dsh 的 edit。
 * 对现有 UTF-8 文本文件做精确字符串替换。
 */
class EditTool extends Tool {
  constructor() {
    super(
      'edit',
      '对现有 UTF-8 文本文件做精确替换（oldString → newString）。默认 oldString 必须唯一匹配；多匹配可设置 replaceAll。',
      {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要编辑的文件路径（相对路径基于项目根目录，或绝对路径）'
          },
          oldString: {
            type: 'string',
            description: '要替换的字面文本，必须与文件内容精确匹配'
          },
          newString: {
            type: 'string',
            description: '替换后的字面文本。可用空字符串删除匹配内容'
          },
          replaceAll: {
            type: 'boolean',
            description: '是否替换所有匹配。默认 false；false 时 oldString 必须唯一匹配',
            default: false
          },
          dryRun: {
            type: 'boolean',
            description: '是否只预览不写入。true 时返回将替换的处数和内容，不修改文件',
            default: false
          }
        },
        required: ['filePath', 'oldString', 'newString'],
        additionalProperties: false
      },
      'edit(filePath, oldString, newString, replaceAll?, dryRun?)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:edit',
      order: 102,
      text: '使用 edit 工具对现有 UTF-8 文本文件做定向修改：用 newString 替换字面量 oldString。'
        + 'oldString 应是一行或多行【连续】的原文（可跨行，不必逐行改）；【务必注意空白与缩进】——'
        + '缩进、空格不一致是替换失败的最常见原因，请直接复制 read 到的原文。'
        + '默认 oldString 必须唯一匹配：若出现多次，请提供更长的上下文使其唯一，或设置 replaceAll: true 全部替换。'
        + '批量替换同一文本时优先用 replaceAll: true 一次完成，避免读全文后整体写回。'
        + '批量修改前可用 dryRun: true 预览，确认无误后再真实写入；返回结果会包含实际替换处数，可用于自我校验。'
        + '除非你刚在本会话中创建或编辑过该文件，否则先 read 文件。'
        + '注意：read 输出的内容带行号，oldString/newString 必须是文件原始文本，不要包含行号或 footer 提示。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { filePath, oldString, newString, replaceAll, dryRun, projectDir } = params;

    try {
      const input = parseEditArgs(filePath, oldString, newString, replaceAll, dryRun);

      // 路径解析：相对路径基于 projectDir
      const normalizedPath = input.filePath.replace(/\//g, path.sep);
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

      // 读取原始内容，记录换行符风格，内容归一成 LF（dsh 方案）
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const lineEndings = detectLineEndings(raw);
      const content = normalizeLineEndings(raw);

      // 在 LF 世界匹配（oldString / newString 也归一）
      const oldNorm = normalizeLineEndings(input.oldString);
      const newNorm = normalizeLineEndings(input.newString);

      let occurrences = 0;
      let idx = 0;
      while (true) {
        const found = content.indexOf(oldNorm, idx);
        if (found === -1) break;
        occurrences++;
        idx = found + oldNorm.length;
      }
      if (occurrences === 0) {
        return ToolResult.error('未找到要替换的文本，请检查 oldString 是否与文件内容精确匹配。文件路径: ' + resolvedPath);
      }
      if (occurrences > 1 && !input.replaceAll) {
        return ToolResult.error('oldString 在文件中出现 ' + occurrences + ' 次。若要全部替换，请设置 replaceAll: true；若只替换其中一处，请提供更长的唯一片段（更多上下文）。');
      }

      // 执行替换（LF 世界）
      const editedLf = content.split(oldNorm).join(newNorm);

      // dry-run：只预览，不写文件
      if (input.dryRun) {
        console.log('[EditTool] dry-run 预览:', resolvedPath, '将替换', occurrences, '处');
        return ToolResult.success(formatDryRunOutput(input.filePath, input.oldString, input.newString, occurrences, input.replaceAll));
      }

      // 写回：恢复文件原本的换行符风格
      const newContent = restoreLineEndings(editedLf, lineEndings);
      fs.writeFileSync(resolvedPath, newContent, 'utf-8');

      console.log('[EditTool] 已编辑:', resolvedPath, '替换', occurrences, '处');
      return ToolResult.success(formatEditOutput(input.filePath, input.replaceAll, occurrences));
    } catch (err: any) {
      return ToolResult.error('编辑文件失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.edit。 */
export function bootstrap(__call: any): void {
  (globalThis as any).edit = async function (filePath: any, oldString: any, newString: any, replaceAll: any, dryRun: any) {
    return await __call('edit', {
      filePath: filePath,
      oldString: oldString,
      newString: newString,
      replaceAll: replaceAll === true,
      dryRun: dryRun === true,
    });
  };
}

export { EditTool, parseEditArgs, formatEditOutput, formatDryRunOutput };

/**
 * 工具失败日志（仅开发版）
 *
 * 目的：把 AI 执行的 JS 脚本里"工具调用失败"和"脚本级失败"单独记到文件，
 * 长期保留，便于事后分析哪些工具常出错、怎么错的。
 *
 * 位置：userData/wyp/log/tool-errors/<工具名>.log（子目录，不被启动清空逻辑影响）
 * 仅开发版：打包版（app.isPackaged）不写。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { app } = require('electron');

const CODE_MAX = 5000;

/** 一次脚本运行的失败明细 */
export interface ToolFailure {
  tool: string;
  args: any;
  error: string;
}

/** 是否启用（仅开发版） */
function enabled(): boolean {
  try {
    return !app.isPackaged;
  } catch (_) {
    return false;
  }
}

/** 错误日志根目录 */
function errorsDir(): string {
  return path.join(app.getPath('userData'), 'wyp', 'log', 'tool-errors');
}

/** 安全序列化（截断长值） */
function safeStr(v: any, max = 2000): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    if (s === undefined) return String(v);
    return s.length > max ? s.slice(0, max) + '\n...(截断)' : s;
  } catch (_) {
    return String(v);
  }
}

/** 工具名 → 安全文件名（防路径穿越/非法字符） */
function safeFileName(tool: string): string {
  const t = String(tool || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return (t || 'unknown') + '.log';
}

/**
 * 写一条失败日志。
 * @param tool 工具名（脚本级失败传 '_script'）
 * @param args 工具参数（脚本级失败传 null）
 * @param error 错误信息
 * @param code 本次 AI 执行的完整 JS 代码
 * @param meta 额外信息（项目目录等）
 */
export function writeToolError(tool: string, args: any, error: string, code: string, meta?: Record<string, any>): void {
  if (!enabled()) return;
  try {
    const dir = errorsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, safeFileName(tool));
    const ts = new Date().toISOString();
    const codeStr = code && code.length > CODE_MAX ? code.slice(0, CODE_MAX) + '\n...(代码过长，已截断)' : (code || '');
    const lines: string[] = [];
    lines.push('=== [' + ts + '] 工具=' + tool + ' ===');
    lines.push('时间: ' + ts);
    lines.push('工具: ' + tool);
    if (meta) {
      for (const k of Object.keys(meta)) {
        lines.push(k + ': ' + safeStr(meta[k], 500));
      }
    }
    lines.push('错误: ' + (error || ''));
    lines.push('参数: ' + safeStr(args));
    lines.push('AI 代码:');
    lines.push(codeStr);
    lines.push('');
    fs.appendFileSync(file, lines.join('\n') + '\n', 'utf-8');
  } catch (_) {
    /* 日志写入失败不影响主流程 */
  }
}

/**
 * 一次脚本运行结束后统一写日志。
 * @param code AI 执行的完整 JS 代码
 * @param failures 工具级失败列表
 * @param scriptError 脚本级失败（无则 null）
 * @param meta 额外信息（projectDir / windowId / 耗时等）
 */
export function logRun(
  code: string,
  failures: ToolFailure[],
  scriptError: string | null,
  meta?: Record<string, any>,
): void {
  if (!enabled()) return;
  for (const f of failures) {
    writeToolError(f.tool, f.args, f.error, code, meta);
  }
  if (scriptError) {
    writeToolError('_script', null, scriptError, code, meta);
  }
}

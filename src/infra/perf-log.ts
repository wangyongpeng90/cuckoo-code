/**
 * 性能探针日志（仅开发版）
 *
 * 目的：诊断"长对话 AI 回复时页面卡顿"的原因——记录每次回复期间
 * 我方 hook 的处理耗时、页面的长任务、帧间隔，判断卡顿是"我们造成的"
 * 还是"DeepSeek 页面自身渲染/GC 造成的"。
 *
 * 位置：userData/wyp/log/perf/stream.log（子目录，不被启动清空影响）
 * 仅开发版：打包版（app.isPackaged）不写。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { app } = require('electron');

function enabled(): boolean {
  try { return !app.isPackaged; } catch (_) { return false; }
}

function perfDir(): string {
  return path.join(app.getPath('userData'), 'wyp', 'log', 'perf');
}

/**
 * 写一条性能探针日志。
 * @param tag 标签（如 'stream'）
 * @param data 探针数据对象（会被 JSON 序列化）
 */
export function writePerfLog(tag: string, data: any): void {
  if (!enabled()) return;
  try {
    const dir = perfDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, String(tag || 'perf').replace(/[^a-zA-Z0-9_.-]/g, '_') + '.log');
    const ts = new Date().toISOString();
    let body: string;
    try { body = JSON.stringify(data); } catch (_) { body = String(data); }
    fs.appendFileSync(file, '[' + ts + '] ' + body + '\n', 'utf-8');
  } catch (_) {
    /* 日志写入失败不影响主流程 */
  }
}

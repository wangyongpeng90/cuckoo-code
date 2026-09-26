/**
 * 系统总累计 token 统计（跨窗口，主进程持久化）
 * 各窗口上报自己的"窗口累计"，主进程按 profileId 存储并求和。
 * 持久化到 userData/token-stats.json，故窗口关闭后其贡献仍计入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { app } = require('electron');

let FILE: string | null = null;
function file(): string {
  if (!FILE) FILE = path.join(app.getPath('userData'), 'token-stats.json');
  return FILE;
}

function read(): Record<string, number> {
  try {
    const raw = fs.readFileSync(file(), 'utf-8');
    const o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : {};
  } catch (_) {
    return {};
  }
}

function write(m: Record<string, number>): void {
  try { fs.writeFileSync(file(), JSON.stringify(m, null, 2), 'utf-8'); } catch (_) {}
}

/** 记录某窗口的窗口累计，返回最新系统总累计 */
export function setWindowCumulative(profileId: string, value: number): number {
  if (!profileId || typeof value !== 'number') return getTotal();
  const m = read();
  m[profileId] = value;
  write(m);
  return getTotal();
}

/** 系统总累计：所有窗口（含已关闭）之和 */
export function getTotal(): number {
  const m = read();
  let sum = 0;
  for (const k of Object.keys(m)) sum += (typeof m[k] === 'number' ? m[k] : 0);
  return sum;
}

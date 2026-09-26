/**
 * 系统总累计 token 统计（跨窗口，主进程持久化）
 * 各窗口上报自己的"窗口累计"，主进程按 profileId 存储并求和。
 * 持久化到 userData/token-stats.json，故窗口关闭后其贡献仍计入。
 *
 * ⚠️ 并发安全（勿改成异步）：
 * 本模块的"读-改-写"依赖**同步 IO + 主进程单线程**保证原子性——
 * setWindowCumulative 里 readFileSync 到 writeFileSync 之间没有 await，
 * 一次调用不会被其它窗口的 IPC 打断，故多窗口同时上报不会产生数据竞争。
 * 若将来改成 fs.promises（异步），"读"与"写"之间会插入其它调用，
 * 可能导致后者覆盖前者的结果（丢失更新）——届时必须加锁或改原子写。
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

/**
 * 记录某窗口的窗口累计，返回最新系统总累计。
 * 注意：内部"读-改-写"必须保持同步（见文件头并发安全说明），勿插入 await。
 * 不同窗口写的是各自的 profileId 键，键不重叠，天然无冲突。
 */
export function setWindowCumulative(profileId: string, value: number): number {
  if (!profileId || typeof value !== 'number') return getTotal();
  const m = read();          // 同步读（原子起点）
  m[profileId] = value;      // 只改自己的键
  write(m);                  // 同步写（原子终点，中间无 await）
  return getTotal();
}

/** 系统总累计：所有窗口（含已关闭）之和 */
export function getTotal(): number {
  const m = read();
  let sum = 0;
  for (const k of Object.keys(m)) sum += (typeof m[k] === 'number' ? m[k] : 0);
  return sum;
}

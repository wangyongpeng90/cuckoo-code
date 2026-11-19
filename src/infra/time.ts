/**
 * [261109-8ms69z-cuko-api] 本地时间工具
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 背景：`new Date().toISOString()` 是 UTC（如 04:05:45Z），直接看 SQLite
 * 会比本地时间少 8 小时，容易误以为写错了。Cuko 表统一改存「带本地偏移的
 * ISO」：2026-11-19T12:05:45.216+08:00 —— 既是本地墙钟时间，又无歧义、
 * 能被 `new Date()` 正确解析；同一时区下按字符串排序即时间顺序。
 */

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** 把 Date 转成本地时区、带偏移的 ISO 字符串 */
export function toLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  return `${ymd}T${hms}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** 当前本地时间（带偏移） */
export function nowLocalIso(): string {
  return toLocalIso(new Date());
}


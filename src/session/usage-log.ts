/**
 * [261031-x7k9p2] AI 用量统计日志数据层
 */
import type { DatabaseSync } from 'node:sqlite';

/** 记录一条事件（send 或 reply） */
function insertUsageLog(
  db: DatabaseSync,
  logicId: string | null,
  profileId: string | null,
  providerId: string,
  eventType: 'send' | 'reply',
  totalToken: number = 0,
  diffToken: number = 0
): void {
  try {
    const now = new Date();
    // 格式化为 YYYY-MM-DD HH:mm:ss
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const stmt = db.prepare(
      `INSERT INTO ai_usage_logs (logic_id, profile_id, provider_id, event_type, created_at, total_token, diff_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(logicId || null, profileId || null, providerId, eventType, timeStr, totalToken, diffToken);
  } catch (err: any) {
    console.error('[UsageLog] 插入失败:', err.message);
  }
}

/**
 * [261031-x7k9p2] 计算本次对话实际消耗的 Token（差值）。
 * @param currentTotal 本次服务端返回的累计上下文 Token
 * @param lastTotal 上一次记录的累计上下文 Token
 */
function calculateDiffToken(currentTotal: number, lastTotal: number): number {
  if (currentTotal <= 0) return 0;
  // 正常情况下，上下文是不断累加的
  if (currentTotal > lastTotal) {
    return currentTotal - lastTotal;
  }
  // 如果上下文变小了（比如触发了上下文压缩，或者清空了会话），
  // 认为这是一次全新的开始，差值就是当前的 total。
  return currentTotal;
}

/** 获取指定会话上一次 reply 的 total_token（用于算差值） */
function getLastReplyToken(db: DatabaseSync, logicId: string): number {
  try {
    const stmt = db.prepare(
      `SELECT total_token FROM ai_usage_logs 
       WHERE logic_id = ? AND event_type = 'reply' AND total_token > 0
       ORDER BY id DESC LIMIT 1`
    );
    const row = stmt.get(logicId) as { total_token: number } | undefined;
    return row ? row.total_token : 0;
  } catch (_) {
    return 0;
  }
}

/** 聚合查询（按天/时/分） */
function getUsageStats(
  db: DatabaseSync,
  granularity: 'day' | 'hour' | 'minute',
  startTime: string,
  endTime: string,
  profileId?: string | null
): { time_label: string; send_count: number; reply_count: number; diff_token: number }[] {
  let timeFormat = '';
  if (granularity === 'day') timeFormat = "substr(created_at, 1, 10)";
  else if (granularity === 'hour') timeFormat = "substr(created_at, 1, 13)";
  else timeFormat = "substr(created_at, 1, 16)";

  let whereClause = 'created_at >= ? AND created_at <= ?';
  const params: any[] = [startTime, endTime];

  if (profileId) {
    whereClause += ' AND profile_id = ?';
    params.push(profileId);
  }

  const sql = `
    SELECT 
      ${timeFormat} as time_label,
      SUM(CASE WHEN event_type = 'send' THEN 1 ELSE 0 END) as send_count,
      SUM(CASE WHEN event_type = 'reply' THEN 1 ELSE 0 END) as reply_count,
      SUM(CASE WHEN event_type = 'reply' THEN diff_token ELSE 0 END) as diff_token
    FROM ai_usage_logs
    WHERE ${whereClause}
    GROUP BY time_label
    ORDER BY time_label ASC
  `;

  try {
    const stmt = db.prepare(sql);
    return stmt.all(...params) as any[];
  } catch (err: any) {
    console.error('[UsageLog] 查询统计失败:', err.message);
    return [];
  }
}

export { insertUsageLog, getLastReplyToken, getUsageStats, calculateDiffToken };

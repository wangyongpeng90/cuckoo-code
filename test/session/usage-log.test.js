'use strict';
/**
 * [261031-x7k9p2] usage-log 数据层测试
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { insertUsageLog, getLastReplyToken, getUsageStats, calculateDiffToken } from '../../src/session/usage-log.js';

test('insertUsageLog / getUsageStats 基础读写与聚合', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logic_id TEXT,
      profile_id TEXT,
      provider_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      total_token INTEGER DEFAULT 0,
      diff_token INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_time ON ai_usage_logs(created_at);
  `);

  // 模拟插入数据
  insertUsageLog(db, 'logic-1', 'prof-A', 'deepseek', 'send');
  insertUsageLog(db, 'logic-1', 'prof-A', 'deepseek', 'reply', 100, 100);
  
  insertUsageLog(db, 'logic-2', 'prof-A', 'deepseek', 'send');
  insertUsageLog(db, 'logic-2', 'prof-A', 'deepseek', 'reply', 200, 150);

  insertUsageLog(db, 'logic-1', 'prof-A', 'chatgpt', 'send');
  insertUsageLog(db, 'logic-1', 'prof-A', 'chatgpt', 'reply', 0, 0);

  // 验证 getLastReplyToken
  assert.strictEqual(getLastReplyToken(db, 'logic-1'), 100); // chatgpt 是 0，但前面有 deepseek 100
  assert.strictEqual(getLastReplyToken(db, 'logic-2'), 200);
  assert.strictEqual(getLastReplyToken(db, 'logic-unknown'), 0);

  // 验证 getUsageStats（按天）
  const stats = getUsageStats(db, 'day', '2000-01-01 00:00:00', '2099-01-01 00:00:00');
  assert.strictEqual(stats.length, 1, '应该聚合到同一天');
  
  const today = stats[0];
  assert.strictEqual(today.send_count, 3, '发送总数为3');
  assert.strictEqual(today.reply_count, 3, '回复总数为3');
  assert.strictEqual(today.diff_token, 250, 'Token差值总和为 100+150+0=250');
});


test('calculateDiffToken 差值计算边界情况', () => {
  // 正常递增
  assert.strictEqual(calculateDiffToken(8000, 5000), 3000);
  // 首次对话
  assert.strictEqual(calculateDiffToken(5000, 0), 5000);
  // 上下文压缩/变短（total 变小）
  assert.strictEqual(calculateDiffToken(4000, 8000), 4000);
  // 当前 total 为 0
  assert.strictEqual(calculateDiffToken(0, 5000), 0);
  // 保持不变（如重试同一条）
  assert.strictEqual(calculateDiffToken(5000, 5000), 5000);
});

test('getUsageStats 按时/分 聚合', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logic_id TEXT,
      profile_id TEXT,
      provider_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      total_token INTEGER DEFAULT 0,
      diff_token INTEGER DEFAULT 0
    );
  `);

  // 手动插入不同时间的数据以测试粒度
  db.prepare('INSERT INTO ai_usage_logs (event_type, created_at, diff_token, provider_id) VALUES (?, ?, ?, ?)')
    .run('reply', '2026-10-31 10:00:05', 10, 'deepseek');
  db.prepare('INSERT INTO ai_usage_logs (event_type, created_at, diff_token, provider_id) VALUES (?, ?, ?, ?)')
    .run('reply', '2026-10-31 10:00:30', 20, 'deepseek');
  db.prepare('INSERT INTO ai_usage_logs (event_type, created_at, diff_token, provider_id) VALUES (?, ?, ?, ?)')
    .run('reply', '2026-10-31 11:00:05', 30, 'deepseek');

  const byHour = getUsageStats(db, 'hour', '2026-10-31 00:00:00', '2026-10-31 23:59:59');
  assert.strictEqual(byHour.length, 2, '应该聚合到2个小时');
  assert.strictEqual(byHour[0].time_label, '2026-10-31 10');
  assert.strictEqual(byHour[0].diff_token, 30);
  assert.strictEqual(byHour[1].time_label, '2026-10-31 11');
  assert.strictEqual(byHour[1].diff_token, 30);

  const byMin = getUsageStats(db, 'minute', '2026-10-31 00:00:00', '2026-10-31 23:59:59');
  assert.strictEqual(byMin.length, 2, '应该聚合到2个分钟（10:00 和 11:00）');
  assert.strictEqual(byMin[0].time_label, '2026-10-31 10:00');
  assert.strictEqual(byMin[0].diff_token, 30);
});

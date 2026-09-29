'use strict';
/**
 * 主进程设置存储测试（src/app/settings-store.ts）
 * node 环境：通过 setSettingsDir 注入 test/tmp 下的临时目录，不触达真实 userData。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const tmpDir = path.join(process.cwd(), 'test', 'tmp', 'settings-store-test');

let store;

beforeEach(async () => {
  vi.resetModules();
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  store = await import('../../src/app/settings-store.js');
  store.setSettingsDir(tmpDir);
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function filePath() {
  return path.join(tmpDir, 'settings.json');
}

test('文件不存在时返回完整默认值', () => {
  const s = store.getSettings();
  assert.strictEqual(s.retryEnabled, true);
  assert.strictEqual(s.retryDelayMin, 4000);
  assert.strictEqual(s.retryDelayMax, 10000);
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(s.retry429Delay, 60000);
  assert.strictEqual(s.retry429Count, 20);
  assert.strictEqual(s.retryPrompt, '刚才的回复似乎中断了，请重新完整回答上一个问题。');
  assert.strictEqual(s.xhrIdleTimeout, 300000);
  assert.strictEqual(s.watchdogPrompt, '请继续');
  assert.strictEqual(s.watchdogCount, 3);
  assert.strictEqual(s.sendDelayMin, 2000);
  assert.strictEqual(s.sendDelayMax, 4000);
  assert.strictEqual(s.attachDelayMin, 500);
  assert.strictEqual(s.attachDelayMax, 1000);
  assert.strictEqual(s.autoCompactEnabled, false);
  assert.strictEqual(s.autoCompactThreshold, 80);
  // 恰好 16 个字段
  assert.strictEqual(Object.keys(s).length, 16);
});

test('saveSettings 部分写入并持久化，未涉及字段保持默认', () => {
  const s = store.saveSettings({ retryCount: 5, watchdogPrompt: '继续干活' });
  assert.strictEqual(s.retryCount, 5);
  assert.strictEqual(s.watchdogPrompt, '继续干活');
  assert.strictEqual(s.retryDelayMin, 4000);
  // 重新读取（跨"进程"语义：直接读文件）
  const reread = store.getSettings();
  assert.strictEqual(reread.retryCount, 5);
  assert.strictEqual(reread.watchdogPrompt, '继续干活');
  assert.strictEqual(fs.existsSync(filePath()), true);
});

test('坏 JSON 文件回退默认值且不抛错', () => {
  fs.writeFileSync(filePath(), '{broken json', 'utf-8');
  const s = store.getSettings();
  assert.strictEqual(s.retryCount, 10);
});

test('文件中的未知键被忽略（不进返回值，保存后被清除）', () => {
  fs.writeFileSync(filePath(), JSON.stringify({ unknownKey: 1, retryCount: 7 }), 'utf-8');
  const s = store.getSettings();
  assert.strictEqual(s.retryCount, 7);
  assert.strictEqual('unknownKey' in s, false);
  store.saveSettings({ retryDelayMin: 1000 });
  const raw = JSON.parse(fs.readFileSync(filePath(), 'utf-8'));
  assert.strictEqual('unknownKey' in raw, false);
  assert.strictEqual(raw.retryCount, 7);
});

test('字段类型非法时回退该字段默认值', () => {
  fs.writeFileSync(filePath(), JSON.stringify({
    retryCount: 'abc',          // 非数字
    retryEnabled: 'yes',        // 非布尔
    retryPrompt: '',            // 空字符串
    retryDelayMin: 1234,
  }), 'utf-8');
  const s = store.getSettings();
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(s.retryEnabled, true);
  assert.strictEqual(s.retryPrompt.length > 0, true);
  assert.strictEqual(s.retryDelayMin, 1234);
});

test('saveSettings 忽略非法补丁值与未知键', () => {
  const s = store.saveSettings({ retryCount: 'x', bogus: 1, watchdogCount: 9 });
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(s.watchdogCount, 9);
  assert.strictEqual('bogus' in s, false);
});

test('resetSettings 恢复默认并持久化，保留 migrated 标记', () => {
  store.saveSettings({ retryCount: 3 });
  store.applyLegacyMigration({ retryCount: 8 });
  const s = store.resetSettings();
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(store.isMigrated(), true);
  const raw = JSON.parse(fs.readFileSync(filePath(), 'utf-8'));
  assert.strictEqual(raw.retryCount, 10);
  assert.strictEqual(raw.migrated, true);
});

test('resetSettings 保留 autoCompact 配置（恢复默认不含自动压缩，旧 localStorage 语义）', () => {
  store.saveSettings({ autoCompactEnabled: true, autoCompactThreshold: 55, retryCount: 3, watchdogCount: 9 });
  const s = store.resetSettings();
  // 其余字段回默认
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(s.watchdogCount, 3);
  // autoCompact 两字段保持现值
  assert.strictEqual(s.autoCompactEnabled, true);
  assert.strictEqual(s.autoCompactThreshold, 55);
  // 持久化到文件
  const raw = JSON.parse(fs.readFileSync(filePath(), 'utf-8'));
  assert.strictEqual(raw.autoCompactEnabled, true);
  assert.strictEqual(raw.autoCompactThreshold, 55);
});

test('旧数据迁移：首次写入并标记 migrated，第二次调用不再覆盖', () => {
  const applied1 = store.applyLegacyMigration({ retryCount: 42, retryPrompt: '旧提示词' });
  assert.strictEqual(applied1, true);
  assert.strictEqual(store.isMigrated(), true);
  let s = store.getSettings();
  assert.strictEqual(s.retryCount, 42);
  assert.strictEqual(s.retryPrompt, '旧提示词');
  // 第二次迁移调用：no-op，不覆盖现有设置
  const applied2 = store.applyLegacyMigration({ retryCount: 99 });
  assert.strictEqual(applied2, false);
  s = store.getSettings();
  assert.strictEqual(s.retryCount, 42);
});

test('迁移补丁中的非法值不写入', () => {
  const applied = store.applyLegacyMigration({ retryCount: 'bad', retryDelayMax: 8888 });
  assert.strictEqual(applied, true);
  const s = store.getSettings();
  assert.strictEqual(s.retryCount, 10);
  assert.strictEqual(s.retryDelayMax, 8888);
});

test('saveSettings 不影响 migrated 标记', () => {
  store.saveSettings({ retryCount: 1 });
  assert.strictEqual(store.isMigrated(), false);
  store.applyLegacyMigration({});
  assert.strictEqual(store.isMigrated(), true);
  store.saveSettings({ retryCount: 2 });
  assert.strictEqual(store.isMigrated(), true);
});

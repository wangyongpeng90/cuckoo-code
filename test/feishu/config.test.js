'use strict';
/**
 * feishu/config 测试
 *
 * 隔离：用 CUCKOO_HOME 把用户目录指向临时目录（真实读写，不 mock 内部逻辑）。
 * 覆盖：默认值、读写往返、字段清洗、部分更新保留原值、无效 JSON 容错。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), 'cuckoo-feishu-config-test');
const FAKE_HOME = path.join(TMP, 'home');

let cfg;
let oldHome;

beforeEach(async () => {
  vi.resetModules();
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  cfg = await import('../../src/feishu/config.js');
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('无配置文件时返回默认值（未启用）', () => {
  const c = cfg.readConfig();
  assert.strictEqual(c.appId, '');
  assert.strictEqual(c.appSecret, '');
  assert.strictEqual(c.enabled, false);
  assert.strictEqual(c.targetOpenId, '');
  assert.strictEqual(c.pushUserMessage, true);
  assert.strictEqual(c.pushAiReply, true);
  assert.strictEqual(c.pushToolStatus, true);
  assert.strictEqual(c.pushToolName, false);
});

test('写入后读回（读写往返）', () => {
  const ok = cfg.writeConfig({ appId: 'cli_abc', appSecret: 'secret', enabled: true });
  assert.strictEqual(ok, true);
  const c = cfg.readConfig();
  assert.strictEqual(c.appId, 'cli_abc');
  assert.strictEqual(c.appSecret, 'secret');
  assert.strictEqual(c.enabled, true);
});

test('部分更新：未传字段保留原值', () => {
  cfg.writeConfig({ appId: 'cli_1', appSecret: 's1', enabled: true, pushAiReply: false });
  // 只改 pushToolName，其余不动
  cfg.writeConfig({ pushToolName: true });
  const c = cfg.readConfig();
  assert.strictEqual(c.appId, 'cli_1');
  assert.strictEqual(c.appSecret, 's1');
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(c.pushAiReply, false);
  assert.strictEqual(c.pushToolName, true);
});

test('appId / appSecret 写入时 trim', () => {
  cfg.writeConfig({ appId: '  cli_x  ', appSecret: '  sec  ' });
  const c = cfg.readConfig();
  assert.strictEqual(c.appId, 'cli_x');
  assert.strictEqual(c.appSecret, 'sec');
});

test('targetOpenId 可读写（记录推送目标）', () => {
  cfg.writeConfig({ targetOpenId: 'ou_123' });
  assert.strictEqual(cfg.readConfig().targetOpenId, 'ou_123');
});

test('无效 JSON 容错：返回默认值不抛异常', () => {
  const file = path.join(FAKE_HOME, 'feishu.json');
  fs.writeFileSync(file, '{ 这不是合法 JSON', 'utf-8');
  const c = cfg.readConfig();
  assert.strictEqual(c.enabled, false);
  assert.strictEqual(c.appId, '');
});

test('类型清洗：enabled 非布尔时视为 false', () => {
  const file = path.join(FAKE_HOME, 'feishu.json');
  fs.writeFileSync(file, JSON.stringify({ enabled: 'yes', appId: 123 }), 'utf-8');
  const c = cfg.readConfig();
  assert.strictEqual(c.enabled, false);
  assert.strictEqual(c.appId, '');
});

test('pushImages 字段：默认 true、读写往返、显式 false 可关闭', () => {
  const c1 = cfg.readConfig();
  assert.strictEqual(c1.pushImages, true);
  cfg.writeConfig({ pushImages: false });
  assert.strictEqual(cfg.readConfig().pushImages, false);
  // 部分更新保留原值
  cfg.writeConfig({ appId: 'cli_x' });
  const c3 = cfg.readConfig();
  assert.strictEqual(c3.pushImages, false);
  assert.strictEqual(c3.appId, 'cli_x');
  cfg.writeConfig({ pushImages: true });
  assert.strictEqual(cfg.readConfig().pushImages, true);
});

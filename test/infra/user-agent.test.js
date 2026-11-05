'use strict';
/**
 * infra/user-agent 测试（纯函数）
 *
 * 关键：UA 里的 Chrome 版本必须来自 process.versions.chrome（真实内核），
 * 否则与 sec-ch-ua 矛盾，会被 Google 判定"浏览器不安全"。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { buildChromeUserAgent, chromeMajor, buildUserAgentMetadata, getPlatformProfile } from '../../src/infra/user-agent.js';

test('chromeMajor 取主版本号', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '152.0.7977.130', configurable: true });
    assert.strictEqual(chromeMajor(), '152');
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

test('chromeMajor 无版本时回退 0', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '', configurable: true });
    assert.strictEqual(chromeMajor(), '0');
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

test('buildChromeUserAgent 使用真实内核版本（非写死）', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '152.0.7977.130', configurable: true });
    const ua = buildChromeUserAgent();
    assert.ok(ua.includes('Chrome/152.0.0.0'), 'UA 应含真实主版本 152');
    assert.ok(!ua.includes('Electron'), 'UA 不应含 Electron 标识');
    assert.ok(ua.includes('Safari/537.36'));
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

test('buildChromeUserAgent 随内核版本变化（防写死回归）', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '160.1.2.3', configurable: true });
    assert.ok(buildChromeUserAgent().includes('Chrome/160.0.0.0'));
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

// ================= 平台感知（Chromium 源码冻结常量）=================

test('getPlatformProfile 三平台返回 Chromium 源码冻结常量', () => {
  const win = getPlatformProfile('win32', 'x64');
  assert.strictEqual(win.uaPlatform, 'Windows NT 10.0; Win64; x64');
  assert.strictEqual(win.chUaPlatform, '"Windows"');
  assert.strictEqual(win.uadPlatform, 'Windows');

  const mac = getPlatformProfile('darwin', 'arm64');
  assert.strictEqual(mac.uaPlatform, 'Macintosh; Intel Mac OS X 10_15_7');
  assert.strictEqual(mac.chUaPlatform, '"macOS"');
  assert.strictEqual(mac.uadPlatform, 'macOS');
  assert.strictEqual(mac.architecture, 'arm', 'Apple Silicon 架构应为 arm');

  const macIntel = getPlatformProfile('darwin', 'x64');
  assert.strictEqual(macIntel.architecture, 'x86');

  const linux = getPlatformProfile('linux', 'x64');
  assert.strictEqual(linux.uaPlatform, 'X11; Linux x86_64');
  assert.strictEqual(linux.chUaPlatform, '"Linux"');
  assert.strictEqual(linux.uadPlatform, 'Linux');
  assert.strictEqual(linux.platformVersion, '', 'Linux 的 platformVersion 为空串（对齐真实 Chrome）');
});

test('buildChromeUserAgent 三平台 UA 串正确且不含 Electron', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '152.0.7977.130', configurable: true });

    const win = buildChromeUserAgent('win32', 'x64');
    assert.ok(win.startsWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), win);
    assert.ok(win.includes('Chrome/152.0.0.0'));

    const mac = buildChromeUserAgent('darwin', 'arm64');
    assert.ok(mac.startsWith('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), mac);
    assert.ok(mac.includes('Chrome/152.0.0.0'));

    const linux = buildChromeUserAgent('linux', 'x64');
    assert.ok(linux.startsWith('Mozilla/5.0 (X11; Linux x86_64)'), linux);
    assert.ok(linux.includes('Chrome/152.0.0.0'));

    for (const ua of [win, mac, linux]) {
      assert.ok(!ua.includes('Electron'), 'UA 不应含 Electron');
      assert.ok(ua.endsWith('Safari/537.36'), 'UA 应以 Safari/537.36 结尾');
    }
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

// ================= 客户端提示元数据（CDP userAgentMetadata）=================

test('buildUserAgentMetadata 必含 Google Chrome 品牌（sec-ch-ua 的关键）', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '152.0.7977.130', configurable: true });
    const m = buildUserAgentMetadata();
    const chrome = m.brands.find((b) => b.brand === 'Google Chrome');
    assert.ok(chrome, '必须包含 Google Chrome 品牌');
    assert.strictEqual(chrome.version, '152', '版本取真实主版本');
    assert.strictEqual(m.brands[0].brand, 'Google Chrome', 'Google Chrome 排在最前');
    assert.ok(m.brands.some((b) => b.brand === 'Chromium'), '仍保留 Chromium 品牌');
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

test('buildUserAgentMetadata 沿用运行时真实品牌（GREASE 名不硬编码）', () => {
  const prev = process.versions.chrome;
  try {
    Object.defineProperty(process.versions, 'chrome', { value: '152.0.7977.130', configurable: true });
    // 模拟从页面读回的真实值：Windows 11 的 platformVersion 19.0.0 + GREASE 名 Not?A_Brand
    const runtime = {
      brands: [
        { brand: 'Not?A_Brand', version: '24' },
        { brand: 'Chromium', version: '152' },
      ],
      platformVersion: '19.0.0',
      architecture: 'x86',
      bitness: '64',
      fullVersion: '152.0.7977.130',
    };
    const m = buildUserAgentMetadata(runtime);
    assert.deepStrictEqual(m.brands.map((b) => b.brand), ['Google Chrome', 'Not?A_Brand', 'Chromium']);
    assert.strictEqual(m.brands[1].version, '24', 'GREASE 版本沿用运行时值');
    assert.strictEqual(m.platformVersion, '19.0.0', 'platformVersion 用运行时真实值（不写死 10.0.0）');
    assert.strictEqual(m.fullVersion, '152.0.7977.130');
    assert.deepStrictEqual(
      m.fullVersionList.map((b) => b.brand + '=' + b.version),
      ['Google Chrome=152.0.7977.130', 'Not?A_Brand=24.0.0.0', 'Chromium=152.0.7977.130'],
      'GREASE 品牌用 x.0.0.0，Chrome/Chromium 用完整版本'
    );
  } finally {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true });
  }
});

test('buildUserAgentMetadata 无运行时数据时给出自洽兜底', () => {
  const m = buildUserAgentMetadata(undefined, 'win32', 'x64');
  assert.strictEqual(m.platform, 'Windows');
  assert.ok(m.brands.some((b) => b.brand === 'Google Chrome'));
  assert.ok(m.brands.some((b) => b.brand === 'Chromium'));
  assert.strictEqual(m.mobile, false);
  assert.strictEqual(m.wow64, false);
  assert.strictEqual(m.model, '');
});

test('buildUserAgentMetadata 的 platform 随平台变化', () => {
  assert.strictEqual(buildUserAgentMetadata(undefined, 'win32', 'x64').platform, 'Windows');
  assert.strictEqual(buildUserAgentMetadata(undefined, 'darwin', 'arm64').platform, 'macOS');
  assert.strictEqual(buildUserAgentMetadata(undefined, 'linux', 'x64').platform, 'Linux');
});

test('默认参数走 process.platform（Windows 环境回归保护）', () => {
  // 测试机是 Windows：默认调用应与显式传 win32 一致
  if (process.platform === 'win32') {
    assert.strictEqual(buildChromeUserAgent(), buildChromeUserAgent('win32', process.arch));
    assert.strictEqual(buildUserAgentMetadata().platform, 'Windows');
  }
});

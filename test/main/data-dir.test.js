'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolveDataDir, isPortableMode, portableFlagPath } = require('../../src/main/data-dir');

const DEFAULT_DIR = path.join('C:', 'Users', 'u', 'AppData', 'Roaming', 'cuckoo-ai-pro-session');
const EXE_DIR = path.join('D:', 'Apps', 'Cuckoo-Code');

function existsMarker(names) {
  return (p) => names.some((n) => path.resolve(p) === path.resolve(n));
}

test('默认：无标记无环境变量 → 使用默认目录，非便携', () => {
  const r = resolveDataDir({ exeDir: EXE_DIR, env: {}, existsSync: () => false, defaultDir: DEFAULT_DIR });
  assert.strictEqual(r.dir, DEFAULT_DIR);
  assert.strictEqual(r.portable, false);
  assert.strictEqual(r.source, 'default');
});

test('便携：exe 同级存在 portable.flag → 数据写入 exe 目录 data/，portable=true', () => {
  const r = resolveDataDir({
    exeDir: EXE_DIR,
    env: {},
    existsSync: existsMarker([portableFlagPath(EXE_DIR)]),
    defaultDir: DEFAULT_DIR,
  });
  assert.strictEqual(r.dir, path.join(EXE_DIR, 'data'));
  assert.strictEqual(r.portable, true);
  assert.strictEqual(r.source, 'portable');
});

test('环境变量 CUCKOO_DATA_DIR 优先于便携标记与默认目录', () => {
  const r = resolveDataDir({
    exeDir: EXE_DIR,
    env: { CUCKOO_DATA_DIR: 'E:\\my-data' },
    existsSync: existsMarker([portableFlagPath(EXE_DIR)]),
    defaultDir: DEFAULT_DIR,
  });
  assert.strictEqual(r.dir, path.resolve('E:\\my-data'));
  assert.strictEqual(r.source, 'env');
});

test('环境变量存在时仍如实报告便携标记状态（决定更新 UX）', () => {
  const r = resolveDataDir({
    exeDir: EXE_DIR,
    env: { CUCKOO_DATA_DIR: 'E:\\my-data' },
    existsSync: existsMarker([portableFlagPath(EXE_DIR)]),
    defaultDir: DEFAULT_DIR,
  });
  assert.strictEqual(r.portable, true);
});

test('环境变量为空白字符串时视为未设置', () => {
  const r = resolveDataDir({ exeDir: EXE_DIR, env: { CUCKOO_DATA_DIR: '   ' }, existsSync: () => false, defaultDir: DEFAULT_DIR });
  assert.strictEqual(r.source, 'default');
});

test('exeDir 为空时永远不是便携模式', () => {
  assert.strictEqual(isPortableMode({ exeDir: '', existsSync: () => true }), false);
  const r = resolveDataDir({ exeDir: '', env: {}, existsSync: () => true, defaultDir: DEFAULT_DIR });
  assert.strictEqual(r.source, 'default');
});

test('标记在别的目录不算便携', () => {
  const other = path.join('C:', 'elsewhere');
  const r = resolveDataDir({
    exeDir: EXE_DIR,
    env: {},
    existsSync: existsMarker([portableFlagPath(other)]),
    defaultDir: DEFAULT_DIR,
  });
  assert.strictEqual(r.source, 'default');
});

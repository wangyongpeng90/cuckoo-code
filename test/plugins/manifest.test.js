'use strict';
/**
 * plugins 清单与路径测试
 *
 * 隔离：CUCKOO_HOME 指向临时目录（paths 在调用时读该变量，无需 resetModules）。
 * 本模块不依赖 electron，可直接测。
 */
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  validateManifest,
  parseManifest,
  readManifest,
  deriveContributes,
} from '../../src/plugins/manifest.js';
import {
  isValidPluginId,
  getPluginDir,
  getPluginsDir,
  getPluginsStateFile,
  getMarketCacheFile,
  getMarketConfigFile,
  listInstalledPluginDirs,
} from '../../src/plugins/paths.js';

const TMP = path.join(os.tmpdir(), 'cuckoo-plugins-test');
const FAKE_HOME = path.join(TMP, 'home');

let oldHome;

beforeEach(() => {
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
});

// ===== id 校验（安全关键：id 会直接作为目录名）=====

test('isValidPluginId: 接受合法 id', () => {
  assert.strictEqual(isValidPluginId('my-plugin'), true);
  assert.strictEqual(isValidPluginId('a'), true);
  assert.strictEqual(isValidPluginId('plugin2'), true);
});

test('isValidPluginId: 拒绝路径逃逸与非法字符', () => {
  // 这些若通过，就会写出 ~/.cuckoo/plugins/../.. 之类的逃逸路径
  assert.strictEqual(isValidPluginId('..'), false);
  assert.strictEqual(isValidPluginId('.'), false);
  assert.strictEqual(isValidPluginId('a/b'), false);
  assert.strictEqual(isValidPluginId('a\\b'), false);
  assert.strictEqual(isValidPluginId('../evil'), false);
  assert.strictEqual(isValidPluginId('C:\\evil'), false);
});

test('isValidPluginId: 拒绝大小写与非 kebab 形式', () => {
  assert.strictEqual(isValidPluginId('MyPlugin'), false);
  assert.strictEqual(isValidPluginId('my_plugin'), false);
  assert.strictEqual(isValidPluginId('-leading'), false);
  assert.strictEqual(isValidPluginId('my.plugin'), false);
});

test('isValidPluginId: 拒绝空值与超长', () => {
  assert.strictEqual(isValidPluginId(''), false);
  assert.strictEqual(isValidPluginId('a'.repeat(65)), false);
  assert.strictEqual(isValidPluginId(null), false);
  assert.strictEqual(isValidPluginId(123), false);
});

// ===== 清单校验 =====

test('validateManifest: 合法清单（含可选字段）', () => {
  const r = validateManifest({
    id: 'demo-plugin',
    name: '演示插件',
    version: '1.0.0',
    description: '一句话',
    author: 'someone',
    minAppVersion: '0.8.0',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.manifest.id, 'demo-plugin');
  assert.strictEqual(r.manifest.name, '演示插件');
  assert.strictEqual(r.manifest.version, '1.0.0');
});

test('validateManifest: 只有必填字段也能通过', () => {
  const r = validateManifest({ id: 'demo', name: 'Demo' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.manifest.version, undefined);
});

test('validateManifest: 缺 id / 缺 name 均失败且报因', () => {
  const noId = validateManifest({ name: 'Demo' });
  assert.strictEqual(noId.ok, false);
  assert.ok(noId.error.includes('id'));

  const noName = validateManifest({ id: 'demo' });
  assert.strictEqual(noName.ok, false);
  assert.ok(noName.error.includes('name'));
});

test('validateManifest: id 非法时明确报因', () => {
  const r = validateManifest({ id: '../evil', name: 'Evil' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('kebab-case'));
});

test('validateManifest: 拒绝非对象（数组/null/字符串）', () => {
  assert.strictEqual(validateManifest([]).ok, false);
  assert.strictEqual(validateManifest(null).ok, false);
  assert.strictEqual(validateManifest('x').ok, false);
  assert.strictEqual(validateManifest(42).ok, false);
});

test('validateManifest: 空白字符串不算有值', () => {
  assert.strictEqual(validateManifest({ id: '   ', name: 'x' }).ok, false);
  assert.strictEqual(validateManifest({ id: 'demo', name: '  ' }).ok, false);
});

// ===== JSON 解析 =====

test('parseManifest: 非法 JSON 报解析失败', () => {
  const r = parseManifest('{ not json');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('JSON 解析失败'));
});

test('parseManifest: 合法 JSON 文本', () => {
  const r = parseManifest('{"id":"demo","name":"Demo"}');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.manifest.id, 'demo');
});

// ===== 读文件 =====

test('readManifest: 文件不存在时报因', () => {
  const r = readManifest(path.join(TMP, 'nope'));
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('读取 plugin.json 失败'));
});

test('readManifest: 正常读取', () => {
  const dir = path.join(TMP, 'p1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), '{"id":"p1","name":"P1"}', 'utf-8');
  const r = readManifest(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.manifest.id, 'p1');
});

// ===== 贡献项派生 =====

test('deriveContributes: 空插件目录', () => {
  const dir = path.join(TMP, 'empty');
  fs.mkdirSync(dir, { recursive: true });
  const c = deriveContributes(dir);
  assert.deepStrictEqual(c.skills, []);
  assert.deepStrictEqual(c.agents, []);
  assert.deepStrictEqual(c.rules, []);
  assert.strictEqual(c.mcp, false);
  assert.deepStrictEqual(c.providers, []);
});

test('deriveContributes: 按约定识别各项', () => {
  const dir = path.join(TMP, 'full');
  fs.mkdirSync(path.join(dir, 'skills', 'review'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'review', 'SKILL.md'), '# r', 'utf-8');
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agents', 'explore.md'), '# e', 'utf-8');
  fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'rules', 'style.md'), '# s', 'utf-8');
  fs.writeFileSync(path.join(dir, 'mcp.json'), '{"mcpServers":{}}', 'utf-8');
  fs.mkdirSync(path.join(dir, 'providers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'providers', 'custom.js'), 'module.exports={}', 'utf-8');

  const c = deriveContributes(dir);
  assert.deepStrictEqual(c.skills, ['review']);
  assert.deepStrictEqual(c.agents, ['explore']);
  assert.deepStrictEqual(c.rules, ['style']);
  assert.strictEqual(c.mcp, true);
  assert.deepStrictEqual(c.providers, ['custom.js']);
});

test('deriveContributes: skills 无 SKILL.md 的目录不计数', () => {
  const dir = path.join(TMP, 'noskill');
  fs.mkdirSync(path.join(dir, 'skills', 'real'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'real', 'SKILL.md'), '# r', 'utf-8');
  // 只有目录、没有 SKILL.md —— scanner 会跳过，这里也不该计数
  fs.mkdirSync(path.join(dir, 'skills', 'hollow'), { recursive: true });

  const c = deriveContributes(dir);
  assert.deepStrictEqual(c.skills, ['real']);
});

test('deriveContributes: providers 只认 .js（一层，不递归）', () => {
  const dir = path.join(TMP, 'prov');
  fs.mkdirSync(path.join(dir, 'providers', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'providers', 'a.js'), 'x', 'utf-8');
  fs.writeFileSync(path.join(dir, 'providers', 'b.txt'), 'x', 'utf-8');
  fs.writeFileSync(path.join(dir, 'providers', 'nested', 'c.js'), 'x', 'utf-8');
  const c = deriveContributes(dir);
  assert.deepStrictEqual(c.providers, ['a.js']);
});

// ===== 路径 =====

test('路径：均锚定 CUCKOO_HOME', () => {
  assert.strictEqual(getPluginsDir(), path.join(FAKE_HOME, 'plugins'));
  assert.strictEqual(getPluginDir('demo'), path.join(FAKE_HOME, 'plugins', 'demo'));
  assert.strictEqual(getPluginsStateFile(), path.join(FAKE_HOME, 'plugins-state.json'));
  assert.strictEqual(getMarketCacheFile(), path.join(FAKE_HOME, 'plugin-market-cache.json'));
  assert.strictEqual(getMarketConfigFile(), path.join(FAKE_HOME, 'plugin-market.json'));
});

test('listInstalledPluginDirs: 目录不存在时返回空数组', () => {
  assert.deepStrictEqual(listInstalledPluginDirs(), []);
});

test('listInstalledPluginDirs: 只返回含 plugin.json 的目录', () => {
  const root = getPluginsDir();
  fs.mkdirSync(path.join(root, 'good'), { recursive: true });
  fs.writeFileSync(path.join(root, 'good', 'plugin.json'), '{"id":"good","name":"G"}', 'utf-8');
  // 半途失败的残骸：无 plugin.json，不应被当成插件
  fs.mkdirSync(path.join(root, 'half-written'), { recursive: true });
  // 普通文件，不是目录
  fs.writeFileSync(path.join(root, 'stray.txt'), 'x', 'utf-8');

  const dirs = listInstalledPluginDirs();
  assert.strictEqual(dirs.length, 1);
  assert.strictEqual(path.basename(dirs[0]), 'good');
});

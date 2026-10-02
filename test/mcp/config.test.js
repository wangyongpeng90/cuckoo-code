'use strict';
/**
 * mcp/config 测试（项目级 + 用户级双路径）
 *
 * 隔离：用环境变量 CUCKOO_HOME 把"用户级目录"指向临时目录；
 * electron 的 app.getPath 用 createRequire mock 指向临时目录。
 * 两者都是外部边界，符合"只 mock 外部边界"原则。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
// 直接引子模块（不走 plugins barrel —— 那会拉进 http.ts，撞上本文件对 node:module 的 mock）
import { setPluginEnabled } from '../../src/plugins/state.js';
import { getPluginsDir } from '../../src/plugins/paths.js';

const TMP = path.join(os.tmpdir(), 'cuckoo-mcp-config-test');
const FAKE_HOME = path.join(TMP, 'home');
const USER_DATA = path.join(TMP, 'userdata');
const PROJ1 = path.join(TMP, 'proj1');
const PROJ2 = path.join(TMP, 'proj2');

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRequire: () => (id) => {
      if (id === 'electron') return { app: { getPath: () => USER_DATA } };
      throw new Error('unexpected require: ' + id);
    },
  };
});

let cfg;
let oldHome;

function userConfigFile() { return path.join(FAKE_HOME, 'mcp.json'); }
function projConfigFile(p) { return path.join(p, '.cuckoo', 'mcp.json'); }

beforeEach(async () => {
  vi.resetModules();
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(PROJ1, { recursive: true });
  fs.mkdirSync(PROJ2, { recursive: true });
  cfg = await import('../../src/mcp/config.js');
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
});

test('无任何配置时 getServers 为空', () => {
  assert.deepStrictEqual(cfg.getServers(null), []);
});

test('upsertServer 写入用户级配置（stdio）', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'server'] });
  const raw = JSON.parse(fs.readFileSync(userConfigFile(), 'utf-8'));
  assert.strictEqual(raw.mcpServers.fs.command, 'npx');
  assert.deepStrictEqual(raw.mcpServers.fs.args, ['-y', 'server']);
});

test('upsertServer 写入 http 配置（带 url/headers）', () => {
  cfg.upsertServer({ name: 'db', type: 'http', url: 'https://x', headers: { a: '1' } });
  const raw = JSON.parse(fs.readFileSync(userConfigFile(), 'utf-8'));
  assert.strictEqual(raw.mcpServers.db.url, 'https://x');
  assert.deepStrictEqual(raw.mcpServers.db.headers, { a: '1' });
  assert.strictEqual(raw.mcpServers.db.command, undefined);
});

test('getServers 默认启用，type 由 url 决定', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx' });
  cfg.upsertServer({ name: 'db', type: 'http', url: 'https://x' });
  const list = cfg.getServers(PROJ1);
  const fsS = list.find(s => s.name === 'fs');
  const dbS = list.find(s => s.name === 'db');
  assert.strictEqual(fsS.type, 'stdio');
  assert.strictEqual(fsS.enabled, true, '默认启用');
  assert.strictEqual(dbS.type, 'http');
});

test('setServerEnabled(false) 后 getEnabledServers 不含它', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx' });
  cfg.setServerEnabled('fs', false, null);
  assert.strictEqual(cfg.getServers(null).find(s => s.name === 'fs').enabled, false);
  assert.strictEqual(cfg.getEnabledServers(null).length, 0);
});

test('removeServer 同时清配置与状态', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'npx' });
  cfg.setServerEnabled('fs', false, null);
  cfg.removeServer('fs');
  assert.strictEqual(cfg.getServers(null).length, 0);
  const raw = JSON.parse(fs.readFileSync(userConfigFile(), 'utf-8'));
  assert.strictEqual(raw.mcpServers.fs, undefined);
});

test('upsertServer 覆盖同名 server', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'a' });
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'b' });
  const raw = JSON.parse(fs.readFileSync(userConfigFile(), 'utf-8'));
  assert.strictEqual(raw.mcpServers.fs.command, 'b');
  assert.strictEqual(cfg.getServers(null).length, 1);
});

// ========== 项目级 + 用户级 ==========

test('项目级覆盖用户级同名 server', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'user-cmd' });
  fs.mkdirSync(path.join(PROJ1, '.cuckoo'), { recursive: true });
  fs.writeFileSync(projConfigFile(PROJ1), JSON.stringify({
    mcpServers: { fs: { command: 'proj-cmd' } }
  }));
  const list = cfg.getServers(PROJ1);
  const fsS = list.find(s => s.name === 'fs');
  assert.strictEqual(fsS.command, 'proj-cmd', '项目级优先');
  assert.strictEqual(fsS.source, 'project');
});

test('不同项目读到不同的项目级配置', () => {
  fs.mkdirSync(path.join(PROJ1, '.cuckoo'), { recursive: true });
  fs.writeFileSync(projConfigFile(PROJ1), JSON.stringify({ mcpServers: { onlyP1: { command: 'x' } } }));
  assert.strictEqual(cfg.getServers(PROJ1).length, 1);
  assert.strictEqual(cfg.getServers(PROJ2).length, 0);
});

test('用户级 server 在所有项目都可见', () => {
  cfg.upsertServer({ name: 'global', type: 'stdio', command: 'g' });
  assert.strictEqual(cfg.getServers(PROJ1).find(s => s.name === 'global').source, 'user');
  assert.strictEqual(cfg.getServers(PROJ2).find(s => s.name === 'global').source, 'user');
});

test('项目级 server 的状态存项目级（不污染用户级）', () => {
  fs.mkdirSync(path.join(PROJ1, '.cuckoo'), { recursive: true });
  fs.writeFileSync(projConfigFile(PROJ1), JSON.stringify({ mcpServers: { p: { command: 'x' } } }));
  cfg.setServerEnabled('p', false, PROJ1);
  const st = JSON.parse(fs.readFileSync(path.join(PROJ1, '.cuckoo', 'mcp-state.json'), 'utf-8'));
  assert.strictEqual(st.p, false);
  const ustateFile = path.join(FAKE_HOME, 'mcp-state.json');
  if (fs.existsSync(ustateFile)) {
    const ustate = JSON.parse(fs.readFileSync(ustateFile, 'utf-8'));
    assert.strictEqual(ustate.p, undefined);
  }
});

// ========== 首次迁移 ==========

test('migrateLegacy：新位置无文件时，把旧 userData/mcp.json 复制过去', () => {
  fs.writeFileSync(path.join(USER_DATA, 'mcp.json'), JSON.stringify({
    mcpServers: { legacy: { command: 'old' } }
  }));
  cfg.migrateLegacy();
  const raw = JSON.parse(fs.readFileSync(userConfigFile(), 'utf-8'));
  assert.strictEqual(raw.mcpServers.legacy.command, 'old');
  assert.ok(fs.existsSync(path.join(USER_DATA, 'mcp.json')), '旧文件应保留');
});

test('migrateLegacy：新位置已有文件时不动', () => {
  cfg.upsertServer({ name: 'newone', type: 'stdio', command: 'new' });
  fs.writeFileSync(path.join(USER_DATA, 'mcp.json'), JSON.stringify({
    mcpServers: { legacy: { command: 'old' } }
  }));
  cfg.migrateLegacy();
  const raw = JSON.parse(fs.readFileSync(userConfigFile(), 'utf-8'));
  assert.strictEqual(raw.mcpServers.newone.command, 'new');
  assert.strictEqual(raw.mcpServers.legacy, undefined, '不应被旧文件覆盖');
});

test('migrateLegacy：旧文件非法 JSON 时不动', () => {
  fs.writeFileSync(path.join(USER_DATA, 'mcp.json'), 'not json {{{');
  cfg.migrateLegacy();
  assert.ok(!fs.existsSync(userConfigFile()), '不应创建新文件');
});

// ========== 插件来源（topic 插件带来的 mcp.json）==========
// 安全语义：MCP server 定义会 spawn 子进程，与 providers/*.js 同级。
// 因此归 plugins-state.json 的 enabled（插件总开关）管，未启用时不出现。

/** 造一个带 mcp.json 的已安装插件 */
function makePluginWithMcp(id, servers) {
  const dir = path.join(getPluginsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id, name: id }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: servers }), 'utf-8');
  return dir;
}

function pluginServers(projectDir) {
  return cfg.getServers(projectDir).filter((s) => s.source === 'plugin');
}

test('插件 mcp.json：未授权时完全不出现（默认禁用）', () => {
  makePluginWithMcp('demo', { fs: { command: 'npx', args: ['-y', 'x'] } });
  assert.deepStrictEqual(pluginServers(null), []);
});

test('插件 mcp.json：授权后出现，且带 <插件id>: 命名空间前缀', () => {
  makePluginWithMcp('demo', { fs: { command: 'npx', args: ['-y', 'x'] } });
  setPluginEnabled('demo', true);

  const list = pluginServers(null);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'demo:fs');
  assert.strictEqual(list[0].command, 'npx');
  assert.deepStrictEqual(list[0].args, ['-y', 'x']);
  assert.strictEqual(list[0].type, 'stdio');
  assert.strictEqual(list[0].enabled, true, '已授权的插件 server 应可连接');
});

test('插件 mcp.json：与用户同名 server 不冲突（命名空间隔离）', () => {
  cfg.upsertServer({ name: 'fs', type: 'stdio', command: 'user-cmd' });
  makePluginWithMcp('demo', { fs: { command: 'plugin-cmd' } });
  setPluginEnabled('demo', true);

  const list = cfg.getServers(null);
  assert.strictEqual(list.length, 2, '两者应并存，不是覆盖');
  assert.strictEqual(list.find((s) => s.name === 'fs').command, 'user-cmd');
  assert.strictEqual(list.find((s) => s.name === 'demo:fs').command, 'plugin-cmd');
});

test('插件 mcp.json：关闭授权后消失', () => {
  makePluginWithMcp('demo', { fs: { command: 'npx' } });
  setPluginEnabled('demo', true);
  assert.strictEqual(pluginServers(null).length, 1);

  setPluginEnabled('demo', false);
  assert.deepStrictEqual(pluginServers(null), []);
});

test('插件 mcp.json：多个插件各自的 server 都在', () => {
  makePluginWithMcp('aaa', { x: { command: 'a' } });
  makePluginWithMcp('bbb', { y: { command: 'b' } });
  setPluginEnabled('aaa', true);
  setPluginEnabled('bbb', true);

  const names = pluginServers(null).map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['aaa:x', 'bbb:y']);
});

test('插件 mcp.json：授权状态按插件隔离', () => {
  makePluginWithMcp('aaa', { x: { command: 'a' } });
  makePluginWithMcp('bbb', { y: { command: 'b' } });
  setPluginEnabled('aaa', true);

  const names = pluginServers(null).map((s) => s.name);
  assert.deepStrictEqual(names, ['aaa:x'], '只有被授权的插件应出现');
});

test('插件 mcp.json：进入 getEnabledServers（会被真正连接）', () => {
  makePluginWithMcp('demo', { fs: { command: 'npx' } });
  setPluginEnabled('demo', true);
  assert.ok(
    cfg.getEnabledServers(null).some((s) => s.name === 'demo:fs'),
    '否则 server 出现了却永远不会被连接'
  );
});

test('插件 mcp.json：http 型 server 也支持', () => {
  makePluginWithMcp('demo', { remote: { url: 'https://x/mcp' } });
  setPluginEnabled('demo', true);
  const s = pluginServers(null)[0];
  assert.strictEqual(s.type, 'http');
  assert.strictEqual(s.url, 'https://x/mcp');
});

test('插件 mcp.json：文件损坏时不炸，且不影响其它来源', () => {
  const dir = path.join(getPluginsDir(), 'broken');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'broken', name: 'b' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'mcp.json'), '{ not json', 'utf-8');
  setPluginEnabled('broken', true);
  cfg.upsertServer({ name: 'mine', type: 'stdio', command: 'x' });

  const list = cfg.getServers(null);
  assert.strictEqual(list.find((s) => s.name === 'mine').command, 'x');
  assert.deepStrictEqual(pluginServers(null), []);
});

test('插件 mcp.json：无 mcp.json 的插件不产生任何 server', () => {
  const dir = path.join(getPluginsDir(), 'nomcp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'nomcp', name: 'n' }), 'utf-8');
  setPluginEnabled('nomcp', true);
  assert.deepStrictEqual(pluginServers(null), []);
});

test('插件 mcp.json：项目级/用户级不受插件影响（优先级不变）', () => {
  cfg.upsertServer({ name: 'mine', type: 'stdio', command: 'user' });
  fs.mkdirSync(path.join(PROJ1, '.cuckoo'), { recursive: true });
  fs.writeFileSync(projConfigFile(PROJ1), JSON.stringify({ mcpServers: { mine: { command: 'proj' } } }));
  makePluginWithMcp('demo', { mine: { command: 'plugin' } });
  setPluginEnabled('demo', true);

  const list = cfg.getServers(PROJ1);
  assert.strictEqual(list.find((s) => s.name === 'mine').command, 'proj', '项目级仍最高优先');
  assert.strictEqual(list.find((s) => s.name === 'demo:mine').command, 'plugin');
});

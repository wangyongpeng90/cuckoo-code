'use strict';
/**
 * 插件扫描根与可执行清单测试
 *
 * 这些路径由上层（session / providers / mcp）消费 —— 是插件"能被识别"的接缝。
 *
 * 核心语义：**一切以"插件已启用"为前提**。未启用的插件对系统等价于不存在，
 * 它的技能/代理/规则不被扫描、mcp.json 不被读取、providers 不被加载。
 */
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { getPluginScanRoots, getEnabledPluginProviderFiles, getEnabledPluginMcpFiles } from '../../src/plugins/roots.js';
import { setPluginEnabled, isPluginEnabled } from '../../src/plugins/state.js';
import { getPluginsDir } from '../../src/plugins/paths.js';

const TMP = path.join(os.tmpdir(), 'cuckoo-plugin-roots-test');
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

/** 造一个已安装插件目录 */
function makePlugin(id) {
  const dir = path.join(getPluginsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id, name: id }), 'utf-8');
  return dir;
}

/** 造一个带 providers/ 的插件 */
function makePluginWithProvider(id, fileName = 'custom.js') {
  const dir = makePlugin(id);
  fs.mkdirSync(path.join(dir, 'providers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'providers', fileName), 'module.exports = {}', 'utf-8');
  return dir;
}

/** 造一个带 mcp.json 的插件 */
function makePluginWithMcp(id) {
  const dir = makePlugin(id);
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { fs: { command: 'npx' } } }), 'utf-8');
  return dir;
}

// ===== 状态 =====

test('setPluginEnabled / isPluginEnabled：基本读写', () => {
  assert.strictEqual(isPluginEnabled('demo'), false, '默认未启用');
  assert.strictEqual(setPluginEnabled('demo', true), true);
  assert.strictEqual(isPluginEnabled('demo'), true);
  assert.strictEqual(setPluginEnabled('demo', false), true);
  assert.strictEqual(isPluginEnabled('demo'), false);
});

test('setPluginEnabled：拒绝非法 id', () => {
  assert.strictEqual(setPluginEnabled('../evil', true), false);
});

test('isPluginEnabled：兼容旧字段 execEnabled', () => {
  // 开发期可能已留下旧状态文件；升级后不该让已启用的插件突然失效
  const file = path.join(FAKE_HOME, 'plugins-state.json');
  fs.writeFileSync(file, JSON.stringify({ legacy: { execEnabled: true } }), 'utf-8');
  assert.strictEqual(isPluginEnabled('legacy'), true);
});

// ===== 扫描根 =====

test('无插件时各扫描根为空', () => {
  const r = getPluginScanRoots();
  assert.deepStrictEqual(r.skillDirs, []);
  assert.deepStrictEqual(r.agentDirs, []);
  assert.deepStrictEqual(r.ruleDirs, []);
  assert.deepStrictEqual(r.mcpFiles, []);
});

test('装了但未启用 → 不产出任何扫描根（插件等价于不存在）', () => {
  makePlugin('demo');
  const r = getPluginScanRoots();
  assert.deepStrictEqual(r.skillDirs, []);
  assert.deepStrictEqual(r.agentDirs, []);
  assert.deepStrictEqual(r.ruleDirs, []);
  assert.deepStrictEqual(r.mcpFiles, []);
});

test('启用后产出各扩展线的根路径', () => {
  const dir = makePlugin('demo');
  setPluginEnabled('demo', true);

  const r = getPluginScanRoots();
  assert.deepStrictEqual(r.skillDirs, [path.join(dir, 'skills')]);
  assert.deepStrictEqual(r.agentDirs, [path.join(dir, 'agents')]);
  assert.deepStrictEqual(r.ruleDirs, [path.join(dir, 'rules')]);
  assert.deepStrictEqual(r.mcpFiles, [path.join(dir, 'mcp.json')]);
});

test('多个插件：只有已启用的产出根路径', () => {
  makePlugin('aaa');
  makePlugin('bbb');
  setPluginEnabled('aaa', true);

  const r = getPluginScanRoots();
  assert.strictEqual(r.skillDirs.length, 1);
  assert.ok(r.skillDirs[0].includes('aaa'));
});

test('禁用后扫描根消失', () => {
  makePlugin('demo');
  setPluginEnabled('demo', true);
  assert.strictEqual(getPluginScanRoots().skillDirs.length, 1);

  setPluginEnabled('demo', false);
  assert.deepStrictEqual(getPluginScanRoots().skillDirs, []);
});

test('没有 plugin.json 的目录不算插件（半途失败残骸）', () => {
  fs.mkdirSync(path.join(getPluginsDir(), 'half-written'), { recursive: true });
  assert.deepStrictEqual(getPluginScanRoots().skillDirs, []);
});

// ===== 端到端：启用后能被既有 scanner 扫到 =====

test('端到端：启用后 skill 能被 scanSkills 扫到', async () => {
  const dir = makePlugin('demo');
  fs.mkdirSync(path.join(dir, 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'skills', 'demo-skill', 'SKILL.md'),
    '---\nname: demo-skill\ndescription: 插件带来的技能\n---\n正文',
    'utf-8'
  );
  setPluginEnabled('demo', true);

  const { scanSkills } = await import('../../src/skills/scanner.js');
  const skills = scanSkills(null, getPluginScanRoots().skillDirs);
  const found = skills.find((s) => s.name === 'demo-skill');
  assert.ok(found, '插件贡献的技能应被现有 scanner 识别');
  assert.strictEqual(found.source, 'plugin');
});

test('端到端：未启用时 skill 扫不到', async () => {
  const dir = makePlugin('demo');
  fs.mkdirSync(path.join(dir, 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'skills', 'demo-skill', 'SKILL.md'),
    '---\nname: demo-skill\ndescription: 不该出现\n---\n正文',
    'utf-8'
  );

  const { scanSkills } = await import('../../src/skills/scanner.js');
  const skills = scanSkills(null, getPluginScanRoots().skillDirs);
  assert.ok(!skills.some((s) => s.name === 'demo-skill'));
});

test('端到端：启用后 agent 能被 scanAgents 扫到', async () => {
  const dir = makePlugin('demo');
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'agents', 'plug-agent.md'),
    '---\nname: plug-agent\ndescription: 插件带来的代理\n---\n你是助手',
    'utf-8'
  );
  setPluginEnabled('demo', true);

  const { scanAgents } = await import('../../src/agents/scanner.js');
  const agents = scanAgents(null, getPluginScanRoots().agentDirs);
  const found = agents.find((a) => a.name === 'plug-agent');
  assert.ok(found, '插件贡献的代理应被现有 scanner 识别');
  assert.strictEqual(found.source, 'plugin');
});

test('端到端：启用后 rule 能被 scanRules 扫到', async () => {
  const dir = makePlugin('demo');
  fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'rules', 'plug-rule.md'),
    '---\nname: plug-rule\n---\n插件带来的规则',
    'utf-8'
  );
  setPluginEnabled('demo', true);

  const { scanRules } = await import('../../src/rules/scanner.js');
  const all = scanRules(null, getPluginScanRoots().ruleDirs);
  const found = all.find((r) => r.name === 'plug-rule');
  assert.ok(found, '插件贡献的规则应被现有 scanner 识别');
  assert.strictEqual(found.source, 'plugin');
});

// ===== provider 文件 =====

test('getEnabledPluginProviderFiles：无插件时为空', () => {
  assert.deepStrictEqual(getEnabledPluginProviderFiles(), []);
});

test('getEnabledPluginProviderFiles：未启用时不返回', () => {
  makePluginWithProvider('demo');
  assert.deepStrictEqual(getEnabledPluginProviderFiles(), []);
});

test('getEnabledPluginProviderFiles：启用后返回绝对路径', () => {
  const dir = makePluginWithProvider('demo');
  setPluginEnabled('demo', true);

  const files = getEnabledPluginProviderFiles();
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0], path.join(dir, 'providers', 'custom.js'));
});

test('getEnabledPluginProviderFiles：禁用后又不返回', () => {
  makePluginWithProvider('demo');
  setPluginEnabled('demo', true);
  assert.strictEqual(getEnabledPluginProviderFiles().length, 1);

  setPluginEnabled('demo', false);
  assert.deepStrictEqual(getEnabledPluginProviderFiles(), []);
});

test('getEnabledPluginProviderFiles：只认 .js，忽略其它文件', () => {
  const dir = makePlugin('demo');
  fs.mkdirSync(path.join(dir, 'providers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'providers', 'a.js'), 'x', 'utf-8');
  fs.writeFileSync(path.join(dir, 'providers', 'readme.txt'), 'x', 'utf-8');
  setPluginEnabled('demo', true);

  const files = getEnabledPluginProviderFiles();
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].endsWith('a.js'));
});

test('getEnabledPluginProviderFiles：启用状态按插件隔离', () => {
  makePluginWithProvider('aaa');
  makePluginWithProvider('bbb');
  setPluginEnabled('aaa', true);

  const files = getEnabledPluginProviderFiles();
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].includes('aaa'));
});

test('getEnabledPluginProviderFiles：无 providers 目录的插件不报错', () => {
  makePlugin('bare');
  setPluginEnabled('bare', true);
  assert.deepStrictEqual(getEnabledPluginProviderFiles(), []);
});

test('getEnabledPluginProviderFiles：未安装插件但状态表有残留 → 不返回', () => {
  setPluginEnabled('ghost', true); // 只有状态，没有目录
  assert.deepStrictEqual(getEnabledPluginProviderFiles(), []);
});

// ===== mcp.json =====

test('getEnabledPluginMcpFiles：无插件时为空', () => {
  assert.deepStrictEqual(getEnabledPluginMcpFiles(), []);
});

test('getEnabledPluginMcpFiles：未启用时不返回', () => {
  makePluginWithMcp('demo');
  assert.deepStrictEqual(getEnabledPluginMcpFiles(), []);
});

test('getEnabledPluginMcpFiles：启用后返回插件 id 与文件路径', () => {
  const dir = makePluginWithMcp('demo');
  setPluginEnabled('demo', true);

  const list = getEnabledPluginMcpFiles();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].pluginId, 'demo');
  assert.strictEqual(list[0].file, path.join(dir, 'mcp.json'));
});

test('getEnabledPluginMcpFiles：禁用后消失', () => {
  makePluginWithMcp('demo');
  setPluginEnabled('demo', true);
  assert.strictEqual(getEnabledPluginMcpFiles().length, 1);

  setPluginEnabled('demo', false);
  assert.deepStrictEqual(getEnabledPluginMcpFiles(), []);
});

test('getEnabledPluginMcpFiles：无 mcp.json 的插件不返回', () => {
  makePlugin('bare');
  setPluginEnabled('bare', true);
  assert.deepStrictEqual(getEnabledPluginMcpFiles(), []);
});

test('getEnabledPluginMcpFiles：启用状态按插件隔离', () => {
  makePluginWithMcp('aaa');
  makePluginWithMcp('bbb');
  setPluginEnabled('aaa', true);

  const ids = getEnabledPluginMcpFiles().map((x) => x.pluginId);
  assert.deepStrictEqual(ids, ['aaa']);
});

test('provider 与 mcp 共用同一个开关', () => {
  const dir = makePluginWithMcp('demo');
  fs.mkdirSync(path.join(dir, 'providers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'providers', 'x.js'), 'module.exports={}', 'utf-8');

  setPluginEnabled('demo', true);
  // 一个开关同时管两者：MCP 会 spawn 进程，与 providers 同级风险
  assert.strictEqual(getEnabledPluginProviderFiles().length, 1);
  assert.strictEqual(getEnabledPluginMcpFiles().length, 1);
});

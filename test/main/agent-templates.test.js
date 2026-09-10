'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronMock } = require('../helpers/mock-electron');
installElectronMock();

const { load, extractSummary, getBuiltinAgentDir, getUserAgentDir } = require('../../src/main/agent-templates');

// mock-electron 的路径：getAppPath -> test/tmp/appPath，getPath('userData') -> test/tmp/userData
const builtinDir = path.join(process.cwd(), 'test', 'tmp', 'appPath', 'agents');
const userDir = path.join(process.cwd(), 'test', 'tmp', 'userData', 'agents');

function cleanAll() {
  fs.rmSync(path.join(process.cwd(), 'test', 'tmp', 'appPath'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'test', 'tmp', 'userData'), { recursive: true, force: true });
}

beforeEach(() => {
  cleanAll();
  fs.mkdirSync(builtinDir, { recursive: true });
});

afterEach(() => {
  cleanAll();
});

test('加载内置 agents/ 目录模板', () => {
  fs.writeFileSync(path.join(builtinDir, 'code-reviewer.md'), '# 代码审查\n\n审查代码质量。');
  fs.writeFileSync(path.join(builtinDir, 'test-engineer.md'), '# 测试工程师\n\n编写测试。');

  const map = load();
  assert.strictEqual(map.size, 2);
  assert.ok(map.has('code-reviewer'));
  assert.ok(map.has('test-engineer'));
  assert.strictEqual(map.get('code-reviewer').summary, '代码审查');
  assert.match(map.get('code-reviewer').fullText, /审查代码质量/);
});

test('加载用户自定义 agents/ 目录模板', () => {
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'my-agent.md'), '# 我的 Agent\n\n自定义。');

  const map = load();
  assert.strictEqual(map.size, 1);
  assert.ok(map.has('my-agent'));
  assert.strictEqual(map.get('my-agent').summary, '我的 Agent');
});

test('用户自定义同 id 覆盖内置', () => {
  fs.writeFileSync(path.join(builtinDir, 'code-reviewer.md'), '# 内置版本\n\n内置。');
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'code-reviewer.md'), '# 用户版本\n\n用户覆盖。');

  const map = load();
  assert.strictEqual(map.size, 1);
  assert.strictEqual(map.get('code-reviewer').summary, '用户版本');
  assert.match(map.get('code-reviewer').fullText, /用户覆盖/);
});

test('跳过下划线开头文件', () => {
  fs.writeFileSync(path.join(builtinDir, '_README.md'), '# 说明');
  fs.writeFileSync(path.join(builtinDir, 'real-agent.md'), '# 真实 Agent');

  const map = load();
  assert.strictEqual(map.size, 1);
  assert.ok(map.has('real-agent'));
  assert.ok(!map.has('_README'));
});

test('跳过 README.md', () => {
  fs.writeFileSync(path.join(builtinDir, 'README.md'), '# 目录说明');
  fs.writeFileSync(path.join(builtinDir, 'valid.md'), '# 有效 Agent');

  const map = load();
  assert.strictEqual(map.size, 1);
  assert.ok(map.has('valid'));
  assert.ok(!map.has('README'));
});

test('内置目录为空返回空 Map', () => {
  const map = load();
  assert.strictEqual(map.size, 0);
});

test('目录不存在返回空 Map', () => {
  cleanAll();
  // 两处目录都不存在
  const map = load();
  assert.strictEqual(map.size, 0);
});

test('跳过空文件', () => {
  fs.writeFileSync(path.join(builtinDir, 'empty.md'), '');
  fs.writeFileSync(path.join(builtinDir, 'valid.md'), 'valid');

  const map = load();
  assert.strictEqual(map.size, 1);
  assert.ok(map.has('valid'));
});

test('extractSummary 去掉 # 前缀并取首个非空行', () => {
  assert.strictEqual(extractSummary('# 标题\n\n正文'), '标题');
  assert.strictEqual(extractSummary('\n\n## 二级标题\n正文'), '二级标题');
  assert.strictEqual(extractSummary('无标题文本'), '无标题文本');
  assert.strictEqual(extractSummary(''), '');
});

test('getBuiltinAgentDir / getUserAgentDir 返回目录', () => {
  assert.ok(getBuiltinAgentDir().endsWith('agents'));
  assert.ok(getUserAgentDir().endsWith('agents'));
  assert.notStrictEqual(getBuiltinAgentDir(), getUserAgentDir());
});

'use strict';
/**
 * rules 模块测试：frontmatter 解析、扫描、匹配、提示词
 * 隔离：CUCKOO_HOME 指向临时目录（用户级规则）。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), 'cuckoo-rules-test');
const FAKE_HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');

let rules;
let oldHome;

beforeEach(async () => {
  vi.resetModules();
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  fs.mkdirSync(path.join(PROJ, '.cuckoo', 'rules'), { recursive: true });
  rules = await import('../../src/rules/index.js');
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
});

function writeProjRule(file, content) {
  fs.writeFileSync(path.join(PROJ, '.cuckoo', 'rules', file), content);
}
function writeUserRule(file, content) {
  fs.mkdirSync(path.join(FAKE_HOME, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(FAKE_HOME, 'rules', file), content);
}

// ========== frontmatter ==========

test('parseRuleFrontmatter：解析 name + paths 数组', () => {
  const r = rules.parseRuleFrontmatter('---\nname: api\npaths:\n  - "src/api/**"\n  - "src/routes/**"\n---\n# 正文');
  assert.strictEqual(r.name, 'api');
  assert.deepStrictEqual(r.paths, ['src/api/**', 'src/routes/**']);
  assert.ok(r.body.includes('# 正文'));
});

test('parseRuleFrontmatter：paths 单行数组', () => {
  const r = rules.parseRuleFrontmatter('---\npaths: ["a/**", "b/**"]\n---\n正文');
  assert.deepStrictEqual(r.paths, ['a/**', 'b/**']);
});

test('parseRuleFrontmatter：无 paths 时为空数组', () => {
  const r = rules.parseRuleFrontmatter('---\nname: x\n---\n正文');
  assert.deepStrictEqual(r.paths, []);
});

// ========== 扫描 ==========

test('scanRules：项目级 + 用户级都扫到', () => {
  writeProjRule('p.md', '---\npaths:\n  - "src/**"\n---\n项目规则');
  writeUserRule('u.md', '---\nname: user-rule\n---\n用户规则');
  const list = rules.scanRules(PROJ);
  assert.strictEqual(list.length, 2);
  assert.ok(list.find(r => r.source === 'project'));
  assert.ok(list.find(r => r.source === 'user'));
});

test('scanRules：同名规则都保留（不覆盖）', () => {
  writeProjRule('api.md', '---\nname: api\npaths:\n  - "a/**"\n---\n项目版');
  writeUserRule('api.md', '---\nname: api\npaths:\n  - "b/**"\n---\n用户版');
  const list = rules.scanRules(PROJ).filter(r => r.name === 'api');
  assert.strictEqual(list.length, 2, '同名不覆盖');
});

test('scanRules：无 name 用文件名', () => {
  writeProjRule('my-rule.md', '---\npaths:\n  - "x/**"\n---\n正文');
  const list = rules.scanRules(PROJ);
  assert.ok(list.find(r => r.name === 'my-rule'));
});

test('scanRules：无正文跳过', () => {
  writeProjRule('empty.md', '---\nname: e\n---\n');
  assert.strictEqual(rules.scanRules(PROJ).length, 0);
});

test('getScopedRules / getUnscopedRules 分类', () => {
  writeProjRule('a.md', '---\npaths:\n  - "x/**"\n---\n有路径');
  writeProjRule('b.md', '---\nname: b\n---\n无路径');
  const all = rules.scanRules(PROJ);
  assert.strictEqual(rules.getScopedRules(all).length, 1);
  assert.strictEqual(rules.getUnscopedRules(all).length, 1);
});

// ========== 匹配 ==========

test('matchRulesForPath：命中 glob', () => {
  writeProjRule('api.md', '---\nname: api\npaths:\n  - "src/api/**/*.ts"\n---\n规则');
  const scoped = rules.getScopedRules(rules.scanRules(PROJ));
  assert.strictEqual(rules.matchRulesForPath(scoped, 'src/api/user.ts').length, 1);
  assert.strictEqual(rules.matchRulesForPath(scoped, 'src/other.ts').length, 0);
});

test('matchRulesForPath：** 跨层级', () => {
  writeProjRule('api.md', '---\nname: api\npaths:\n  - "src/**/*.ts"\n---\n规则');
  const scoped = rules.getScopedRules(rules.scanRules(PROJ));
  assert.strictEqual(rules.matchRulesForPath(scoped, 'src/a/b/c.ts').length, 1);
});

// ========== 去重状态 ==========

test('注入状态：标记 + 查询', () => {
  const s = rules.getInjectedSet('sess1');
  assert.ok(!s.has('/x.md'));
  rules.markInjected('sess1', '/x.md');
  assert.ok(rules.getInjectedSet('sess1').has('/x.md'));
  // 不同会话独立
  assert.ok(!rules.getInjectedSet('sess2').has('/x.md'));
});

// ========== 提示词 ==========

test('renderRuleFull：含全文 + 路径', () => {
  writeProjRule('api.md', '---\nname: api\npaths:\n  - "x/**"\n---\n- 校验入参');
  const r = rules.scanRules(PROJ)[0];
  const text = rules.renderRuleFull(r);
  assert.ok(text.includes('api'));
  assert.ok(text.includes(r.rulePath));
  assert.ok(text.includes('校验入参'));
});

test('renderRulePointer：只含名字 + 路径，不含正文', () => {
  writeProjRule('api.md', '---\nname: api\npaths:\n  - "x/**"\n---\n- 校验入参');
  const r = rules.scanRules(PROJ)[0];
  const text = rules.renderRulePointer(r, 'src/api/a.ts');
  assert.ok(text.includes('api'));
  assert.ok(text.includes(r.rulePath));
  assert.ok(!text.includes('校验入参'), '指针不含正文');
});

test('buildUnscopedRulesSection：无规则返回空串', () => {
  assert.strictEqual(rules.buildUnscopedRulesSection([]), '');
});

test('buildUnscopedRulesSection：有规则生成章节', () => {
  writeProjRule('b.md', '---\nname: b\n---\n无路径规则正文');
  const unscoped = rules.getUnscopedRules(rules.scanRules(PROJ));
  const section = rules.buildUnscopedRulesSection(unscoped);
  assert.ok(section.includes('## 项目规则'));
  assert.ok(section.includes('无路径规则正文'));
});

// ========== 插件扫描根 ==========

test('scanRules：额外扫描根被识别且 source=plugin', () => {
  const root = path.join(TMP, 'plugin-rules');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plug.md'), '---\nname: plug\n---\n插件规则正文', 'utf-8');

  const all = rules.scanRules(PROJ, [root]);
  const found = all.find((r) => r.name === 'plug');
  assert.ok(found, '插件目录里的规则应被扫到');
  assert.strictEqual(found.source, 'plugin');
});

test('scanRules：插件规则排在最后（优先级最低）', () => {
  writeProjRule('proj.md', '---\nname: proj\n---\n项目规则');
  const root = path.join(TMP, 'plugin-rules2');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plug.md'), '---\nname: plug\n---\n插件规则', 'utf-8');

  const all = rules.scanRules(PROJ, [root]);
  const iProj = all.findIndex((r) => r.name === 'proj');
  const iPlug = all.findIndex((r) => r.name === 'plug');
  assert.ok(iProj >= 0 && iPlug >= 0);
  assert.ok(iProj < iPlug, '项目级应排在插件级之前');
});

test('scanRules：不传额外扫描根时行为不变', () => {
  writeProjRule('only.md', '---\nname: only\n---\n正文');
  const all = rules.scanRules(PROJ);
  assert.ok(all.some((r) => r.name === 'only'));
  assert.ok(!all.some((r) => r.source === 'plugin'));
});

'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseFrontmatter } from '../../src/skills/frontmatter.js';
import { mergeSkills, scanSkills } from '../../src/skills/scanner.js';
import { buildSkillsSection } from '../../src/skills/prompt.js';

// ===== frontmatter =====

test('parseFrontmatter: 基本解析', () => {
  const r = parseFrontmatter('---\nname: demo\ndescription: 演示技能\n---\n正文');
  assert.strictEqual(r.data.name, 'demo');
  assert.strictEqual(r.data.description, '演示技能');
  assert.strictEqual(r.body, '正文');
});

test('parseFrontmatter: 无 frontmatter', () => {
  const r = parseFrontmatter('# 标题\n内容');
  assert.deepStrictEqual(r.data, {});
  assert.strictEqual(r.body, '# 标题\n内容');
});

test('parseFrontmatter: 去引号', () => {
  const r = parseFrontmatter('---\nname: "demo"\n---\nbody');
  assert.strictEqual(r.data.name, 'demo');
});

test('parseFrontmatter: CRLF 兼容', () => {
  const CR = String.fromCharCode(13);
  const r = parseFrontmatter('---' + CR + '\nname: demo' + CR + '\n---' + CR + '\n正文');
  assert.strictEqual(r.data.name, 'demo');
  assert.strictEqual(r.body, '正文');
});

test('parseFrontmatter: 忽略注释与空行', () => {
  const r = parseFrontmatter('---\n# 注释\n\nname: demo\n---\nbody');
  assert.strictEqual(r.data.name, 'demo');
});

// ===== mergeSkills =====

function mk(name, source) {
  return { name, description: name + ' desc', skillPath: '/x/' + name + '/SKILL.md', dir: '/x/' + name, source };
}

test('mergeSkills: 同名项目级优先', () => {
  const p = [mk('a', 'project'), mk('b', 'project')];
  const u = [mk('a', 'user'), mk('c', 'user')];
  const merged = mergeSkills(p, u);
  const a = merged.find((s) => s.name === 'a');
  assert.strictEqual(a.source, 'project');
  assert.strictEqual(merged.length, 3);
});

test('mergeSkills: 插件级优先级最低（项目 > 用户 > 插件）', () => {
  const p = [mk('a', 'project')];
  const u = [mk('a', 'user'), mk('b', 'user')];
  const pl = [mk('a', 'plugin'), mk('b', 'plugin'), mk('c', 'plugin')];
  const merged = mergeSkills(p, u, pl);
  assert.strictEqual(merged.find((s) => s.name === 'a').source, 'project');
  assert.strictEqual(merged.find((s) => s.name === 'b').source, 'user');
  assert.strictEqual(merged.find((s) => s.name === 'c').source, 'plugin');
  assert.strictEqual(merged.length, 3);
});

// ===== scanSkills 的插件扫描根 =====

test('scanSkills: 额外扫描根被识别且 source=plugin', () => {
  const root = path.join(os.tmpdir(), 'cuckoo-skill-root-test', 'skills');
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'from-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'from-plugin', 'SKILL.md'),
    '---\nname: from-plugin\ndescription: 来自插件\n---\n正文',
    'utf-8'
  );

  const skills = scanSkills(null, [root]);
  const found = skills.find((s) => s.name === 'from-plugin');
  assert.ok(found, '插件目录里的技能应被扫到');
  assert.strictEqual(found.source, 'plugin');

  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

test('scanSkills: 不传额外扫描根时行为不变', () => {
  const skills = scanSkills(null);
  assert.ok(Array.isArray(skills));
  assert.ok(!skills.some((s) => s.source === 'plugin'));
});

test('scanSkills: 忽略空字符串扫描根', () => {
  const skills = scanSkills(null, ['', '']);
  assert.ok(Array.isArray(skills));
});

// ===== buildSkillsSection =====

test('buildSkillsSection: 空列表仍返回章节（含"提示用户安装"引导）', () => {
  const s = buildSkillsSection([]);
  assert.ok(s.includes('## 可用技能'));
  assert.ok(s.includes('提示用户安装'));
});

test('buildSkillsSection: 包含 name 与路径', () => {
  const s = buildSkillsSection([mk('code-review', 'project')]);
  assert.ok(s.includes('code-review'));
  assert.ok(s.includes('SKILL.md'));
  assert.ok(s.includes('## 可用技能'));
});

test('buildSkillsSection: description 超长截断', () => {
  const long = { name: 'x', description: 'a'.repeat(2000), skillPath: '/x/SKILL.md', dir: '/x', source: 'project' };
  const s = buildSkillsSection([long]);
  assert.ok(s.length < 3000);
  assert.ok(s.includes('…'));
});

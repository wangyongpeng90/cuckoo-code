'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { parseFrontmatter } from '../../src/skills/frontmatter.js';
import { mergeSkills } from '../../src/skills/scanner.js';
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

// ===== buildSkillsSection =====

test('buildSkillsSection: 空列表返回空串', () => {
  assert.strictEqual(buildSkillsSection([]), '');
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

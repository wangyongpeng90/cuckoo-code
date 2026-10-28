'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseFrontmatter } from '../../src/skills/frontmatter.js';
import { mergeSkills, scanSkills } from '../../src/skills/scanner.js';
import { buildSkillsSection } from '../../src/skills/prompt.js';
import { isSkillEnabled, setSkillEnabled, filterEnabledSkills } from '../../src/skills/state.js';

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

// ===== state.ts：技能开关 =====

function withTmpHome(fn) {
  const dir = path.join(os.tmpdir(), 'cuckoo-skills-state-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const old = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = dir;
  try { return fn(dir); } finally {
    if (old === undefined) delete process.env.CUCKOO_HOME; else process.env.CUCKOO_HOME = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('isSkillEnabled: 默认开启（无状态文件）', () => {
  withTmpHome(() => {
    assert.strictEqual(isSkillEnabled('a', null), true);
  });
});

test('setSkillEnabled: 用户级技能写入用户级状态文件', () => {
  withTmpHome((home) => {
    assert.strictEqual(setSkillEnabled('a', 'user', null, false), true);
    const f = path.join(home, 'skills-state.json');
    assert.ok(fs.existsSync(f));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf-8')).disabled, ['a']);
    assert.strictEqual(isSkillEnabled('a', null), false);
    assert.strictEqual(setSkillEnabled('a', 'user', null, true), true);
    assert.strictEqual(isSkillEnabled('a', null), true);
  });
});

test('setSkillEnabled: 项目级技能写入项目级状态文件', () => {
  withTmpHome(() => {
    const proj = path.join(os.tmpdir(), 'cuckoo-proj-state-' + Date.now());
    fs.mkdirSync(proj, { recursive: true });
    try {
      assert.strictEqual(setSkillEnabled('p', 'project', proj, false), true);
      const f = path.join(proj, '.cuckoo', 'skills-state.json');
      assert.ok(fs.existsSync(f));
      assert.strictEqual(isSkillEnabled('p', proj), false);
      assert.strictEqual(isSkillEnabled('p', null), true);
    } finally { fs.rmSync(proj, { recursive: true, force: true }); }
  });
});

test('setSkillEnabled: 项目级但无 projectDir 时失败（不落盘）', () => {
  withTmpHome((home) => {
    assert.strictEqual(setSkillEnabled('p', 'project', null, false), false);
    assert.ok(!fs.existsSync(path.join(home, 'skills-state.json')));
  });
});

test('setSkillEnabled: 空名字返回 false', () => {
  withTmpHome(() => {
    assert.strictEqual(setSkillEnabled('', 'user', null, false), false);
  });
});

test('filterEnabledSkills: 过滤已关闭技能，保持顺序', () => {
  withTmpHome(() => {
    setSkillEnabled('b', 'user', null, false);
    const list = [mk('a', 'user'), mk('b', 'user'), mk('c', 'user')];
    const out = filterEnabledSkills(list, null);
    assert.deepStrictEqual(out.map((s) => s.name), ['a', 'c']);
  });
});

test('filterEnabledSkills: 无任何关闭时原样返回', () => {
  withTmpHome(() => {
    const list = [mk('a', 'user'), mk('b', 'user')];
    const out = filterEnabledSkills(list, null);
    assert.strictEqual(out, list);
  });
});

test('state: 状态文件损坏时不崩（视为全开启）', () => {
  withTmpHome((home) => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'skills-state.json'), '{not json', 'utf-8');
    assert.strictEqual(isSkillEnabled('a', null), true);
  });
});


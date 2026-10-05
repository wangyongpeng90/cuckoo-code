'use strict';
/**
 * skills/config 测试：技能 CRUD + 启用状态
 * electron 的 app.getPath('userData') 是外部边界，mock 它指向临时目录。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal();
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = path.join(os.tmpdir(), 'cuckoo-skills-config-test');
  return {
    ...actual,
    createRequire: () => (id) => {
      if (id === 'electron') return { app: { getPath: () => dir } };
      throw new Error('unexpected require: ' + id);
    },
  };
});

let cfg;
let TMP;

beforeEach(async () => {
  vi.resetModules();
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  TMP = path.join(os.tmpdir(), 'cuckoo-skills-config-test');
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  cfg = await import('../../src/skills/config.js');
});

test('listSkills 空目录返回空数组', () => {
  assert.deepStrictEqual(cfg.listSkills(), []);
});

test('upsertSkill 创建文件并可读回', async () => {
  const content = '步骤一' + String.fromCharCode(10) + '步骤二';
  const saved = cfg.upsertSkill({ name: '实训平台', description: '国开自动化', content });
  assert.strictEqual(saved.name, '实训平台');
  assert.strictEqual(saved.description, '国开自动化');
  assert.strictEqual(saved.content, content);
  assert.ok(saved.id, '应生成 id');
  // 落盘文件存在
  const fs = await import('node:fs');
  const path = await import('node:path');
  assert.ok(fs.existsSync(path.join(TMP, 'skills', saved.id, 'SKILL.md')));
});

test('upsertSkill: 中文名生成 ASCII id（不含中文）', () => {
  const saved = cfg.upsertSkill({ name: '实训平台', description: 'd', content: 'c' });
  assert.ok(/^[A-Za-z0-9_-]+$/.test(saved.id), 'id 应为 ASCII: ' + saved.id);
});

test('upsertSkill: 英文名 slug 化', () => {
  const saved = cfg.upsertSkill({ name: 'Code Review', description: 'd', content: 'c' });
  assert.strictEqual(saved.id, 'code-review');
});

test('upsertSkill: 缺字段报错', () => {
  assert.throws(() => cfg.upsertSkill({ name: '', description: 'd', content: 'c' }));
  assert.throws(() => cfg.upsertSkill({ name: 'n', description: '', content: 'c' }));
  assert.throws(() => cfg.upsertSkill({ name: 'n', description: 'd', content: '' }));
});

test('listSkills 读回并默认启用', () => {
  cfg.upsertSkill({ name: 'demo', description: 'd', content: 'c' });
  const list = cfg.listSkills();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].enabled, true);
});

test('setSkillEnabled 持久化禁用状态', () => {
  const saved = cfg.upsertSkill({ name: 'demo', description: 'd', content: 'c' });
  cfg.setSkillEnabled(saved.id, false);
  const list = cfg.listSkills();
  assert.strictEqual(list[0].enabled, false);
});

test('removeSkill 删除文件与状态', () => {
  const saved = cfg.upsertSkill({ name: 'demo', description: 'd', content: 'c' });
  assert.strictEqual(cfg.removeSkill(saved.id), true);
  assert.deepStrictEqual(cfg.listSkills(), []);
});

test('allowedTools: 空格分隔解析并写回数组', () => {
  const saved = cfg.upsertSkill({ name: 'demo', description: 'd', content: 'c', allowedTools: ['read', 'bash'] });
  assert.deepStrictEqual(saved.allowedTools, ['read', 'bash']);
});

test('installSkillFromDir: 从目录安装并保留附属文件', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  // 构造一个含 SKILL.md + 附属文件的源目录
  const src = path.join(os.tmpdir(), 'cuckoo-skill-src-test');
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(path.join(src, 'references'), { recursive: true });
  fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: 演示安装\ndescription: d\n---\n正文', 'utf-8');
  fs.writeFileSync(path.join(src, 'references', 'a.md'), 'ref', 'utf-8');

  const saved = cfg.installSkillFromDir(src);
  assert.strictEqual(saved.name, '演示安装');
  const dest = path.join(TMP, 'skills', saved.id);
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')), 'SKILL.md 应存在');
  assert.ok(fs.existsSync(path.join(dest, 'references', 'a.md')), '附属文件应保留');
});

test('installSkillFromDir: 缺 SKILL.md 报错', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const empty = path.join(os.tmpdir(), 'cuckoo-skill-empty-test');
  fs.rmSync(empty, { recursive: true, force: true });
  fs.mkdirSync(empty, { recursive: true });
  assert.throws(() => cfg.installSkillFromDir(empty));
});

test('id 更新：传 id 时保持同一文件', () => {
  const first = cfg.upsertSkill({ name: 'demo', description: 'd1', content: 'c1' });
  const second = cfg.upsertSkill({ id: first.id, name: 'demo', description: 'd2', content: 'c2' });
  assert.strictEqual(second.id, first.id);
  assert.strictEqual(cfg.listSkills().length, 1);
  assert.strictEqual(second.description, 'd2');
});

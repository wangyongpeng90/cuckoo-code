'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { mergeAgents, scanAgents } from '../../src/agents/scanner.js';
import { buildAgentsSection } from '../../src/agents/prompt.js';

function mk(name, source) {
  return { name, description: name + ' desc', agentPath: '/x/' + name + '.md', systemPrompt: 'body', source };
}

// ===== mergeAgents =====

test('mergeAgents: 同名项目级优先', () => {
  const p = [mk('a', 'project'), mk('b', 'project')];
  const u = [mk('a', 'user'), mk('c', 'user')];
  const merged = mergeAgents(p, u);
  const a = merged.find((x) => x.name === 'a');
  assert.strictEqual(a.source, 'project');
  assert.strictEqual(merged.length, 3);
});

test('mergeAgents: 空列表', () => {
  assert.deepStrictEqual(mergeAgents([], []), []);
});

test('mergeAgents: 插件级优先级最低（项目 > 用户 > 插件）', () => {
  const p = [mk('a', 'project')];
  const u = [mk('a', 'user'), mk('b', 'user')];
  const pl = [mk('a', 'plugin'), mk('b', 'plugin'), mk('c', 'plugin')];
  const merged = mergeAgents(p, u, pl);
  assert.strictEqual(merged.find((x) => x.name === 'a').source, 'project');
  assert.strictEqual(merged.find((x) => x.name === 'b').source, 'user');
  assert.strictEqual(merged.find((x) => x.name === 'c').source, 'plugin');
  assert.strictEqual(merged.length, 3);
});

// ===== scanAgents 的插件扫描根 =====

test('scanAgents: 额外扫描根被识别且 source=plugin', () => {
  const root = path.join(os.tmpdir(), 'cuckoo-agent-root-test', 'agents');
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'from-plugin.md'),
    '---\nname: from-plugin\ndescription: 来自插件的代理\n---\n你是助手',
    'utf-8'
  );

  const agents = scanAgents(null, [root]);
  const found = agents.find((a) => a.name === 'from-plugin');
  assert.ok(found, '插件目录里的代理应被扫到');
  assert.strictEqual(found.source, 'plugin');

  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

test('scanAgents: 不传额外扫描根时行为不变', () => {
  const agents = scanAgents(null);
  assert.ok(Array.isArray(agents));
  assert.ok(!agents.some((a) => a.source === 'plugin'));
});

// ===== buildAgentsSection =====

test('buildAgentsSection: 无代理返回空串', () => {
  assert.strictEqual(buildAgentsSection([]), '');
});

test('buildAgentsSection: 包含 name 与 description', () => {
  const s = buildAgentsSection([mk('code-reviewer', 'project')]);
  assert.ok(s.includes('## 可用子代理'));
  assert.ok(s.includes('code-reviewer'));
  assert.ok(s.includes('code-reviewer desc'));
  assert.ok(s.includes('runAgent'));
});

test('buildAgentsSection: 多个代理都列出', () => {
  const s = buildAgentsSection([mk('a', 'project'), mk('b', 'user')]);
  assert.ok(s.includes('- a：'));
  assert.ok(s.includes('- b：'));
});

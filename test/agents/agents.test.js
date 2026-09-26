'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { mergeAgents } from '../../src/agents/scanner.js';
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

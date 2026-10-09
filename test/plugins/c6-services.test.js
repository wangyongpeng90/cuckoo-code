/**
 * C6 测试：skills/commands/goals/compaction/workspaceFiles/sessionTitle/tokenMeter。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c6-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c6-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "export function apply(ctx) {",
    "  globalThis.__c6 = {",
    "    skills: ctx.skills.list(),",
    "    commands: ctx.commands.list(),",
    "    goal: ctx.goals.current(),",
    "    title: ctx.sessionTitle.get(),",
    "    tokens: ctx.tokenMeter.total(),",
    "    files: ctx.workspaceFiles.list(),",
    "  };",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C6：7 个服务接宿主', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c6 = null;
    await loadCuckooPlugin(dir, {
      listSkills: () => [{ name: 'hello', description: '打招呼' }],
      listCommands: () => [{ id: 'cmd1', title: '命令1' }],
      getGoal: () => ({ active: true, text: '做完' }),
      getSessionTitle: () => '测试会话',
      getTokens: () => ({ context: 1, cumulative: 2, today: 3, windowCumulative: 4, total: 99 }),
      listWorkspaceFiles: () => [{ path: 'a.ts', type: 'file' }],
    });
    const c6 = globalThis.__c6;
    assert.deepStrictEqual(c6.skills, [{ name: 'hello', description: '打招呼' }]);
    assert.deepStrictEqual(c6.commands, [{ id: 'cmd1', title: '命令1' }]);
    assert.deepStrictEqual(c6.goal, { active: true, text: '做完' });
    assert.strictEqual(c6.title, '测试会话');
    assert.strictEqual(c6.tokens, 99);
    assert.deepStrictEqual(c6.files, [{ path: 'a.ts', type: 'file' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C6：无宿主时退回空（不崩）', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c6 = null;
    await loadCuckooPlugin(dir); // 不传 host
    const c6 = globalThis.__c6;
    assert.deepStrictEqual(c6.skills, []);
    assert.deepStrictEqual(c6.commands, []);
    assert.strictEqual(c6.goal, null);
    assert.strictEqual(c6.title, null);
    assert.strictEqual(c6.tokens, 0);
    assert.deepStrictEqual(c6.files, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

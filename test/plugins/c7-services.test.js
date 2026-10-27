/**
 * C7 测试：subagents / shell / sessionQuery。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c7-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c7-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "export function apply(ctx) {",
    "  globalThis.__c7 = {",
    "    subs: ctx.subagents.list(),",
    "    q: ctx.sessionQuery.get('s1'),",
    "  };",
    "  ctx.shell.exec('echo hi').then((r) => { globalThis.__c7cmd = r; });",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C7：subagents/shell/sessionQuery 接宿主', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c7 = null; globalThis.__c7cmd = null;
    await loadCuckooPlugin(dir, {
      listSubagents: () => [{ name: 'explore', description: '探索' }],
      querySession: (id) => (id === 's1' ? { id: 's1', title: '会话1', projectDir: 'C:/p' } : null),
      runCommand: async (cmd) => ({ stdout: 'hi\n', exitCode: 0 }),
    });
    const c7 = globalThis.__c7;
    assert.deepStrictEqual(c7.subs, [{ name: 'explore', description: '探索' }]);
    assert.deepStrictEqual(c7.q, { id: 's1', title: '会话1', projectDir: 'C:/p' });
    // shell 异步
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(globalThis.__c7cmd, { stdout: 'hi\n', exitCode: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C7：无宿主时退回空（不崩）', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c7 = null;
    await loadCuckooPlugin(dir);
    const c7 = globalThis.__c7;
    assert.deepStrictEqual(c7.subs, []);
    assert.strictEqual(c7.q, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

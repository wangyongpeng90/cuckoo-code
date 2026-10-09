/**
 * C4-C 测试：DSH ctx.agents 接真（会话 → agent 视图）。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

test('C4-C：ctx.agents get/current/list', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c4ag-'));
  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'c4ag', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(pluginDir, 'index.js'), [
    "export function apply(ctx) {",
    "  globalThis.__c4ag = {",
    "    cur: ctx.agents.current(),",
    "    all: ctx.agents.list(),",
    "    one: ctx.agents.get('s1'),",
    "    missing: ctx.agents.get('nope'),",
    "  };",
    "}",
  ].join('\n'), 'utf-8');
  try {
    await loadCuckooPlugin(pluginDir, {
      getCurrentSession: () => ({ id: 's1', projectDir: 'C:/proj' }),
      listSessions: () => [{ id: 's1', title: 'a' }, { id: 's2', title: 'b' }],
      getSession: (id) => (id === 's1' ? { id: 's1', title: 'a' } : null),
    });
    const ag = globalThis.__c4ag;
    assert.strictEqual(ag.cur.id, 's1');
    assert.strictEqual(ag.cur.session.projectDir, 'C:/proj');
    assert.strictEqual(ag.all.length, 2);
    assert.strictEqual(ag.all[1].id, 's2');
    assert.strictEqual(ag.one.id, 's1');
    assert.strictEqual(ag.missing, undefined);
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

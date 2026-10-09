/**
 * C4-B 测试：DSH ctx.fs 接真（读/写/列/编辑）。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

test('C4-B：ctx.fs 读写列编辑', async () => {
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c4fs-'));
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c4fsp-'));
  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'c4fs', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(pluginDir, 'index.js'), [
    "export function apply(ctx) {",
    "  globalThis.__c4fs = { ctx };",
    "}",
  ].join('\n'), 'utf-8');
  try {
    const { ctx } = await (async () => {
      await loadCuckooPlugin(pluginDir, { getCurrentSession: () => ({ id: 's', projectDir: projDir }) });
      return globalThis.__c4fs;
    })();
    // write
    const t = await ctx.fs.resolve('hello.txt');
    assert.ok(t.path.endsWith('hello.txt'));
    await ctx.fs.writeText(t, '你好 Cuckoo');
    // read
    const txt = await ctx.fs.readText(t);
    assert.strictEqual(txt, '你好 Cuckoo');
    // list
    const dir = await ctx.fs.resolve('.');
    const entries = await ctx.fs.listDir(dir);
    assert.ok(entries.some((e) => e.name === 'hello.txt'));
    // edit
    await ctx.fs.editText(t, { oldText: 'Cuckoo', newText: 'DSH' });
    assert.strictEqual(await ctx.fs.readText(t), '你好 DSH');
  } finally {
    fs.rmSync(projDir, { recursive: true, force: true });
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

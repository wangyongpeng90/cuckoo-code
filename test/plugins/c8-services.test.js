/**
 * C8 测试：mcpResources / web / browserUse / attachments / terminals。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c8-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c8-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "export function apply(ctx) {",
    "  globalThis.__c8 = {};",
    "  (async () => {",
    "    globalThis.__c8.mcp = await ctx.mcpResources.call('s', 't', { a: 1 });",
    "    globalThis.__c8.web = await ctx.web.fetch('http://x');",
    "    globalThis.__c8.open = await ctx.browserUse.open('http://y');",
    "    globalThis.__c8.term = await ctx.terminals.exec('echo hi');",
    "    globalThis.__c8.att = await ctx.attachments.attach('/f.pdf');",
    "  })();",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C8：mcp/web/browser/terminals/attachments 接宿主', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c8 = {};
    await loadCuckooPlugin(dir, {
      mcpCall: async (s, t, a) => 'mcp:' + s + '/' + t + '/' + JSON.stringify(a),
      webFetch: async (u) => 'web:' + u,
      openBrowserWindow: async (u) => ({ windowId: 'w1', message: 'opened ' + u }),
      runTerminal: async (c) => ({ stdout: 'term:' + c, exitCode: 0 }),
      attachFile: async (f) => ({ fileName: 'f.pdf', size: 1, message: 'ok:' + f }),
    });
    await new Promise((r) => setTimeout(r, 80));
    const c8 = globalThis.__c8;
    assert.strictEqual(c8.mcp, 'mcp:s/t/{"a":1}');
    assert.strictEqual(c8.web, 'web:http://x');
    assert.deepStrictEqual(c8.open, { windowId: 'w1', message: 'opened http://y' });
    assert.deepStrictEqual(c8.term, { stdout: 'term:echo hi', exitCode: 0 });
    assert.deepStrictEqual(c8.att, { fileName: 'f.pdf', size: 1, message: 'ok:/f.pdf' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C8：无宿主时退回空（不崩）', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c8 = {};
    await loadCuckooPlugin(dir);
    await new Promise((r) => setTimeout(r, 80));
    const c8 = globalThis.__c8;
    assert.strictEqual(c8.mcp, '');
    assert.strictEqual(c8.web, '');
    assert.strictEqual(c8.open, null);
    assert.deepStrictEqual(c8.term, { stdout: '', exitCode: 1 });
    assert.strictEqual(c8.att, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

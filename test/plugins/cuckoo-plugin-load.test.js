/**
 * Cuckoo 插件加载集成测试（P1-b）
 * 验证：插件目录（含 @deepseek-ai/* import）→ esbuild 打包 → 加载 → 注册到 ToolRegistry。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';
import { loadPluginFromDir } from '../../src/plugins/cuckoo-plugins/index.js';
import { ToolRegistry } from '../../src/tools/core/ToolRegistry.js';

/** 造一个 DSH 风格插件目录 */
function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-plugin-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'greet-tool', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "import { defineTool } from '@deepseek-ai/dsh-tools';",
    "export const name = 'greet-tool';",
    "export const inject = ['tools'];",
    "export function apply(ctx) {",
    "  ctx.tools.register(defineTool({",
    "    name: 'greet',",
    "    description: 'Greet someone by name.',",
    "    parameters: { name: { type: 'string', required: true } },",
    "    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },",
    "    async execute(args) { return 'Hello, ' + args.name + '!'; },",
    "  }));",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('loadCuckooPlugin：DSH 插件目录 → 收集工具', async () => {
  const dir = makePluginDir();
  try {
    const r = await loadCuckooPlugin(dir);
    assert.strictEqual(r.pluginName, 'greet-tool');
    assert.strictEqual(r.tools.length, 1);
    assert.strictEqual(r.tools[0].name, 'greet');
    assert.strictEqual(r.tools[0].parameters.type, 'object');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadPluginFromDir：注册到 ToolRegistry 并可执行', async () => {
  const dir = makePluginDir();
  try {
    const registry = new ToolRegistry();
    const r = await loadPluginFromDir(dir, registry);
    assert.deepStrictEqual(r.tools, ['greet']);
    assert.ok(registry.get('greet'), 'registry 应含 greet');
    const res = await registry.execute('greet', { name: 'Cuckoo' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data, 'Hello, Cuckoo!');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

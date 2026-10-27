/**
 * [022] agentPresets C-light 测试（决策 9.4）
 *
 * 契约来源：docs/dsh-compat-decisions.md 9.4
 *   - resolve(id?) → { id: id ?? 'default' }（永不 throw、永不带 broken）
 *   - mount(ctx, id?) → { id: id ?? 'default' }（空操作，Cuckoo 默认全量工具）
 *   - 两个方法必须存在（dsh-tasks 的 setup 有 typeof 检查）
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

function makePlugin(dir, globalKey, code) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ap-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    'export function apply(ctx) {',
    '  globalThis.__' + globalKey + '__ = (async () => {',
    code,
    '  })();',
    '}',
  ].join('\n'), 'utf-8');
}

test('[022] agentPresets：ctx.get 返回对象，resolve 和 mount 都是函数', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-ap-1-'));
  try {
    makePlugin(pluginDir, 'ap1', [
      "    const presets = ctx.get('agentPresets');",
      "    return {",
      "      hasPresets: !!presets,",
      "      resolveType: typeof (presets && presets.resolve),",
      "      mountType: typeof (presets && presets.mount),",
      "    };",
    ].join('\n'));
    await loadCuckooPlugin(pluginDir, {});
    const r = await globalThis.__ap1__;
    assert.strictEqual(r.hasPresets, true, 'agentPresets 应存在');
    assert.strictEqual(r.resolveType, 'function', 'resolve 应是函数');
    assert.strictEqual(r.mountType, 'function', 'mount 应是函数');
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

test('[022] agentPresets：resolve 行为（默认 / 显式）', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-ap-2-'));
  try {
    makePlugin(pluginDir, 'ap2', [
      "    const presets = ctx.get('agentPresets');",
      "    const def = await presets.resolve();",
      "    const custom = await presets.resolve('custom-preset');",
      "    return { def, custom };",
    ].join('\n'));
    await loadCuckooPlugin(pluginDir, {});
    const r = await globalThis.__ap2__;
    assert.deepStrictEqual(r.def, { id: 'default' }, '不传 id → { id: default }');
    assert.deepStrictEqual(r.custom, { id: 'custom-preset' }, '传 id → { id: 该 id }');
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

test('[022] agentPresets：mount 行为（默认 / 显式，空操作）', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-ap-3-'));
  try {
    makePlugin(pluginDir, 'ap3', [
      "    const presets = ctx.get('agentPresets');",
      "    const fakeCtx = { fake: true };",
      "    const def = await presets.mount(fakeCtx);",
      "    const custom = await presets.mount(fakeCtx, 'x-preset');",
      "    return { def, custom };",
    ].join('\n'));
    await loadCuckooPlugin(pluginDir, {});
    const r = await globalThis.__ap3__;
    assert.deepStrictEqual(r.def, { id: 'default' });
    assert.deepStrictEqual(r.custom, { id: 'x-preset' });
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

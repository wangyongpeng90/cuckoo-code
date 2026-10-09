/**
 * C1 测试：DSH 插件的 ctx 服务接入 Cuckoo 真能力（settings/tools/sessions）。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makePluginDir(applyBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c1-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), applyBody, 'utf-8');
  return dir;
}

test('C1：ctx.tools.list() 返回宿主注入的工具名', async () => {
  const dir = makePluginDir([
    "export function apply(ctx) {",
    "  const names = ctx.tools.list();",
    "  globalThis.__c1Tools = names;",
    "}",
  ].join('\n'));
  try {
    await loadCuckooPlugin(dir, {
      getToolNames: () => ['read', 'write', 'bash'],
    });
    assert.deepStrictEqual(globalThis.__c1Tools, ['read', 'write', 'bash']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C1：ctx.settings.get/set 接插件配置', async () => {
  const store = { talk: true };
  const dir = makePluginDir([
    "export function apply(ctx) {",
    "  globalThis.__c1Setting = ctx.settings.get('talk');",
    "  ctx.settings.set('height', 200);",
    "}",
  ].join('\n'));
  try {
    await loadCuckooPlugin(dir, {
      getPluginConfig: () => Object.assign({}, store),
      setPluginConfig: (_id, v) => { Object.assign(store, v); return true; },
    });
    assert.strictEqual(globalThis.__c1Setting, true);
    assert.strictEqual(store.height, 200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C1：ctx.sessions.current()/list() 接会话', async () => {
  const dir = makePluginDir([
    "export function apply(ctx) {",
    "  globalThis.__c1Session = ctx.sessions.current();",
    "  globalThis.__c1Sessions = ctx.sessions.list();",
    "}",
  ].join('\n'));
  try {
    await loadCuckooPlugin(dir, {
      getCurrentSession: () => ({ id: 's1', projectDir: 'C:/proj' }),
      listSessions: () => [{ id: 's1', title: '测试' }],
    });
    assert.deepStrictEqual(globalThis.__c1Session, { id: 's1', projectDir: 'C:/proj' });
    assert.deepStrictEqual(globalThis.__c1Sessions, [{ id: 's1', title: '测试' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C1：无宿主注入时退回 stub（不崩）', async () => {
  const dir = makePluginDir([
    "export function apply(ctx) {",
    "  globalThis.__c1NoHost = { tools: ctx.tools.list(), cur: ctx.sessions.current() };",
    "}",
  ].join('\n'));
  try {
    await loadCuckooPlugin(dir); // 不传 host
    assert.deepStrictEqual(globalThis.__c1NoHost.tools, []);
    assert.strictEqual(globalThis.__c1NoHost.cur.id, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

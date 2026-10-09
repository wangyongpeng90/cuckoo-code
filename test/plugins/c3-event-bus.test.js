/**
 * C3 测试：DSH 事件总线——插件 ctx.on 能收到 Cuckoo 事件。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';
import { dispatchHarnessPayload, activeBuses } from '../../src/plugins/cuckoo-plugins/event-bridge.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c3-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c3-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "export const name = 'c3-test';",
    "export function apply(ctx) {",
    "  globalThis.__c3events = [];",
    "  ctx.on('agent/turn-end', (payload) => { globalThis.__c3events.push({ ev: 'turn-end', text: payload && payload.text }); });",
    "  ctx.on('tool/call', (payload) => { globalThis.__c3events.push({ ev: 'tool/call', code: payload && payload.code }); });",
    "  ctx.on('agent/assistant-stream', (payload) => { globalThis.__c3events.push({ ev: 'stream', text: payload && payload.frame && payload.frame.text }); });",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C3：插件 ctx.on 能收到 Cuckoo 转发的 DSH 事件', async () => {
  const dir = makePluginDir();
  try {
    globalThis.__c3events = [];
    await loadCuckooPlugin(dir);
    assert.ok(activeBuses.size >= 1, '应有活跃 EventBus');
    // 模拟 Cuckoo 上报 AI 事件
    dispatchHarnessPayload({ type: 'assistant-done', text: '你好' });
    dispatchHarnessPayload({ type: 'tool-start', code: 'todo_write' });
    dispatchHarnessPayload({ type: 'stream', text: '流式片段' });
    const evs = globalThis.__c3events;
    assert.strictEqual(evs.length, 3, '应收到 3 个事件，实际: ' + JSON.stringify(evs));
    assert.deepStrictEqual(evs[0], { ev: 'turn-end', text: '你好' });
    assert.deepStrictEqual(evs[1], { ev: 'tool/call', code: 'todo_write' });
    assert.deepStrictEqual(evs[2], { ev: 'stream', text: '流式片段' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C3：ctx.emit 广播给同插件监听器', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c3b-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c3b', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "export function apply(ctx) {",
    "  globalThis.__c3b = [];",
    "  ctx.on('my/event', (v) => globalThis.__c3b.push(v));",
    "  ctx.emit('my/event', 'hello');",
    "}",
  ].join('\n'), 'utf-8');
  try {
    globalThis.__c3b = [];
    await loadCuckooPlugin(dir);
    assert.deepStrictEqual(globalThis.__c3b, ['hello']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

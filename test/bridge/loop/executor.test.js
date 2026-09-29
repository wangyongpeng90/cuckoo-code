'use strict';
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';

let executor;

function makeEl(id) {
  return {
    id,
    textContent: '',
    className: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
  };
}

let els;
function setupGlobals() {
  els = {};
  globalThis.document = {
    getElementById: (id) => els[id] || null,
    createElement: (t) => makeEl(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {} },
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.window = {
    location: { href: 'https://chat.deepseek.com/' },
    addEventListener: () => {},
    electronAPI: {
      executeJs: vi.fn(async () => ({ success: true, output: 'ok' })),
      reportToolActivity: vi.fn(async () => ({ success: true })),
    },
  };
}

beforeEach(async () => {
  vi.resetModules();
  setupGlobals();
  executor = await import('../../../src/bridge/loop/executor.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function reports() {
  return window.electronAPI.reportToolActivity.mock.calls.map((c) => c[0]);
}

test('handleJsToolScript 成功返回结果', async () => {
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true, output: '输出内容' }));
  const r = await executor.handleJsToolScript('const x = 1;');
  assert.strictEqual(r.code, 'const x = 1;');
  assert.strictEqual(r.result.success, true);
  assert.strictEqual(r.result.output, '输出内容');
});

test('handleJsToolScript 上报 running → done 两阶段（同 id）', async () => {
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true, output: 'ok' }));
  await executor.handleJsToolScript('const x = 1;');
  const entries = reports();
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].status, 'running');
  assert.strictEqual(entries[0].output, '');
  assert.strictEqual(entries[1].status, 'done');
  assert.strictEqual(entries[1].id, entries[0].id);
  assert.strictEqual(entries[1].success, true);
  assert.strictEqual(entries[1].output, 'ok');
});

test('上报条目的 command 存完整脚本（截断由 shell 列表显示层负责）', async () => {
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true, output: '' }));
  const longCode = 'a'.repeat(100);
  await executor.handleJsToolScript(longCode);
  const entries = reports();
  assert.strictEqual(entries[0].command, '[JS] ' + longCode);
  assert.strictEqual(entries[1].command, '[JS] ' + longCode);
});

test('多行脚本 command 存全文（含换行）', async () => {
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true }));
  await executor.handleJsToolScript('first line\nsecond line');
  const entries = reports();
  assert.strictEqual(entries[0].command, '[JS] first line\nsecond line');
});

test('handleJsToolScript 失败：done 条目 success=false 且 output 为错误', async () => {
  window.electronAPI.executeJs = vi.fn(async () => ({ success: false, error: '执行出错' }));
  const r = await executor.handleJsToolScript('bad code');
  assert.strictEqual(r.result.success, false);
  assert.strictEqual(r.result.error, '执行出错');
  const entries = reports();
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[1].status, 'done');
  assert.strictEqual(entries[1].success, false);
  assert.strictEqual(entries[1].output, '执行出错');
});

test('handleJsToolScript executeJs 抛异常：返回系统异常且 done 条目带异常信息', async () => {
  window.electronAPI.executeJs = vi.fn(async () => { throw new Error('系统崩溃'); });
  const r = await executor.handleJsToolScript('code');
  assert.strictEqual(r.result.success, false);
  assert.ok(r.result.error.includes('系统异常'));
  assert.ok(r.result.error.includes('系统崩溃'));
  const entries = reports();
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[1].status, 'done');
  assert.strictEqual(entries[1].success, false);
  assert.ok(entries[1].output.includes('系统崩溃'));
});

test('handleJsToolScript 成功但无 output：done 条目 output 为空字符串', async () => {
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true }));
  const r = await executor.handleJsToolScript('code');
  assert.strictEqual(r.result.success, true);
  const entries = reports();
  assert.strictEqual(entries[1].output, '');
});

test('reportToolActivity 不存在时静默跳过，执行照常返回', async () => {
  delete window.electronAPI.reportToolActivity;
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true, output: 'ok' }));
  const r = await executor.handleJsToolScript('code');
  assert.strictEqual(r.result.success, true);
});

test('reportToolActivity 抛异常时不影响执行结果', async () => {
  window.electronAPI.reportToolActivity = vi.fn(() => { throw new Error('桥断开'); });
  window.electronAPI.executeJs = vi.fn(async () => ({ success: true, output: 'ok' }));
  const r = await executor.handleJsToolScript('code');
  assert.strictEqual(r.result.success, true);
});

'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { JsRunner } from '../../src/tools/runtime/JsRunner.js';
import { registry } from '../../src/tools/index.js';

test('JsRunner 执行简单 JS 代码', async () => {
  const runner = new JsRunner(registry);
  const r = await runner.run('const x = 1 + 2; log(x);', process.cwd());
  assert.strictEqual(r.success, true);
  assert.ok(r.output.includes('3'));
});

test('JsRunner 空代码报错', async () => {
  const runner = new JsRunner(registry);
  const r = await runner.run('', null);
  assert.strictEqual(r.success, false);
  assert.match(r.error, /无效的 JS 代码/);
});

test('JsRunner null 代码报错', async () => {
  const runner = new JsRunner(registry);
  const r = await runner.run(null, null);
  assert.strictEqual(r.success, false);
});

test('JsRunner 语法错误返回失败', async () => {
  const runner = new JsRunner(registry);
  let r;
  try { r = await runner.run('const = ;', process.cwd()); } catch (e) { r = { success: false, error: e.message }; }
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
});

test('JsRunner 调用 read 工具', async () => {
  const runner = new JsRunner(registry);
  const r = await runner.run('const c = await read("package.json"); log(c.slice(0, 20));', process.cwd());
  assert.strictEqual(r.success, true);
  assert.ok(r.output.length > 0);
});

test('JsRunner 未知工具报错', async () => {
  const runner = new JsRunner(registry);
  const r = await runner.run('await read("a.txt")', null);
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
});

test('JsRunner 沙箱支持 sleep', async () => {
  const runner = new JsRunner(registry);
  const t0 = Date.now();
  const r = await runner.run('await sleep(50); log("done");', process.cwd());
  assert.strictEqual(r.success, true);
  assert.ok(r.output.includes('done'));
  assert.ok(Date.now() - t0 >= 40);
});

test('JsRunner 沙箱支持 setTimeout', async () => {
  const runner = new JsRunner(registry);
  const r = await runner.run('await new Promise(res => setTimeout(() => { log("timed"); res(); }, 30));', process.cwd());
  assert.strictEqual(r.success, true);
  assert.ok(r.output.includes('timed'));
});


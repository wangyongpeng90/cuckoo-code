'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { detectWrongToolFormat } = require('../../src/preload/dom/format-hint');

test('检测 XML invoke 族', () => {
  assert.strictEqual(detectWrongToolFormat('<invoke name="read">').detected, true);
  assert.strictEqual(detectWrongToolFormat('<function_calls>\n<invoke>').detected, true);
  assert.strictEqual(detectWrongToolFormat('</invoke>').detected, true);
  assert.strictEqual(detectWrongToolFormat('<parameter name="path">/a</parameter>').detected, true);
  assert.strictEqual(detectWrongToolFormat('<tool_call>{"name":"read"}</tool_call>').detected, true);
});

test('检测 AntML/特殊 token 变体', () => {
  assert.strictEqual(detectWrongToolFormat('｜｜DSML｜｜调用').detected, true);
  assert.strictEqual(detectWrongToolFormat('<|assistant|>我来操作').detected, true);
});

test('检测 JSON 工具调用对象', () => {
  assert.strictEqual(detectWrongToolFormat('{"name": "read", "arguments": {"path": "a.txt"}}').detected, true);
});

test('正常内容不误报', () => {
  assert.strictEqual(detectWrongToolFormat('这是普通文本回复').detected, false);
  assert.strictEqual(detectWrongToolFormat('```cuckoo\nawait read("a")\n```').detected, false);
  assert.strictEqual(detectWrongToolFormat('').detected, false);
  assert.strictEqual(detectWrongToolFormat(null).detected, false);
  // 讨论 XML 本身但没有工具调用结构的文章不应误报
  assert.strictEqual(detectWrongToolFormat('XML 的 invoke 机制是一种调用约定').detected, false);
  // 普通代码（name: 没有 arguments 结构）
  assert.strictEqual(detectWrongToolFormat('const config = { name: "app" };').detected, false);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const {
  createChatgptDriver,
  buildSendScript,
  normalizeResult,
} = require('../../src/main/chatgpt-driver');

test('buildSendScript 生成自包含且语法合法的注入脚本', () => {
  const src = buildSendScript('你好', {});
  // 可编译（异步 IIFE）
  new Function('return ' + src);
  // 自包含：不引用模块作用域
  assert.ok(!/\brequire\s*\(/.test(src), '不应包含 require');
  // 关键选择器/契约存在
  assert.ok(src.includes('data-message-author-role="assistant"'), '应基于 assistant 消息容器');
  assert.ok(src.includes('data-testid="send-button"'), '应含发送按钮选择器');
  assert.ok(src.includes('data-testid="stop-button"'), '完成判定应依赖停止按钮边沿（防长回复截断）');
  assert.ok(src.includes('ProseMirror'), '应含 ChatGPT 输入框选择器');
  // 提示词被安全转义为 JSON 字符串（防注入）
  const src2 = buildSendScript('a"b\\c\nnewline', {});
  assert.ok(src2.includes(JSON.stringify('a"b\\c\nnewline')));
});

test('normalizeResult 处理对象/JSON 字符串/裸文本/异常', () => {
  assert.deepStrictEqual(normalizeResult({ ok: true, text: 'hi' }), { ok: true, text: 'hi' });
  assert.deepStrictEqual(normalizeResult('{"ok":true,"text":"hi"}'), { ok: true, text: 'hi' });
  assert.deepStrictEqual(normalizeResult('裸文本回复'), { ok: true, text: '裸文本回复' });
  assert.strictEqual(normalizeResult({ ok: false, error: '未登录' }).ok, false);
  assert.strictEqual(normalizeResult(null).ok, false);
  assert.strictEqual(normalizeResult(12345).ok, false);
});

test('driver.ask 把脚本交给 exec 并返回文本', async () => {
  const seen = [];
  const driver = createChatgptDriver(async (script) => {
    seen.push(script);
    return { ok: true, text: '来自 ChatGPT 的回复' };
  });
  const text = await driver.ask('测试提示');
  assert.strictEqual(text, '来自 ChatGPT 的回复');
  assert.strictEqual(seen.length, 1);
  assert.ok(seen[0].includes(JSON.stringify('测试提示')));
});

test('driver.ask 空提示抛错，不调用 exec', async () => {
  let called = 0;
  const driver = createChatgptDriver(async () => { called++; return { ok: true, text: 'x' }; });
  await assert.rejects(() => driver.ask('   '), /prompt 不能为空/);
  assert.strictEqual(called, 0);
});

test('driver.ask 页面报错时抛出该错误', async () => {
  const driver = createChatgptDriver(async () => ({ ok: false, error: '未找到 ChatGPT 输入框' }));
  await assert.rejects(() => driver.ask('hi'), /未找到 ChatGPT 输入框/);
});

test('createChatgptDriver 缺 exec 抛错', () => {
  assert.throws(() => createChatgptDriver(null), /exec/);
});

test('buildSendScript 填入文本后等待发送按钮出现再点击（非直接合成 Enter）', () => {
  const src = buildSendScript('hi', {});
  // 应包含"轮询等待发送按钮"逻辑
  assert.ok(/while\s*\(Date\.now\(\)\s*-\s*tSend\s*<\s*8000\)/.test(src), '应轮询等待发送按钮');
  assert.ok(src.indexOf('btn.click()') < src.indexOf('dispatchEvent(new KeyboardEvent'), '优先点击按钮，Enter 仅兜底');
});

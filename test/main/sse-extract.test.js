'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const {
  cuckooSSECreateFrameDecoder,
  cuckooSSEParseBlock,
  cuckooCreateOpenAIExtractor,
  cuckooCreateChatgptExtractor,
} = require('../../src/shared/sse-extract');
const { chatgptHookSource } = require('../../src/interceptor/chatgpt-hook');

// ---------- 帧解码 ----------

test('frameDecoder 按空行切帧并跨 chunk 缓冲', () => {
  const fd = cuckooSSECreateFrameDecoder();
  let frames = fd.push('data: a\n\ndata: b\n');
  assert.deepStrictEqual(frames, ['data: a']);
  frames = fd.push('\ndata: c\n\n');
  assert.deepStrictEqual(frames, ['data: b', 'data: c']);
  assert.deepStrictEqual(fd.finish(), []);
});

test('frameDecoder finish 吐出未闭合尾帧', () => {
  const fd = cuckooSSECreateFrameDecoder();
  fd.push('data: tail-no-blank');
  assert.deepStrictEqual(fd.finish(), ['data: tail-no-blank']);
});

test('parseBlock 聚合多行 data 并识别 [DONE]', () => {
  assert.deepStrictEqual(cuckooSSEParseBlock('data: hello\ndata: world'), { data: 'hello\nworld', done: false });
  assert.deepStrictEqual(cuckooSSEParseBlock('data: [DONE]'), { data: null, done: true });
  assert.deepStrictEqual(cuckooSSEParseBlock('event: ping\nid: 7'), { data: null, done: false });
  assert.deepStrictEqual(cuckooSSEParseBlock(''), { data: null, done: false });
});

// ---------- OpenAI 提取器 ----------

test('openai 提取器累加 delta.content 并在 finish_reason 完成', () => {
  const ex = cuckooCreateOpenAIExtractor();
  ex.consume({ choices: [{ delta: { content: 'Hel' } }] });
  assert.strictEqual(ex.text, 'Hel');
  assert.strictEqual(ex.finished, false);
  ex.consume({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] });
  assert.strictEqual(ex.text, 'Hello');
  assert.strictEqual(ex.finished, true);
});

test('openai 提取器忽略无 choices/error 体标记完成', () => {
  const ex = cuckooCreateOpenAIExtractor();
  ex.consume({ usage: { total_tokens: 3 } });
  assert.strictEqual(ex.text, '');
  ex.consume({ error: { message: 'quota' } });
  assert.strictEqual(ex.finished, true);
});

test('openai 提取器不吞掉空 delta 帧且采纳非流式 message', () => {
  const ex = cuckooCreateOpenAIExtractor();
  ex.consume({ choices: [{ delta: {} }] });
  ex.consume({ choices: [{ message: { content: 'whole' } }] });
  assert.strictEqual(ex.text, 'whole');
});

// ---------- ChatGPT 网页流提取器（对应原 hook 内联实现） ----------

test('chatgpt 提取器 裸 v 帧追加正文', () => {
  const ex = cuckooCreateChatgptExtractor();
  ex.consume({ v: '你好' });
  ex.consume({ v: '，世界' });
  assert.strictEqual(ex.text, '你好，世界');
  assert.strictEqual(ex.finished, false);
});

test('chatgpt 提取器 append/replace 路径操作', () => {
  const ex = cuckooCreateChatgptExtractor();
  ex.consume({ p: '/message/content/parts/0', o: 'append', v: 'AB' });
  ex.consume({ p: '/message/content/parts/0', o: 'append', v: 'CD' });
  assert.strictEqual(ex.text, 'ABCD');
  ex.consume({ p: '/message/content/parts/0', o: 'replace', v: 'XY' });
  assert.strictEqual(ex.text, 'XY');
});

test('chatgpt 提取器 assistant 快照整体替换、user 快照忽略', () => {
  const ex = cuckooCreateChatgptExtractor();
  ex.consume({ o: 'add', v: { message: { author: { role: 'assistant' }, content: { parts: ['full ', 'text'] } } } });
  assert.strictEqual(ex.text, 'full text');
  ex.consume({ o: 'add', v: { message: { author: { role: 'user' }, content: { parts: ['ignored'] } } } });
  assert.strictEqual(ex.text, 'full text');
});

test('chatgpt 提取器 patch 批量操作递归应用', () => {
  const ex = cuckooCreateChatgptExtractor();
  ex.consume({ o: 'patch', v: [
    { p: '/message/content/parts/0', o: 'append', v: 'a' },
    { p: '/message/content/parts/0', o: 'append', v: 'b' },
  ] });
  assert.strictEqual(ex.text, 'ab');
});

test('chatgpt 提取器 status/end_turn/类型化事件判定完成', () => {
  const a = cuckooCreateChatgptExtractor();
  a.consume({ p: '/message/status', o: 'replace', v: 'finished_successfully' });
  assert.strictEqual(a.finished, true);

  const b = cuckooCreateChatgptExtractor();
  b.consume({ p: '/message/end_turn', o: 'replace', v: true });
  assert.strictEqual(b.finished, true);

  const c = cuckooCreateChatgptExtractor();
  c.consume({ type: 'message_stream_complete' });
  assert.strictEqual(c.finished, true);
});

test('chatgpt 提取器未知帧不崩溃', () => {
  const ex = cuckooCreateChatgptExtractor();
  ex.consume(null);
  ex.consume({ unrelated: 1 });
  ex.consume({ p: '/some/other/path', v: 'x' });
  assert.strictEqual(ex.text, '');
  assert.strictEqual(ex.finished, false);
});

// ---------- 注入源码完整性 ----------

test('chatgptHookSource 生成的注入源码语法合法且自包含', () => {
  const src = chatgptHookSource();
  // 语法检查（不执行）：拼装后的页面源码必须可编译
  new Function(src);
  // 自包含检查：不得残留 require / module / 外部标识符引用
  assert.ok(!/\brequire\s*\(/.test(src), '注入源码不应包含 require');
  assert.ok(!/\bmodule\.exports\b/.test(src), '注入源码不应包含 module.exports');
  // 三个共享函数必须以 var 声明在源码顶部
  assert.ok(src.includes('var cuckooSSECreateFrameDecoder = function'));
  assert.ok(src.includes('var cuckooSSEParseBlock = function'));
  assert.ok(src.includes('var cuckooCreateChatgptExtractor = function'));
});

test('chatgptHookSource 在桩世界中安装并挂 fetch 钩子', () => {
  const src = chatgptHookSource();
  const calls = [];
  const origFetch = function () { return Promise.resolve({}); };
  const win = {
    fetch: origFetch,
    dispatchEvent: (ev) => calls.push(ev),
    addEventListener: () => {},
  };
  const sandboxDoc = { baseURI: 'https://chatgpt.com/' };
  function FakeCustomEvent(type, opts) { this.type = type; this.detail = opts && opts.detail; }
  function FakeXHR() {}
  FakeXHR.prototype = { open() {}, send() {}, addEventListener() {} };
  const fn = new Function('window', 'document', 'CustomEvent', 'XMLHttpRequest', 'TextDecoder',
    src + '\n;return window;');
  const out = fn(win, sandboxDoc, FakeCustomEvent, FakeXHR, function () {});
  assert.strictEqual(out.__cuckooChatgptHookInstalled__, true, '安装标记应存在');
  assert.notStrictEqual(win.fetch, origFetch, 'fetch 应被替换为包装函数');
  // 包装函数对非 conversation 请求原样透传
  const p = win.fetch('https://chatgpt.com/backend-api/conversations', { method: 'GET' });
  assert.ok(p && typeof p.then === 'function');
});

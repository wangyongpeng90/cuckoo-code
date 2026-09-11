'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { getProvider, getAllProviders, getProviderByUrl } = require('../../src/providers');
const deepseek = require('../../src/providers/deepseek');
const claude = require('../../src/providers/claude');
const chatgpt = require('../../src/providers/chatgpt');

test('getAllProviders 包含 deepseek 和 claude', () => {
  const all = getAllProviders();
  assert.ok(all.length >= 2);
  assert.ok(all.some(p => p.id === 'deepseek'));
  assert.ok(all.some(p => p.id === 'claude'));
});

test('getProvider 按 id 查找', () => {
  assert.strictEqual(getProvider('deepseek').id, 'deepseek');
  assert.strictEqual(getProvider('claude').id, 'claude');
  assert.strictEqual(getProvider('unknown'), null);
});

test('getProviderByUrl 识别 DeepSeek URL', () => {
  assert.strictEqual(getProviderByUrl('https://chat.deepseek.com/').id, 'deepseek');
  assert.strictEqual(getProviderByUrl('https://chat.deepseek.com/a/chat/s/abc').id, 'deepseek');
});

test('getProviderByUrl 识别 Claude URL', () => {
  assert.strictEqual(getProviderByUrl('https://claude.ai/new').id, 'claude');
  assert.strictEqual(getProviderByUrl('https://claude.ai/chat/abc').id, 'claude');
});

test('getProviderByUrl 未识别返回 null', () => {
  assert.strictEqual(getProviderByUrl('https://example.com'), null);
  assert.strictEqual(getProviderByUrl(null), null);
});

test('deepseek matchesUrl', () => {
  assert.strictEqual(deepseek.matchesUrl('https://chat.deepseek.com/'), true);
  assert.strictEqual(deepseek.matchesUrl('https://claude.ai'), false);
});

test('claude matchesUrl', () => {
  assert.strictEqual(claude.matchesUrl('https://claude.ai/new'), true);
  assert.strictEqual(claude.matchesUrl('https://chat.deepseek.com'), false);
});

test('deepseek extractSessionId', () => {
  assert.strictEqual(deepseek.extractSessionId('https://chat.deepseek.com/a/chat/s/abc123'), 'abc123');
  assert.strictEqual(deepseek.extractSessionId('https://chat.deepseek.com/s/def456'), 'def456');
  assert.strictEqual(deepseek.extractSessionId('https://chat.deepseek.com/'), null);
});

test('claude extractSessionId', () => {
  assert.strictEqual(claude.extractSessionId('https://claude.ai/chat/abc123'), 'abc123');
  assert.strictEqual(claude.extractSessionId('https://claude.ai/new'), null);
});

test('deepseek isUserMessage 检测 data-role=user', () => {
  const node = { parentElement: null, getAttribute: (n) => n === 'data-role' ? 'user' : '' };
  assert.strictEqual(deepseek.isUserMessage(node), true);
});

test('deepseek isUserMessage 检测普通节点返回 false', () => {
  const node = { parentElement: null, getAttribute: () => '', className: '', textContent: 'normal' };
  assert.strictEqual(deepseek.isUserMessage(node), false);
});

test('claude isUserMessage 检测 data-testid=user-message', () => {
  const node = { parentElement: null, getAttribute: (n) => n === 'data-testid' ? 'user-message' : '' };
  assert.strictEqual(claude.isUserMessage(node), true);
});

test('deepseek getCodeBlockLanguage 从 data-language 提取', () => {
  const pre = {
    getAttribute: (n) => n === 'data-language' ? 'cuckoo' : '',
    closest: () => null,
    querySelector: () => null,
    classList: [],
  };
  assert.strictEqual(deepseek.getCodeBlockLanguage(pre), 'cuckoo');
});

test('claude getCodeBlockLanguage 从 language-* 提取', () => {
  const pre = {
    querySelector: () => ({ className: 'language-cuckoo' }),
  };
  assert.strictEqual(claude.getCodeBlockLanguage(pre), 'cuckoo');
});

test('deepseek getMessageMarkdown 提取消息根节点', () => {
  const msg = { querySelector: (sel) => sel === ':scope > .ds-markdown' ? 'MARKDOWN' : null };
  assert.strictEqual(deepseek.getMessageMarkdown(msg), 'MARKDOWN');
});

test('claude getMessageMarkdown 优先 standard-markdown', () => {
  const msg = {
    querySelector: (sel) => sel === '[class*="standard-markdown"]' ? 'STD' : null,
  };
  assert.strictEqual(claude.getMessageMarkdown(msg), 'STD');
});

test('chatgpt matchesUrl', () => {
  assert.strictEqual(chatgpt.matchesUrl('https://chatgpt.com/'), true);
  assert.strictEqual(chatgpt.matchesUrl('https://chat.openai.com/c/abc'), true);
  assert.strictEqual(chatgpt.matchesUrl('https://chat.deepseek.com'), false);
});

test('chatgpt extractSessionId 排除 WEB 中间态', () => {
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/c/abc-123_def'), 'abc-123_def');
  // 创建会话中间态 /c/WEB:xxx 不应把 WEB 当会话 ID（正则只匹配 UUID 片段）
  assert.notStrictEqual(chatgpt.extractSessionId('https://chatgpt.com/c/WEB:abc'), 'WEB');
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/'), null);
});

test('chatgpt getCodeBlockLanguage 从 class 提取', () => {
  const pre = {
    querySelector: () => ({ className: 'language-cuckoo' }),
    className: '',
  };
  assert.strictEqual(chatgpt.getCodeBlockLanguage(pre), 'cuckoo');
});

test('chatgpt getCodeBlockLanguage 从 header 文本提取', () => {
  // 无 class 语言标记时，从 header（移除 svg/button 后）取纯文本
  const header = {
    cloneNode: () => ({
      querySelectorAll: () => [],
      textContent: 'cuckoo',
    }),
  };
  const pre = {
    querySelector: (sel) => sel.includes('items-center') ? header : null,
    className: '',
  };
  assert.strictEqual(chatgpt.getCodeBlockLanguage(pre), 'cuckoo');
});

test('chatgpt getMessageCandidates 过滤用户消息', () => {
  const origDoc = global.document;
  const assistant = { getAttribute: (n) => n === 'data-message-author-role' ? 'assistant' : '' };
  const user = { getAttribute: (n) => n === 'data-message-author-role' ? 'user' : '' };
  global.document = {
    querySelectorAll: () => [assistant, user],
  };
  try {
    const list = chatgpt.getMessageCandidates();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0], assistant);
  } finally {
    global.document = origDoc;
  }
});

test('渲染进程经注入的 userData 路径可加载自定义 Provider', () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-cp-'));
  const dir = path.join(tmp, 'custom-providers');
  fs.mkdirSync(dir, { recursive: true });
  const providerFile = path.join(dir, 'demo.js');
  fs.writeFileSync(providerFile,
    "module.exports = { id: 'demo', name: 'Demo', homeUrl: 'https://demo.example.com', " +
    "matchesUrl: (u) => String(u).includes('demo.example.com'), extractSessionId: () => '1' };");
  fs.writeFileSync(path.join(tmp, 'custom-providers.json'),
    JSON.stringify({ paths: [providerFile.replace(/\\/g, '/')] }));

  const savedArgv = process.argv;
  const savedType = process.type;
  process.type = 'renderer';
  process.argv = savedArgv.concat(['--cuckoo-user-data=' + tmp]);
  const loaderPath = require.resolve('../../src/providers/custom/loader');
  delete require.cache[loaderPath];
  try {
    const { loadCustomProviders } = require(loaderPath);
    const ps = loadCustomProviders();
    assert.ok(ps.some((p) => p.id === 'demo'), '渲染进程应能加载注入路径下的自定义 Provider');
  } finally {
    process.type = savedType;
    process.argv = savedArgv;
    delete require.cache[loaderPath];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

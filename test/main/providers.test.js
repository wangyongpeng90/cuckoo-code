import { test, vi } from 'vitest';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { getProvider, getAllProviders, getProviderByUrl } from '../../src/providers/registry.js';
import { deepseek } from '../../src/providers/deepseek.js';
import { claude } from '../../src/providers/claude.js';
import { chatgpt } from '../../src/providers/chatgpt.js';

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

test('chatgpt matchesUrl', () => {
  assert.strictEqual(chatgpt.matchesUrl('https://chatgpt.com/'), true);
  assert.strictEqual(chatgpt.matchesUrl('https://chat.openai.com/c/abc'), true);
  assert.strictEqual(chatgpt.matchesUrl('https://chat.deepseek.com'), false);
});

test('chatgpt extractSessionId 只认完整 UUID，排除中间态', () => {
  const uuid = '6acae293-4d08-83e8-a58b-2a5c865a1df5';
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/c/' + uuid), uuid);
  // 创建会话中间态 /c/WEB:xxx、/c/local-chatgpt 等均非真实会话 ID，必须返回 null。
  // 否则 session-store 会据此绑定 projectDir 并清空暂存目录，导致初始化后拿不到项目目录。
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/c/WEB:abc'), null);
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/c/local-chatgpt'), null);
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/c/abc-123_def'), null);
  assert.strictEqual(chatgpt.extractSessionId('https://chatgpt.com/'), null);
});

test('渲染进程经注入的 userData 路径可加载自定义 Provider', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-cp-'));
  const dir = path.join(tmp, 'custom-providers');
  fs.mkdirSync(dir, { recursive: true });
  const providerFile = path.join(dir, 'demo.js');
  fs.writeFileSync(providerFile,
    "module.exports = { id: 'demo', name: 'Demo', homeUrl: 'https://demo.example.com', " +
    "sessionUrlBase: 'https://demo.example.com/chat/', " +
    "matchesUrl: (u) => String(u).includes('demo.example.com'), extractSessionId: () => '1' };");
  fs.writeFileSync(path.join(tmp, 'custom-providers.json'),
    JSON.stringify({ paths: [providerFile.replace(/\\/g, '/')] }));

  const savedArgv = process.argv;
  const savedType = process.type;
  process.type = 'renderer';
  process.argv = savedArgv.concat(['--cuckoo-user-data=' + tmp]);
  try {
    // loader 有模块级副作用（加载时读 process.type/argv），
    // 用 resetModules + 动态 import 让它重新求值
    vi.resetModules();
    const { loadCustomProviders } = await import('../../src/providers/custom/loader.js');
    const ps = loadCustomProviders();
    assert.ok(ps.some((p) => p.id === 'demo'), '渲染进程应能加载注入路径下的自定义 Provider');
  } finally {
    process.type = savedType;
    process.argv = savedArgv;
    vi.resetModules();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

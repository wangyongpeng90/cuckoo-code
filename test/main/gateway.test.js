'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const gateway = require('../../src/providers/gateway');
const {
  createGatewayStore,
  normalizeBaseUrl,
  looksLikeHttpUrl,
  maskApiKey,
} = require('../../src/main/gateway-store');
const { streamCompletion, completionUrl, buildRequestBody } = require('../../src/main/gateway-client');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-gw-test-'));
}

// ---------- Provider 基本契约 ----------

test('gateway provider 注册与 URL 识别（含 ?/# 会话形式）', () => {
  assert.strictEqual(gateway.id, 'gateway');
  assert.strictEqual(gateway.useIntercept, true);
  assert.strictEqual(gateway.selfDispatches, true, 'preload 依此跳过网络 hook 注入');
  assert.ok(gateway.homeUrl.startsWith('file:'));

  assert.strictEqual(gateway.matchesUrl(gateway.homeUrl), true);
  assert.strictEqual(gateway.matchesUrl(gateway.homeUrl + '?session=gw-1'), true);
  assert.strictEqual(gateway.matchesUrl(gateway.homeUrl + '#session=gw-1'), true);
  assert.strictEqual(gateway.matchesUrl('file:///C:/other/select.html'), false);
  assert.strictEqual(gateway.matchesUrl('https://chatgpt.com/'), false);

  // 本地页不进首页模式（覆盖层保持工作态）
  assert.strictEqual(gateway.homeUrlPattern, undefined);
});

test('gateway extractSessionId 支持 query 与 hash 携带', () => {
  assert.strictEqual(gateway.extractSessionId('file:///a/gateway.html?session=gw-abc_123'), 'gw-abc_123');
  assert.strictEqual(gateway.extractSessionId('file:///a/gateway.html#session=gw-xyz'), 'gw-xyz');
  assert.strictEqual(gateway.extractSessionId('file:///a/gateway.html'), null);
  assert.strictEqual(gateway.extractSessionId(''), null);
});

test('gateway sessionUrlBase 为 base URL 补 query 形式', () => {
  assert.ok(gateway.sessionUrlBase.startsWith(gateway.homeUrl));
  assert.ok(gateway.sessionUrlBase.includes('session='));
});

test('gateway triggerSend 经 CustomEvent 派发文本', () => {
  const events = [];
  global.window = {
    dispatchEvent: (ev) => events.push(ev),
  };
  global.CustomEvent = function (type, opts) { this.type = type; this.detail = opts && opts.detail; };
  try {
    const p = gateway.triggerSend({ value: ' hello ' });
    assert.ok(p instanceof Promise);
    return p.then((ok) => {
      assert.strictEqual(ok, true);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'cuckoo-gateway-send');
      assert.strictEqual(events[0].detail.text, ' hello ');
      // 空文本不派发
      const before = events.length;
      return gateway.triggerSend({ value: '   ' }).then((ok2) => {
        assert.strictEqual(ok2, false);
        assert.strictEqual(events.length, before);
      });
    });
  } finally {
    // 不永久污染全局（node --test 同进程跑多文件时避免串扰）
  }
});

// ---------- Store ----------

test('store 默认配置与脱敏', () => {
  const s = createGatewayStore(tmpDir());
  const cfg = s.getConfig();
  assert.strictEqual(cfg.baseUrl, 'https://api.openai.com/v1');
  assert.strictEqual(cfg.apiKey, '');
  const safe = s.getConfigSafe();
  assert.strictEqual(safe.configured, false);
  assert.strictEqual(maskApiKey('sk-secret-1234abcd'), '****abcd');
  assert.strictEqual(maskApiKey(''), '');
});

test('store saveConfig 校验并持久化；key 只留在主进程文件', () => {
  const dir = tmpDir();
  const s = createGatewayStore(dir);
  let r = s.saveConfig({ baseUrl: 'ftp://bad' });
  assert.strictEqual(r.success, false);
  r = s.saveConfig({ baseUrl: 'https://gw.local/v1///', apiKey: 'sk-abcdef1234', model: 'gpt-4o' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.config.baseUrl, 'https://gw.local/v1');
  assert.strictEqual(r.config.apiKeyMasked, '****1234');
  assert.ok(!JSON.stringify(r).includes('sk-abcdef1234'), '返回值不得含明文 key');

  // 重新加载可见持久化
  const s2 = createGatewayStore(dir);
  assert.strictEqual(s2.getConfig().apiKey, 'sk-abcdef1234');

  // apiKey 传空串 = 清除；undefined = 保持
  s2.saveConfig({ apiKey: '' });
  assert.strictEqual(s2.getConfig().apiKey, '');
});

test('store 会话历史追加/裁剪/清空', () => {
  const s = createGatewayStore(tmpDir());
  s.appendMessages('c1', [{ role: 'user', content: 'a' }]);
  s.appendMessages('c1', [{ role: 'assistant', content: 'b' }]);
  assert.deepStrictEqual(s.getHistory('c1').map(m => m.role), ['user', 'assistant']);
  // 超长裁剪到 60
  const big = [];
  for (let i = 0; i < 100; i++) big.push({ role: 'user', content: 'm' + i });
  s.setHistory('c2', big);
  assert.strictEqual(s.getHistory('c2').length, 60);
  assert.strictEqual(s.getHistory('c2')[59].content, 'm99');
  s.clearHistory('c2');
  assert.deepStrictEqual(s.getHistory('c2'), []);
  assert.deepStrictEqual(s.getHistory('missing'), []);
});

test('normalizeBaseUrl / looksLikeHttpUrl', () => {
  assert.strictEqual(normalizeBaseUrl('https://a.com/v1///'), 'https://a.com/v1');
  assert.strictEqual(normalizeBaseUrl(''), 'https://api.openai.com/v1');
  assert.strictEqual(looksLikeHttpUrl('https://x'), true);
  assert.strictEqual(looksLikeHttpUrl('javascript:alert(1)'), false);
  assert.strictEqual(looksLikeHttpUrl(null), false);
});

// ---------- Client ----------

test('completionUrl 拼接与幂等', () => {
  assert.strictEqual(completionUrl('https://gw/v1'), 'https://gw/v1/chat/completions');
  assert.strictEqual(completionUrl('https://gw/v1/'), 'https://gw/v1/chat/completions');
  assert.strictEqual(completionUrl('https://gw/v1/chat/completions'), 'https://gw/v1/chat/completions');
});

test('buildRequestBody 固定 stream:true 并透传参数', () => {
  const body = JSON.parse(buildRequestBody({
    model: 'gpt-4o', temperature: 0.3, messages: [{ role: 'user', content: 'hi' }],
  }));
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.model, 'gpt-4o');
  assert.strictEqual(body.temperature, 0.3);
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'hi' }]);
});

function sseTransport(chunks, statusCode = 200) {
  return function (url, opts) {
    const stream = new PassThrough();
    sseTransport.lastUrl = url;
    sseTransport.lastOpts = opts;
    setImmediate(() => {
      for (const c of chunks) stream.write(Buffer.from(c, 'utf8'));
      stream.end();
    });
    return Promise.resolve({ statusCode, stream });
  };
}

test('streamCompletion 流式累加 + delta 回调 + Bearer 头', async () => {
  const deltas = [];
  const r = await streamCompletion({
    baseUrl: 'https://gw.example/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: (d) => deltas.push(d),
    transport: sseTransport([
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}],"finish_reason":null}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.text, 'Hello');
  assert.deepStrictEqual(deltas, ['He', 'llo']);
  assert.strictEqual(sseTransport.lastUrl, 'https://gw.example/v1/chat/completions');
  assert.strictEqual(sseTransport.lastOpts.headers.Authorization, 'Bearer sk-test');
});

test('streamCompletion 非 2xx 返回错误体片段', async () => {
  const errStream = new PassThrough();
  setImmediate(() => { errStream.end('{"error":{"message":"invalid api key"}}'); });
  const r = await streamCompletion({
    baseUrl: 'https://gw/v1', apiKey: 'sk', model: 'm', messages: [],
    transport: async () => ({ statusCode: 401, stream: errStream }),
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('401'));
  assert.ok(r.error.includes('invalid api key'));
});

test('streamCompletion 网络异常被捕获为 ok:false', async () => {
  const r = await streamCompletion({
    baseUrl: 'https://gw/v1', apiKey: 'sk', model: 'm', messages: [],
    transport: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('ECONNREFUSED'));
});

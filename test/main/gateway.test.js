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
  const kept = s.getHistory('c2');
  assert.ok(kept.length <= 60, '裁剪后不得超上限');
  assert.strictEqual(kept[kept.length - 1].content, 'm99', '最新消息必须保留');
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

// ---------- 本地聊天页契约（防止页面改动造成白屏/链路断裂） ----------

const HTML_PATH = require('path').join(__dirname, '..', '..', 'src', 'ui', 'gateway.html');

test('gateway.html 页面脚本语法合法且 DOM/事件契约完整', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.strictEqual(scripts.length, 2, '应为纯函数区 + 应用区两个脚本块');
  for (const src of scripts) new Function(src); // 语法检查：页面脚本若编译失败，网关页直接白屏

  // Provider/主进程依赖的 DOM 锚点必须存在
  for (const id of ['gateway-input', 'gateway-send', 'gateway-model-label', 'gateway-config-toggle']) {
    assert.ok(html.includes('id="' + id + '"'), '缺少 DOM 锚点 #' + id);
  }
  // 跨世界收发契约
  assert.ok(html.includes("addEventListener('cuckoo-gateway-send'"), '缺少 triggerSend 跨世界接收端');
  assert.ok(html.includes("dispatchEvent(new CustomEvent('cuckoo-ai-response'"), '缺少回复事件派发');
  assert.ok(html.includes("location.hash = 'session='"), '缺少会话 hash 携带');
  assert.ok(html.includes('onGatewayDelta'), '缺少流式增量订阅');
  // 安全：页面不得包含明文 key 处理痕迹（key 只经主进程）
  assert.ok(!/apiKey\s*[:=]\s*['"][^'"]{8,}/.test(html), '页面内不应硬编码 API Key');
});

test('gateway.html Markdown 渲染器：转义优先，杜绝 XSS', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  const utils = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  assert.ok(!/\bdocument\b/.test(utils), '纯函数区不得引用 DOM');
  const get = new Function('window', utils + '\n;return window.__gwMD;');
  const md = get({});
  assert.ok(md && typeof md.renderMD === 'function');

  // XSS 用例：script/img onerror/javascript: 必须被转义或拒绝
  const xss = md.renderMD('<script>alert(1)<\/script> [x](javascript:alert(2)) <img src=x onerror=alert(3)>');
  // 安全不变量：恶意输入不得以任何可执行形式出现
  assert.ok(!xss.includes('<img'), 'img 标签必须被转义');
  assert.ok(!xss.includes('<script'), 'script 标签必须被转义');
  assert.ok(!/href\s*=\s*["']?\s*javascript:/i.test(xss), 'javascript: 不得成为可点击链接');
  assert.ok(xss.includes('&lt;script&gt;') && xss.includes('&lt;img'), '恶意内容应以转义实体呈现（惰性文本）');

  // 功能用例：代码块/行内代码/粗体/列表
  const r = md.renderMD('```cuckoo\nawait read("a")\n```\n- 项目 `x` 与 **粗体**');
  assert.ok(r.includes('class="code-block"'), '应渲染代码块');
  assert.ok(r.includes('>cuckoo<'), '应显示语言标签');
  assert.ok(r.includes('class="copy-btn"'), '应有一键复制');
  assert.ok(r.includes('<code class="inline">x</code>'), '应渲染行内代码');
  assert.ok(r.includes('<strong>粗体</strong>'), '应渲染粗体');
  assert.ok(r.includes('<li>'), '应渲染列表');
  // 代码体内含 HTML 时必须转义（无特殊字符的正常代码保持原样）
  const r2 = md.renderMD('```html\n<img src=x onerror=alert(1)>\n```');
  assert.ok(!r2.includes('<img'), '代码体内的 HTML 必须转义');
  assert.ok(r2.includes('&lt;img'), '代码体应输出转义实体');
});// ---------- 历史裁剪（保首条 + 成对裁剪） ----------

const { trimMessages } = require('../../src/main/gateway-store');

test('trimMessages 不超上限时原样返回', () => {
  const m = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
  assert.deepStrictEqual(trimMessages(m, 60), m);
});

test('trimMessages 保留首条并按 user/assistant 成对裁剪', () => {
  const msgs = [{ role: 'user', content: 'system-prompt' }];
  for (let i = 0; i < 40; i++) {
    msgs.push({ role: 'user', content: 'u' + i });
    msgs.push({ role: 'assistant', content: 'a' + i });
  }
  const out = trimMessages(msgs, 60);
  assert.ok(out.length <= 60, '不得超过上限');
  assert.deepStrictEqual(out[0], msgs[0], '首条（初始提示）必须保留');
  // 尾部必须是完整配对：user 后紧跟 assistant
  for (let i = 1; i < out.length - 1; i += 2) {
    assert.strictEqual(out[i].role, 'user');
    assert.strictEqual(out[i + 1].role, 'assistant');
  }
  assert.strictEqual(out[out.length - 1].content, 'a39', '最新消息必须保留');
});

test('trimMessages 奇数上限时尾部条数取偶（不产生孤儿消息）', () => {
  const msgs = [{ role: 'user', content: 'head' }];
  for (let i = 0; i < 40; i++) {
    msgs.push({ role: 'user', content: 'u' + i });
    msgs.push({ role: 'assistant', content: 'a' + i });
  }
  const out = trimMessages(msgs, 61);
  assert.ok(out.length <= 61, '不得超过上限');
  assert.deepStrictEqual(out[0], msgs[0], '首条必须保留');
  assert.strictEqual((out.length - 1) % 2, 0, '尾部消息数应为偶数（不产生孤儿）');
});

test('store removeLastIfRole 回滚悬挂的 user 消息', () => {
  const s = createGatewayStore(tmpDir());
  s.appendMessages('r1', [{ role: 'user', content: 'q' }]);
  assert.strictEqual(s.removeLastIfRole('r1', 'assistant'), false, '末条不是 assistant 不动');
  assert.strictEqual(s.removeLastIfRole('r1', 'user'), true);
  assert.deepStrictEqual(s.getHistory('r1'), []);
  // 已是空历史时安全
  assert.strictEqual(s.removeLastIfRole('r1', 'user'), false);
});

// ---------- 流空闲超时 ----------


test('streamCompletion: 流空闲超过 idleTimeoutMs 时中止并保留部分文本', async () => {
  const stalled = new PassThrough();
  // 先发一帧，然后长时间沉默（不 end）
  setImmediate(() => stalled.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
  const t0 = Date.now();
  const r = await streamCompletion({
    baseUrl: 'https://gw/v1', apiKey: 'sk', model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    idleTimeoutMs: 250,
    transport: async () => ({ statusCode: 200, stream: stalled }),
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('流空闲超时'), '应报告空闲超时: ' + r.error);
  assert.strictEqual(r.text, 'partial', '已收到的部分文本应保留');
  assert.ok(Date.now() - t0 < 2000, '应快速中止而非等 socket 超时');
  stalled.end(); // 清理测试句柄
});

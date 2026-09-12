'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// 避免 Node 全局 agent 的 keep-alive 连接让测试进程无法退出（导致 runner 超时）
http.globalAgent = new http.Agent({ keepAlive: false });

const {
  createReverseGateway,
  flattenMessages,
  approxTokens,
} = require('../../src/main/reverse-gateway');

// ---------- 纯函数 ----------

test('flattenMessages 单条 user 直接返回原文', () => {
  assert.strictEqual(flattenMessages([{ role: 'user', content: '你好' }]), '你好');
});

test('flattenMessages 多角色拼接并标注角色', () => {
  const s = flattenMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'yo' },
  ]);
  assert.ok(s.includes('[System]\nsys'));
  assert.ok(s.includes('[User]\nhi'));
  assert.ok(s.includes('[Assistant]\nyo'));
});

test('flattenMessages 支持 content 数组形式与空值容错', () => {
  const s = flattenMessages([
    { role: 'user', content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }] },
    null, { role: 'user' },
  ]);
  assert.strictEqual(s, 'part1part2');
  assert.strictEqual(flattenMessages(null), '');
  assert.strictEqual(flattenMessages([]), '');
});

test('approxTokens 对空值返回 0', () => {
  assert.strictEqual(approxTokens(''), 0);
  assert.ok(approxTokens('abcd') >= 1);
});

// ---------- HTTP 服务 ----------

function startGateway(overrides = {}) {
  const calls = [];
  const gw = createReverseGateway(Object.assign({
    port: 0,
    apiKey: 'sk-test',
    defaultModel: 'gpt-4o',
    sendPrompt: async (messages, opts) => { calls.push({ messages, opts }); return 'ECHO:' + opts.prompt; },
  }, overrides));
  return gw.listen().then(() => ({ gw, calls }));
}

function request(port, path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      agent: false, // 不复用连接，避免 keep-alive 句柄挂住测试进程
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    }, (r) => {
      let d = ''; r.on('data', (c) => d += c);
      r.on('end', () => {
        // 显式销毁 socket，防止残留句柄让 node --test 无法退出
        if (r.socket && !r.socket.destroyed) r.socket.destroy();
        resolve({ status: r.statusCode, body: d, headers: r.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('reverse gateway: /health 与 /v1/models', async () => {
  const { gw } = await startGateway();
  try {
    const p = gw.address.port;
    const h = await request(p, '/health', 'GET');
    assert.strictEqual(h.status, 200);
    assert.ok(h.body.includes('ok'));
    const m = await request(p, '/v1/models', 'GET');
    assert.strictEqual(m.status, 200);
    assert.ok(m.body.includes('gpt-4o'));
  } finally { await gw.close(); }
});

test('reverse gateway: 无 key 401，错误 key 401，正确 key 200', async () => {
  const { gw } = await startGateway();
  try {
    const p = gw.address.port;
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    assert.strictEqual((await request(p, '/v1/chat/completions', 'POST', body)).status, 401);
    assert.strictEqual((await request(p, '/v1/chat/completions', 'POST', body, { Authorization: 'Bearer wrong' })).status, 401);
    const ok = await request(p, '/v1/chat/completions', 'POST', body, { Authorization: 'Bearer sk-test' });
    assert.strictEqual(ok.status, 200);
  } finally { await gw.close(); }
});

test('reverse gateway: 非流式返回标准 OpenAI 结构并回填模型名', async () => {
  const { gw, calls } = await startGateway();
  try {
    const p = gw.address.port;
    const r = await request(p, '/v1/chat/completions', 'POST',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello' }] },
      { Authorization: 'Bearer sk-test' });
    assert.strictEqual(r.status, 200);
    const j = JSON.parse(r.body);
    assert.strictEqual(j.object, 'chat.completion');
    assert.strictEqual(j.model, 'gpt-4o-mini');
    assert.strictEqual(j.choices[0].message.role, 'assistant');
    assert.ok(j.choices[0].message.content.includes('ECHO:hello'));
    assert.strictEqual(j.choices[0].finish_reason, 'stop');
    assert.ok(j.usage && typeof j.usage.total_tokens === 'number');
    assert.strictEqual(calls.length, 1, 'sendPrompt 应被调用一次');
  } finally { await gw.close(); }
});

test('reverse gateway: stream:true 返回 SSE 且以 [DONE] 结束', async () => {
  const { gw } = await startGateway();
  try {
    const p = gw.address.port;
    const r = await request(p, '/v1/chat/completions', 'POST',
      { stream: true, messages: [{ role: 'user', content: 'hi' }] },
      { Authorization: 'Bearer sk-test' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.headers['content-type'].includes('text/event-stream'));
    assert.ok(r.body.includes('chat.completion.chunk'));
    assert.ok(r.body.includes('"finish_reason":"stop"'));
    assert.ok(r.body.trim().endsWith('data: [DONE]'));
  } finally { await gw.close(); }
});

test('reverse gateway: 空 messages / 非法 JSON / 未知路径', async () => {
  const { gw } = await startGateway();
  try {
    const p = gw.address.port;
    const e1 = await request(p, '/v1/chat/completions', 'POST', { messages: [] }, { Authorization: 'Bearer sk-test' });
    assert.strictEqual(e1.status, 400);
    const e2 = await request(p, '/v1/chat/completions', 'POST', { messages: [{ role: 'user', content: '   ' }] }, { Authorization: 'Bearer sk-test' });
    assert.strictEqual(e2.status, 400);
    const e3 = await request(p, '/nope', 'GET');
    assert.strictEqual(e3.status, 404);
  } finally { await gw.close(); }
});

test('reverse gateway: sendPrompt 抛错时返回 502 且不崩溃', async () => {
  const { gw } = await startGateway({ sendPrompt: async () => { throw new Error('页面未登录'); } });
  try {
    const p = gw.address.port;
    const r = await request(p, '/v1/chat/completions', 'POST',
      { messages: [{ role: 'user', content: 'hi' }] }, { Authorization: 'Bearer sk-test' });
    assert.strictEqual(r.status, 502);
    assert.ok(r.body.includes('页面未登录'));
    // 服务仍存活
    assert.strictEqual((await request(p, '/health', 'GET')).status, 200);
  } finally { await gw.close(); }
});

test('reverse gateway: apiKey 为空/缺失时拒绝创建（防无鉴权暴露会话）', () => {
  assert.throws(() => createReverseGateway({ sendPrompt: async () => 'x', apiKey: '' }), /apiKey/);
  assert.throws(() => createReverseGateway({ sendPrompt: async () => 'x' }), /apiKey/);
  assert.throws(() => createReverseGateway({ sendPrompt: async () => 'x', apiKey: '   ' }), /apiKey/);
});

test('reverse gateway: 响应不含 CORS 头（消费方是本机程序，非网页）', async () => {
  const { gw } = await startGateway();
  try {
    const p = gw.address.port;
    const h = await request(p, '/health', 'GET');
    assert.strictEqual(h.headers['access-control-allow-origin'], undefined);
  } finally { await gw.close(); }
});

test('reverse gateway: 并发请求被串行化（sendPrompt 不重叠）', async () => {
  let running = 0, overlap = false, order = [];
  const { gw } = await startGateway({
    sendPrompt: async (messages) => {
      if (running > 0) overlap = true;
      running++;
      await new Promise(r => setTimeout(r, 120));
      running--;
      order.push(messages[messages.length - 1].content);
      return 'done';
    },
  });
  try {
    const p = gw.address.port;
    const reqs = ['a', 'b', 'c'].map((c) =>
      request(p, '/v1/chat/completions', 'POST', { messages: [{ role: 'user', content: c }] }, { Authorization: 'Bearer sk-test' })
    );
    const results = await Promise.all(reqs);
    for (const r of results) assert.strictEqual(r.status, 200);
    assert.strictEqual(overlap, false, 'sendPrompt 不得并发执行');
    assert.deepStrictEqual(order, ['a', 'b', 'c'], '应按到达顺序串行处理');
  } finally { await gw.close(); }
});

test('ensureApiToken 首次生成并持久化，之后复用', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-tok-'));
  const { ensureApiToken, readApiToken } = require('../../src/main/reverse-gateway');
  const first = ensureApiToken(dir);
  assert.ok(first.created);
  assert.match(first.token, /^[0-9a-f]{48}$/);
  const second = ensureApiToken(dir);
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.token, first.token);
  assert.strictEqual(readApiToken(dir), first.token);
  // 损坏文件自动重建
  fs.writeFileSync(first.file, 'not json');
  const third = ensureApiToken(dir);
  assert.match(third.token, /^[0-9a-f]{48}$/);
  assert.strictEqual(readApiToken(dir), third.token);
});

test('reverse gateway: createReverseGateway 缺 sendPrompt 抛错', () => {
  assert.throws(() => createReverseGateway({ apiKey: 'k' }), /sendPrompt/);
});

test('reverse gateway: 队列深度上限，超额返回 429 且名额正确释放', async () => {
  let running = 0, maxConcurrent = 0;
  const { gw } = await startGateway({
    maxPending: 3,
    sendPrompt: async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise(r => setTimeout(r, 400)); // 拉长占位，确保 6 个请求都在占满窗口内到达
      running--;
      return 'ok';
    },
  });
  try {
    const p = gw.address.port;
    const body = { messages: [{ role: 'user', content: 'x' }] };
    const headers = { Authorization: 'Bearer sk-test' };
    // 6 个并发：1 执行 + 2 排队（maxPending=3 含执行中），其余 3 个应 429
    const rs = await Promise.all([
      request(p, '/v1/chat/completions', 'POST', body, headers),
      request(p, '/v1/chat/completions', 'POST', body, headers),
      request(p, '/v1/chat/completions', 'POST', body, headers),
      request(p, '/v1/chat/completions', 'POST', body, headers),
      request(p, '/v1/chat/completions', 'POST', body, headers),
      request(p, '/v1/chat/completions', 'POST', body, headers),
    ]);
    const statuses = rs.map(r => r.status).sort();
    assert.strictEqual(statuses.filter(s => s === 429).length, 3, '超额请求应 429');
    assert.strictEqual(statuses.filter(s => s === 200).length, 3, '上限内请求应 200');
    assert.ok(maxConcurrent <= 1, 'sendPrompt 仍须严格串行');
    // 名额已释放：再次请求应 200
    const after = await request(p, '/v1/chat/completions', 'POST', body, headers);
    assert.strictEqual(after.status, 200);
    // /health 暴露当前队列占用
    const h = await request(p, '/health', 'GET');
    assert.ok(h.body.includes('"pending"'));
  } finally { await gw.close(); }
});

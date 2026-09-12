/**
 * 反向网关：把已登录的 ChatGPT 网页会话，暴露成本地 OpenAI 兼容 HTTP API
 *
 * 外部程序 POST http://127.0.0.1:<port>/v1/chat/completions，
 * 本模块把消息转交给「已登录的 ChatGPT 窗口」（由注入的 sendPrompt 完成），
 * 拿到回复文本后按 OpenAI 响应格式返回。
 *
 * 说明：
 * - 仅监听 127.0.0.1（本地回环），强制 Bearer 鉴权（空 key 直接拒绝创建）
 * - 不设 CORS 头：消费方是本机程序而非网页，通配 CORS 会允许任意网页
 *   跨源调用该接口（DNS rebinding/CSRF 面），属不必要攻击面
 * - 走的是"驱动真实已登录页面"而非导出 cookie 重放，对账号风控更温和
 * - 不实现任何反检测/绕过逻辑
 *
 * 设计：sendPrompt(messages, opts) 由调用方注入（主进程里驱动窗口），
 * 使本模块可在 Node 单测中完全离线验证。
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 8788;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 180000;
const TOKEN_FILE = 'api-server-token.json';

/**
 * 确保 API token 存在：首次生成 48 位随机 hex 并持久化到 storeDir，之后复用。
 * @param {string} storeDir userData 目录
 * @returns {{token:string, created:boolean, file:string}}
 */
function ensureApiToken(storeDir) {
  if (!storeDir || typeof storeDir !== 'string') throw new Error('ensureApiToken 需要 storeDir');
  const file = path.join(storeDir, TOKEN_FILE);
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (j && typeof j.token === 'string' && /^[0-9a-f]{32,}$/.test(j.token)) {
        return { token: j.token, created: false, file };
      }
    }
  } catch (_) { /* 损坏则重建 */ }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), 'utf-8');
  return { token, created: true, file };
}

/** 读取已持久化的 token（不存在返回 null）。 */
function readApiToken(storeDir) {
  try {
    const file = path.join(storeDir, TOKEN_FILE);
    const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (j && j.token) || null;
  } catch (_) { return null; }
}

/** 把 OpenAI messages 数组压平成单条提示文本（ChatGPT 网页只接受单条输入） */
function flattenMessages(messages) {
  if (!Array.isArray(messages)) return '';
  const parts = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = String(m.role || 'user');
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('')
        : '';
    if (!content) continue;
    if (role === 'system') parts.push('[System]\n' + content);
    else if (role === 'assistant') parts.push('[Assistant]\n' + content);
    else parts.push('[User]\n' + content);
  }
  // 单条 user 消息时直接返回原文，避免污染提示
  if (parts.length === 1 && /^\[User\]\n/.test(parts[0])) return parts[0].slice('[User]\n'.length);
  return parts.join('\n\n');
}

/** 粗略 token 估算（无真实 tokenizer 时的占位，仅用于响应里的 usage 字段） */
function approxTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(String(text).length / 4));
}

function makeCompletionResponse(model, content, idSeed) {
  const prompt = '';
  return {
    id: 'chatcmpl-' + idSeed,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'gpt-4o',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: content || '' },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: approxTokens(prompt),
      completion_tokens: approxTokens(content),
      total_tokens: approxTokens(prompt) + approxTokens(content),
    },
  };
}

function makeChunk(model, content, idSeed, done) {
  const base = {
    id: 'chatcmpl-' + idSeed,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || 'gpt-4o',
  };
  if (done) {
    return Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  return Object.assign({}, base, { choices: [{ index: 0, delta: { role: 'assistant', content: content || '' }, finish_reason: null }] });
}

function readBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Connection': 'close',
  });
  res.end(body);
}

/**
 * 创建反向网关服务器
 * @param {object} opts
 * @param {function(Array, object):Promise<string>} opts.sendPrompt 驱动 ChatGPT 窗口并返回回复文本
 * @param {number} [opts.port] 监听端口
 * @param {string} [opts.host] 监听地址（默认 127.0.0.1）
 * @param {string} opts.apiKey 必填，Bearer 鉴权 key（空值拒绝创建）
 * @param {number} [opts.timeoutMs] 单次请求超时
 * @param {string} [opts.defaultModel] 响应里回填的模型名
 */
function createReverseGateway(opts) {
  const sendPrompt = opts.sendPrompt;
  if (typeof sendPrompt !== 'function') throw new Error('createReverseGateway 需要 sendPrompt 函数');
  // 注意：port 0 是合法值（由系统分配随机端口），不能用 `|| DEFAULT_PORT` 覆盖
  const port = opts.port != null ? opts.port : DEFAULT_PORT;
  const host = opts.host || DEFAULT_HOST;
  // 强制鉴权：空 key 会导致本机任意网页/进程白嫖已登录会话，直接拒绝创建
  const apiKey = typeof opts.apiKey === 'string' ? opts.apiKey.trim() : '';
  if (!apiKey) {
    throw new Error('createReverseGateway 需要非空 apiKey（显式配置或 ensureApiToken 自动生成）');
  }
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const defaultModel = opts.defaultModel || 'gpt-4o';

  let seq = 0;
  const nextId = () => (++seq).toString(36) + Math.random().toString(36).slice(2, 8);

  // 并发防护：底层只有一个 ChatGPT 页面，必须串行。
  // 用 promise 链排队；先到先得，后到的等前面的完成后再发。
  // 队列深度上限：排队超过 maxPending 的请求直接 429，
  // 防止突发请求把串行队列堵死 N×timeoutMs。
  let queueTail = Promise.resolve();
  let pendingCount = 0;
  const maxPending = opts.maxPending != null ? opts.maxPending : 3;

  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url || '';
      if (req.method === 'GET' && (url === '/health' || url === '/')) {
        sendJSON(res, 200, { status: 'ok', service: 'cuckoo-reverse-gateway', pending: pendingCount });
        return;
      }

      // 鉴权（/health 除外，便于本地探活）
      {
        const auth = req.headers['authorization'] || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (token !== apiKey) {
          sendJSON(res, 401, { error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } });
          return;
        }
      }

      if (req.method === 'GET' && url === '/v1/models') {
        sendJSON(res, 200, {
          object: 'list',
          data: [{ id: defaultModel, object: 'model', owned_by: 'cuckoo' }],
        });
        return;
      }
      if (!(req.method === 'POST' && url.startsWith('/v1/chat/completions'))) {
        sendJSON(res, 404, { error: { message: 'Not found: ' + url, type: 'invalid_request_error' } });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (e) {
        sendJSON(res, 400, { error: { message: 'Invalid JSON body: ' + e.message, type: 'invalid_request_error' } });
        return;
      }

      const messages = payload && payload.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        sendJSON(res, 400, { error: { message: 'messages 不能为空', type: 'invalid_request_error' } });
        return;
      }
      const model = payload.model || defaultModel;
      const wantStream = !!payload.stream;
      const prompt = flattenMessages(messages);
      if (!prompt.trim()) {
        sendJSON(res, 400, { error: { message: 'messages 内容为空', type: 'invalid_request_error' } });
        return;
      }

      // 队列深度上限（含正在执行的 1 个）
      if (pendingCount >= maxPending) {
        sendJSON(res, 429, { error: { message: '队列已满（' + pendingCount + '/' + maxPending + '），请稍后重试', type: 'rate_limit_error' } });
        return;
      }
      pendingCount++;

      const id = nextId();
      let text;
      // 串行队列：把「完整执行（含 sendPrompt 到返回）」链入队列。
      // 注意不能只链排队占位——否则前一个请求的 sendPrompt 尚在执行，
      // 后一个就会并发启动，在同一个 ChatGPT 页面上交错收发。
      let timer = null;
      const exec = queueTail.then(() => Promise.race([
        Promise.resolve().then(() => sendPrompt(messages, { prompt, model })),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('上游 ChatGPT 响应超时')), timeoutMs); }),
      ]));
      queueTail = exec.then(() => undefined, () => undefined);
      try {
        text = await exec;
      } catch (e) {
        sendJSON(res, 502, { error: { message: '上游错误: ' + (e && e.message ? e.message : e), type: 'upstream_error' } });
        return;
      } finally {
        if (timer) clearTimeout(timer);
        pendingCount--; // 无论成败都释放队列名额
      }

      if (wantStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        // 非增量：一次性给出完整内容再结束（OpenAI SSE 合法形态）
        res.write('data: ' + JSON.stringify(makeChunk(model, text, id, false)) + '\n\n');
        res.write('data: ' + JSON.stringify(makeChunk(model, '', id, true)) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      sendJSON(res, 200, makeCompletionResponse(model, text, id));
    } catch (err) {
      try { sendJSON(res, 500, { error: { message: '内部错误: ' + (err && err.message ? err.message : err), type: 'server_error' } }); } catch (_) {}
    }
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          // 不因监听句柄阻止进程退出（测试 runner / 应用退出场景）
          if (typeof server.unref === 'function') server.unref();
          resolve({ host, port });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        // 主动销毁残留 keep-alive 连接，否则 server.close 会一直等待其释放
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => resolve());
      });
    },
    get address() {
      const a = server.address();
      return a ? { host: a.address, port: a.port } : null;
    },
  };
}

module.exports = {
  createReverseGateway,
  ensureApiToken,
  readApiToken,
  flattenMessages,
  makeCompletionResponse,
  makeChunk,
  approxTokens,
  DEFAULT_PORT,
  TOKEN_FILE,
};

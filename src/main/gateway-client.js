/**
 * 网关（OpenAI 兼容）流式客户端（主进程）
 *
 * 负责真正向 {baseUrl}/chat/completions 发起流式请求，用共享的 SSE 提取器
 * （src/shared/sse-extract）累加正文，回调整段文本。
 *
 * 安全：apiK 只在主进程拼进请求头，绝不回传渲染进程。
 *
 * 传输层可注入（opts.request），便于单测不触网：
 *   request(url, {headers, body, method}) -> Promise<{statusCode, stream}>
 *   默认使用 Node 原生 http/https。
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const {
  cuckooSSECreateFrameDecoder,
  cuckooSSEParseBlock,
  cuckooCreateOpenAIExtractor,
} = require('../shared/sse-extract');

const DEFAULT_TIMEOUT_MS = 120000;

/** 默认传输：Node 原生 http/https，返回 {statusCode, stream(IncomingMessage)}。 */
function defaultRequest(url, options) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (err) { return reject(new Error('无效的网关 URL: ' + url)); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: options.method || 'POST',
      headers: options.headers || {},
      timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    }, (res) => {
      resolve({ statusCode: res.statusCode, stream: res });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * 拼装 chat/completions 请求体
 * @param {{model:string, messages:Array, temperature:number}} cfg
 */
function buildRequestBody(cfg) {
  return JSON.stringify({
    model: cfg.model,
    messages: cfg.messages,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
    stream: true,
  });
}

function completionUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  // 已带 /chat/completions 的直接用；否则补 /chat/completions
  if (/\/chat\/completions$/.test(base)) return base;
  return base + '/chat/completions';
}

/**
 * 发起一次流式补全。
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {number} [opts.temperature]
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {function(string):void} [opts.onDelta] 每段增量文本回调（用于页面实时渲染）
 * @param {function(object):void} [opts.transport] 注入的传输层（测试用）
 * @returns {Promise<{ok:boolean, text:string, error?:(string|null)}>}
 */
async function streamCompletion(opts) {
  const request = opts.transport || defaultRequest;
  const url = completionUrl(opts.baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (opts.apiKey) headers['Authorization'] = 'Bearer ' + opts.apiKey;

  let resp;
  try {
    resp = await request(url, {
      method: 'POST',
      headers,
      body: buildRequestBody({ model: opts.model, messages: opts.messages, temperature: opts.temperature }),
    });
  } catch (err) {
    return { ok: false, text: '', error: '网络请求失败: ' + (err && err.message ? err.message : err) };
  }

  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    // 尽量读取错误体
    let errBody = '';
    try {
      errBody = await readAll(resp.stream);
    } catch (_) {}
    return { ok: false, text: '', error: '网关返回 HTTP ' + resp.statusCode + (errBody ? (': ' + errBody.slice(0, 400)) : '') };
  }

  const extractor = cuckooCreateOpenAIExtractor();
  const frameDecoder = cuckooSSECreateFrameDecoder();
  let lastDispatchedLen = 0;

  // 流空闲超时：chunk 之间超过 idleTimeoutMs 无数据则中止，防止上游卡死挂满 socket 超时
  const idleTimeoutMs = opts.idleTimeoutMs != null ? opts.idleTimeoutMs : 90000;
  try {
    await consumeStream(resp.stream, (chunkText) => {
      const frames = frameDecoder.push(chunkText);
      for (const f of frames) {
        const r = cuckooSSEParseBlock(f);
        if (r.done) { extractor.markDone(); continue; }
        if (r.data == null) continue;
        let parsed;
        try { parsed = JSON.parse(r.data); } catch (e) { continue; }
        extractor.consume(parsed);
      }
      if (typeof opts.onDelta === 'function') {
        const cur = extractor.text;
        if (cur.length > lastDispatchedLen) {
          opts.onDelta(cur.slice(lastDispatchedLen));
          lastDispatchedLen = cur.length;
        }
      }
    }, idleTimeoutMs);
  } catch (err) {
    // 流中断：仍返回已累计文本，但标记 error
    if (extractor.text) return { ok: false, text: extractor.text, error: '流中断: ' + (err && err.message ? err.message : err) };
    return { ok: false, text: '', error: '流中断: ' + (err && err.message ? err.message : err) };
  }

  return { ok: true, text: extractor.text, error: null };
}

/** 把 Node 流按文本块喂给回调，直到结束。idleMs：chunk 间最大无数据间隔（0/缺省 = 不限制）。 */
function consumeStream(stream, onText, idleMs) {
  return new Promise((resolve, reject) => {
    if (!stream) return resolve();
    let decoder = new (require('string_decoder').StringDecoder)('utf8');
    let idleTimer = null;
    const armIdle = () => {
      if (!idleMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { stream.destroy(new Error('流空闲超时（' + idleMs + 'ms 无数据）')); } catch (_) {}
        reject(new Error('流空闲超时'));
      }, idleMs);
    };
    armIdle();
    stream.on('data', (buf) => {
      armIdle();
      const s = decoder.write(buf);
      if (s) onText(s);
    });
    stream.on('end', () => {
      if (idleTimer) clearTimeout(idleTimer);
      const tail = decoder.end();
      if (tail) onText(tail);
      resolve();
    });
    stream.on('error', (e) => {
      if (idleTimer) clearTimeout(idleTimer);
      reject(e);
    });
  });
}

/** 读取整个流为字符串（错误体用）。 */
function readAll(stream) {
  return new Promise((resolve) => {
    if (!stream) return resolve('');
    let out = '';
    stream.on('data', (b) => { out += b.toString('utf8'); });
    stream.on('end', () => resolve(out));
    stream.on('error', () => resolve(out));
  });
}

module.exports = {
  streamCompletion,
  buildRequestBody,
  completionUrl,
  defaultRequest,
};

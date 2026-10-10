/**
 * ChatGPT 网络拦截器（注入 AI 网页主世界执行）
 *
 * 构建期经 esbuild 打包为自包含 IIFE（见 scripts/build-hooks.mjs）。
 * 共享 SSE 帧解码见 ./shared/sse.js；本平台需处理 [DONE] 与 patch 操作，故帧解析本地实现。
 *
 * 设计对齐 hooks/deepseek.ts：终态三态（finished / stopped / error）、流静默看门狗、
 * HTTP 错误与限流识别、tokenUsage / msgIds 上报 —— 让上层重试引擎、压缩流程、
 * 面板 token 统计在两个平台走同一套契约。
 *
 * 与 DeepSeek 的实质差异（不可照搬处）：
 *  - ChatGPT 服务端不下发累积 token 计数 ⇒ tokenUsage.accumulatedTokens 恒为 null，
 *    面板回退到本地估算；仅回填 modelType（model_slug）备用。
 *  - ChatGPT 的完成标记是 message.status === 'finished_successfully'（快照形式，
 *    非 path 形式），且实测存在"流已关闭但没等到该标记"的情况 ⇒ 有正文视为完成。
 *  - 用户停止的客户端形态未在线上逐一抓包 ⇒ 采用"两层宽口径"判定（见 isStopRequest
 *    与 aborted），证据不足时按「完成」而非「停止」上报，避免吞掉正常回复。
 */
import { createFrameDecoder, extractData } from './shared/sse.js';

function install(): void {
  var MARKER = '__cuckooChatgptHookInstalled__';
  if (window[MARKER]) return;
  window[MARKER] = true;

  // 会话流式接口：POST /backend-api/(f/)?conversation
  // （f/ 是前端网关前缀，部分账号/灰度路由会带上）
  var CONVERSATION_RE = /\/backend-api\/(?:f\/)?conversation\/?$/;
  // 停止/中断：对具体会话资源的写/删 PATCH|DELETE /backend-api/conversation/<id>
  var STOP_RE = /\/backend-api\/(?:f\/)?conversation\/[^\/]+$/;
  // 显式停止端点兜底（不同前端版本路径不统一）
  var STOP_PATH_RE = /\/(stop|interrupt|cancel)(_generation)?\/?$/i;

  // 用户主动停止标志：拦到停止类请求置位，新会话流开始时复位
  var userStopped = false;

  function parseUrl(url) {
    try { return new URL(url, document.baseURI); } catch (e) { return null; }
  }

  function isOurHost(u) {
    if (!u) return false;
    var host = u.hostname || '';
    return host.indexOf('chatgpt.com') !== -1 || host.indexOf('chat.openai.com') !== -1;
  }

  /**
   * 停止请求判定（第一层：网络层证据）
   * 刻意不检测 body 文本里的 stop/cancel 关键词 —— 用户提问内容本身可能含这些词，
   * 只认"方法 + 路径"这种结构性证据，宁可漏判也不误判。
   */
  function isStopRequest(url, method) {
    var u = parseUrl(url);
    if (!isOurHost(u)) return false;
    var path = u.pathname || '';
    if (path.indexOf('/backend-api/') === -1) return false;
    if (STOP_PATH_RE.test(path)) return true;
    var upper = String(method || 'GET').toUpperCase();
    if (STOP_RE.test(path) && (upper === 'PATCH' || upper === 'DELETE')) return true;
    return false;
  }

  function isCompletion(url, method) {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    var u = parseUrl(url);
    if (!isOurHost(u)) return false;
    return CONVERSATION_RE.test(u.pathname || '');
  }

  // 限流关键词（响应体文案检测）：ChatGPT 除 429 外，也会用
  // usage cap / "Too many requests" 等文案搭配其它状态码表达限速。
  var RL_KEYWORDS = [
    'too many requests', 'rate limit', 'rate_limit', 'too fast', 'slow down',
    "you've hit your limit", 'reached the current usage cap', 'usage cap',
    'usage limit', '请稍后再试', '过于频繁',
  ];
  function isRateLimitText(s) {
    if (!s || typeof s !== 'string') return false;
    var low = s.toLowerCase();
    for (var i = 0; i < RL_KEYWORDS.length; i++) {
      if (low.indexOf(RL_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  // 从当前 URL 提取会话 ID（/watchdog 会话校验用；规则与 provider 定义保持一致）
  function getSessionIdFromUrl() {
    try {
      var href = String(location.href);
      var uuid = href.match(/\/c\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (uuid) return uuid[1];
      var generic = href.match(/\/c\/([a-zA-Z0-9_-]+)/i);
      // 创建会话过程中 URL 有中间态 /c/WEB:xxx，不能当正式会话 ID
      return generic && generic[1] !== 'WEB' ? generic[1] : null;
    } catch (e) { return null; }
  }

  /**
   * 终态判定：'finished' 正常完成 / 'stopped' 用户主动停止 / 'error' 失败
   *
   * 判定优先级（自上而下）：
   *  1) 用户主动停止（停止类请求 / 服务端 status=interrupted / stop_reason=user_cancelled）→ 'stopped'
   *  2) 服务端判定失败（message.status = failed / errored）→ 'error'
   *  3) 流被客户端 abort（AbortError / XHR status=0）→ 'stopped'
   *     ⚠️ 与 DeepSeek 归入 'error' 不同：ChatGPT 点停止时前端是 abort 请求，
   *        这里判 stopped 才不会触发重试；反过来若真是断网，下一轮回合同样会失败并走到重试。
   *  4) 收到 finished_successfully 且正文非空 → 'finished'
   *  5) 收到 finished_successfully 但正文为空 → 'error'（空回复触发重试）
   *  6) 未收到完成标记，但流已正常结束且有正文 → 'finished'
   *     ⚠️ 实测 ChatGPT 有时不下发完成标记，正文却已完整；此情况判 'error' 会
   *        出现"回复成功却报失败"，压缩等流程等到超时。
   *  7) 兜底（无正文、无完成标记）→ 'error'
   */
  function resolveStatus(extractor, aborted) {
    if (userStopped || extractor.serverStopped) return 'stopped';
    if (extractor.failed) return 'error';
    if (aborted) return 'stopped';
    if (extractor.finished) return extractor.textLen === 0 ? 'error' : 'finished';
    if (extractor.textLen > 0) return 'finished';
    return 'error';
  }

  // 流式增量事件（纯新增，供纯净模式实时渲染；节流 ~80ms）
  var lastStreamAt = 0;
  function dispatchStream(think, text, finished) {
    var now = Date.now();
    if (!finished && now - lastStreamAt < 80) return;
    lastStreamAt = now;
    try {
      window.dispatchEvent(new CustomEvent('cuckoo-ai-stream', {
        // ChatGPT 无服务端累积计数 ⇒ accumulatedTokens 恒 null，下游回退估算
        detail: { think: think || '', text: text || '', finished: !!finished, accumulatedTokens: null }
      }));
    } catch (e) { /* ignore */ }
  }

  function dispatch(text, status, tokenUsage, msgIds, extra?, dbg?) {
    try {
      if (status === 'error') {
        var detail: any = { text: text || '', status: 'error', tokenUsage: tokenUsage || null, msgIds: msgIds || null };
        if (dbg) detail.dbg = dbg;
        if (extra) {
          for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) detail[k] = extra[k];
          }
        }
        window.dispatchEvent(new CustomEvent('cuckoo-ai-error', { detail: detail }));
      } else {
        var respDetail: any = {
          text: text || '',
          finished: status === 'finished',
          status: status,
          tokenUsage: tokenUsage || null,
          msgIds: msgIds || null
        };
        if (dbg) respDetail.dbg = dbg;
        window.dispatchEvent(new CustomEvent('cuckoo-ai-response', { detail: respDetail }));
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- 回复文本提取 ----------
  function createExtractor(reqMeta) {
    var text = '';
    // 思考内容通道：ChatGPT 目前不向 /conversation 流下发推理原文，
    // 仅当 part 标记 reasoning / thoughts 时才有值（例如部分推理模型）。
    var thinkText = '';
    var finished = false;
    // 服务端视角的用户停止：status = interrupted 或 metadata.stop_reason = user_cancelled
    var serverStopped = false;
    // 服务端判定失败：status = failed / errored
    var failed = false;
    var tokenUsage = null;
    // 本条回复的消息 id：requestMessageId（用户提问）+ responseMessageId（AI 回复）
    var msgIds = null;
    // 诊断：记录所有出现过的 message.status 值（最多 20 条）
    var statusFrames = [];
    // 是否曾见过 assistant 快照（用于区分"被覆盖的空正文"与"从未收到"）
    var sawAssistant = false;

    function captureMsgIds(src) {
      if (!src || typeof src !== 'object') return;
      if (!msgIds) msgIds = {};
      if (typeof src.id === 'string') msgIds.responseMessageId = src.id;
      if (typeof src.parent_message_id === 'string') msgIds.requestMessageId = src.parent_message_id;
    }

    // 请求体里能确定父消息 id（用户那条），比流里的字段更早也更可靠
    if (reqMeta) {
      if (reqMeta.parentMessageId) {
        msgIds = msgIds || {};
        msgIds.requestMessageId = reqMeta.parentMessageId;
      }
      if (reqMeta.conversationId) {
        msgIds = msgIds || {};
        msgIds.conversationId = reqMeta.conversationId;
      }
    }

    // ChatGPT 不下发 token 计数，只回填模型名备用
    function captureMeta(m) {
      var slug = null;
      if (m && m.metadata && typeof m.metadata.model_slug === 'string') slug = m.metadata.model_slug;
      else if (m && typeof m.model_slug === 'string') slug = m.model_slug;
      // 部分版本把 model_slug 挂在 content 层
      else if (m && m.content && m.content.metadata && typeof m.content.metadata.model_slug === 'string') {
        slug = m.content.metadata.model_slug;
      }
      if (!slug) return;
      tokenUsage = tokenUsage || {};
      tokenUsage.modelType = slug;
    }

    function applyStatus(s) {
      if (typeof s !== 'string') return;
      statusFrames.push(s);
      if (statusFrames.length > 20) statusFrames.shift();
      if (s === 'finished_successfully') { finished = true; return; }
      if (s === 'interrupted' || s === 'user_cancelled') { serverStopped = true; return; }
      if (s === 'failed' || s === 'errored') { failed = true; return; }
    }

    function applyStopReason(r) {
      if (typeof r !== 'string') return;
      var low = r.toLowerCase();
      // 正常结束原因不能误判成用户停止
      if (low === 'stop' || low === 'max_tokens' || low === 'length' || low === 'content_filter') return;
      if (low.indexOf('cancel') !== -1 || low.indexOf('interrupt') !== -1) serverStopped = true;
    }

    function partKind(p) {
      if (!p || typeof p !== 'object') return 'text';
      var ct = String(p.content_type || p.type || '').toLowerCase();
      if (ct === 'reasoning' || ct === 'thoughts' || ct === 'thinking') return 'think';
      return 'text';
    }

    // content.parts → { text, think }；非数组返回 null（表示没内容）
    function extractParts(content) {
      if (!content || !Array.isArray(content.parts)) return null;
      var tOut = '', kOut = '';
      for (var i = 0; i < content.parts.length; i++) {
        var p = content.parts[i];
        if (typeof p === 'string') { tOut += p; continue; }
        if (p && typeof p === 'object' && typeof p.text === 'string') {
          if (partKind(p) === 'think') kOut += p.text; else tOut += p.text;
        }
      }
      return { text: tOut, think: kOut };
    }

    // 消息快照统一处理（现代形态 v.message，老形态顶层 message）
    function handleMessage(m) {
      if (!m || typeof m !== 'object') return;
      var role = m.author && m.author.role;
      // status / stop_reason 只对 assistant 帧可信（system 帧带 finished_successfully 会误导）。
      if (role !== 'assistant') return;
      sawAssistant = true;
      captureMsgIds(m);
      captureMeta(m);
      var snap = extractParts(m.content);
      // ⚠️ 只有**真正的文本消息**（有 content.parts）才采信 status：
      //    登录态流里 model_editable_context / model_set_context 等内部帧 role 也是 assistant、
      //    且带 status='finished_successfully'，若采信会在正文到达前就 finished=true → 空文本 → error。
      if (snap === null) return;
      text = snap.text;
      if (snap.think) thinkText = snap.think;
      applyStatus(m.status);
      if (m.metadata) applyStopReason(m.metadata.stop_reason);
      if (m.end_turn === true) finished = true;
    }

    function applyOp(node) {
      if (!node || typeof node !== 'object') return;

      // 0) 错误信封（老协议 {"error": {...}}）
      if (node.error !== null && node.error !== undefined &&
          node.v === undefined && node.p === undefined) { failed = true; }

      // 1) 批量操作：v 为操作数组。
      // ⚠️ 实测登录态 SSE 的增量帧多为**裸 {v:[...]}**（无 o 字段），
      //    仅首帧带 o:'patch'。若只认 o==='patch'，后续正文帧全被丢弃，
      //    表现为 finished=true 但 text 为空 → 误判 error。故只判数组。
      if (Array.isArray(node.v)) {
        for (var i = 0; i < node.v.length; i++) applyOp(node.v[i]);
        return;
      }

      // 2) 消息快照：v.message（现代形态，仅 assistant 生效）
      if (node.v && typeof node.v === 'object' && node.v.message) {
        handleMessage(node.v.message);
        return;
      }

      // 2b) 顶层 message 快照（老协议形态：
      //     {"message":{...},"conversation_id":"...","error":null}，无 v 包裹）
      if (node.message && typeof node.message === 'object') {
        handleMessage(node.message);
        return;
      }

      // 3) 路径操作
      if (typeof node.p === 'string' && node.p !== '') {
        if (node.p === '/message/status') { applyStatus(node.v); return; }
        if (node.p === '/message/end_turn' && node.v === true) { finished = true; return; }
        if (/\/message\/content\/parts\/\d+$/.test(node.p)) {
          if (typeof node.v === 'string') {
            if (node.o === 'append' || node.o === 'add') text += node.v;
            else text = node.v;
          } else if (node.v && typeof node.v === 'object' && typeof node.v.text === 'string') {
            if (partKind(node.v) === 'think') thinkText += node.v.text;
            else text += node.v.text;
          }
        }
        return;
      }

      // 4) 裸 v 字符串（无有效 p）：追加正文
      if (typeof node.v === 'string') { text += node.v; return; }

      // 5) 类型化结束事件
      if (node.type === 'message_stream_complete' || node.type === 'message_stream_completed') {
        finished = true;
      }
    }

    return {
      consume: function (parsed) { applyOp(parsed); },
      markDone: function () { finished = true; },
      get text() { return text; },
      get think() { return thinkText; },
      get finished() { return finished; },
      get failed() { return failed; },
      get serverStopped() { return serverStopped; },
      get tokenUsage() { return tokenUsage; },
      get msgIds() { return msgIds; },
      get textLen() { return text.length; },
      snapshot: function () {
        return {
          finished: finished,
          failed: failed,
          serverStopped: serverStopped,
          userStopped: userStopped,
          sawAssistant: sawAssistant,
          textLen: text.length,
          thinkLen: thinkText.length,
          textTail: text.slice(-200),
          statusFrames: statusFrames.slice()
        };
      }
    };
  }

  // ---------- 帧解析（本平台需识别 [DONE]） ----------
  // 返回 { data: string|null, done: boolean }
  function parseFrame(block) {
    var data = extractData(block);
    if (data == null) return { data: null, done: false };
    if (data === '[DONE]') return { data: null, done: true };
    return { data: data, done: false };
  }

  // 读看门狗超时配置（毫秒，<=0 禁用）；默认 300000
  function readIdleTimeout() {
    try {
      var v = parseInt(localStorage.getItem('cuckoo-xhr-idle-timeout') || '', 10);
      if (isFinite(v)) return v;
    } catch (e) { /* ignore */ }
    return 300000;
  }

  function observeBody(body, sessionId, reqMeta) {
    if (!body) return;
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var frameDecoder = createFrameDecoder();
    var extractor = createExtractor(reqMeta);
    var dispatched = false;
    // ---- 流活跃度自检：任何数据（含心跳）到达都刷新 lastActiveAt ----
    var lastActiveAt = Date.now();
    var idleTimer = null;
    var idleTimeout = readIdleTimeout();

    function stopIdleTimer() {
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    }

    if (idleTimeout > 0) {
      idleTimer = setInterval(function () {
        if (dispatched) { stopIdleTimer(); return; }
        if (Date.now() - lastActiveAt > idleTimeout) {
          lastActiveAt = Date.now(); // 重置，避免连续触发
          try {
            window.dispatchEvent(new CustomEvent('cuckoo-stream-idle', { detail: { sessionId: sessionId } }));
          } catch (e) { /* ignore */ }
        }
      }, 5000);
    }

    function flushFrame(frame) {
      var r = parseFrame(frame);
      if (r.done) { extractor.markDone(); return; }
      if (r.data == null) return;
      var parsed;
      try { parsed = JSON.parse(r.data); } catch (e) { return; }
      extractor.consume(parsed);
    }

    function feed(chunk) {
      var frames = frameDecoder.push(chunk);
      for (var i = 0; i < frames.length; i++) flushFrame(frames[i]);
      dispatchStream(extractor.think, extractor.text, extractor.finished);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, resolveStatus(extractor, false), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'feed-finished-frame' }, extractor.snapshot()));
      }
    }

    function pump() {
      reader.read().then(function (r) {
        if (r.done) {
          stopIdleTimer();
          var tail = decoder.decode();
          if (tail) feed(tail);
          var rest = frameDecoder.finish();
          for (var i = 0; i < rest.length; i++) flushFrame(rest[i]);
          if (!dispatched) {
            dispatched = true;
            dispatch(extractor.text, resolveStatus(extractor, false), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'stream-end' }, extractor.snapshot()));
          }
          return;
        }
        lastActiveAt = Date.now(); // 收到任意数据（含心跳）即刷新
        feed(decoder.decode(r.value, { stream: true }));
        pump();
      }).catch(function (e) {
        stopIdleTimer();
        if (!dispatched) {
          dispatched = true;
          var aborted = !!(e && e.name === 'AbortError');
          console.log('[Cuckoo Code][hook] fetch stream error name=' + (e && e.name) + (aborted ? '（按用户停止处理）' : ''));
          if (aborted) {
            dispatch(extractor.text, resolveStatus(extractor, true), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'stream-aborted', name: e && e.name }, extractor.snapshot()));
          } else {
            dispatch('', 'error', extractor.tokenUsage, extractor.msgIds, { reason: 'stream', name: e && e.name, sessionId: sessionId }, Object.assign({ path: 'stream-error' }, extractor.snapshot()));
          }
        }
      });
    }
    pump();
  }

  // ---------- 请求体元信息（用于 msgIds） ----------
  // 只认 JSON 字符串，其它（FormData/Blob/URLSearchParams）直接跳过。
  function parseRequestBody(body) {
    if (typeof body !== 'string' || !body) return null;
    try {
      var j = JSON.parse(body);
      if (!j || typeof j !== 'object') return null;
      return {
        parentMessageId: typeof j.parent_message_id === 'string' ? j.parent_message_id : null,
        conversationId: typeof j.conversation_id === 'string' ? j.conversation_id : null
      };
    } catch (e) { return null; }
  }

  // ---------- fetch 拦截 ----------
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input: any, init: any) {
      var url = typeof input === 'string' ? input
        : (input && input.url) ? input.url
        : (input && input.href) ? input.href : '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      if (isStopRequest(url, method)) {
        userStopped = true;
        console.log('[Cuckoo Code][hook] 检测到停止请求(fetch)，标记用户停止');
      }
      var p = origFetch.apply(this, arguments);
      if (!isCompletion(url, method)) return p;
      userStopped = false; // 新的会话流开始：复位用户停止标志
      var fetchSessionId = getSessionIdFromUrl();
      var reqMeta = init ? parseRequestBody(init.body) : null;
      return p.then(function (response) {
        try {
          if (response && response.ok === false) {
            if (response.status === 429) {
              dispatch('', 'error', null, null, { reason: 'rate_limit', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
            } else {
              // 非 429：读响应体，检测 usage cap / Too many requests 等文案
              response.clone().text().then(function (bodyText) {
                var rl = isRateLimitText(bodyText);
                if (rl) console.log('[Cuckoo Code][hook] HTTP ' + response.status + ' 响应体命中限流文案，按限流处理');
                dispatch('', 'error', null, null, { reason: rl ? 'rate_limit' : 'http', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
              }).catch(function () {
                dispatch('', 'error', null, null, { reason: 'http', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
              });
            }
          } else if (response) {
            // ⚠️ 不要写成 `else if (response && response.body)`：某些错误响应 body 为空，
            // 那样整个分支会被跳过，错误就没人上报了。判据应该是 content-type。
            var ct = '';
            try { ct = (response.headers && response.headers.get && response.headers.get('content-type')) || ''; } catch (e2) { /* ignore */ }
            if (ct.indexOf('json') !== -1) {
              // 非流式 JSON 响应：多半是业务错误 { detail } / { error: { message } }
              response.clone().json().then(function (j) {
                var msg = String((j && j.detail) || (j && j.error && j.error.message) || '');
                if (!msg) return;
                var rl = isRateLimitText(msg);
                console.log('[Cuckoo Code][hook] 非流式 JSON 响应 detail=' + msg.slice(0, 120) + (rl ? '（限流）' : ''));
                dispatch('', 'error', null, null, { reason: rl ? 'rate_limit' : 'http', detail: msg.slice(0, 300), sessionId: fetchSessionId }, { path: 'json-error' });
              }).catch(function () { /* 非 JSON，忽略 */ });
            } else {
              // 必须 clone —— 页面自己要消费原 body，我们只能看副本
              observeBody(response.clone().body, fetchSessionId, reqMeta);
            }
          }
        } catch (e) { /* ignore */ }
        return response;
      }, function (err) {
        console.log('[Cuckoo Code][hook] fetch conversation reject name=' + (err && err.name));
        dispatch('', 'error', null, null, { reason: 'network', name: err && err.name, sessionId: fetchSessionId }, { path: 'network-error', name: err && err.name });
        throw err;
      });
    };
  }

  // ---------- XHR 拦截（被动读取 responseText） ----------
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var xhrInfo = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url) {
    try { xhrInfo.set(this, { url: url, method: method }); } catch (e) { /* ignore */ }
    // 停止类请求：不走正文观察，只置标志
    try {
      if (isStopRequest(url, method)) {
        userStopped = true;
        console.log('[Cuckoo Code][hook] 检测到停止请求(XHR)，标记用户停止');
      }
    } catch (e) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var info = xhrInfo.get(this);
    if (info && isCompletion(info.url, info.method)) {
      userStopped = false; // 新的会话流开始：复位用户停止标志
      info.body = body;
      try { observeXhr(this, info); } catch (e) { /* ignore */ }
    }
    return origSend.apply(this, arguments);
  };

  function observeXhr(xhr, info) {
    var lastLen = 0;
    var frameDecoder = createFrameDecoder();
    var reqSessionId = getSessionIdFromUrl();
    var reqMeta = info ? parseRequestBody(info.body) : null;
    var extractor = createExtractor(reqMeta);
    var dispatched = false;

    function flushFrame(frame) {
      var r = parseFrame(frame);
      if (r.done) { extractor.markDone(); return; }
      if (r.data == null) return;
      var parsed;
      try { parsed = JSON.parse(r.data); } catch (e) { return; }
      extractor.consume(parsed);
    }

    function consumeChunk() {
      var raw;
      try { raw = xhr.responseText; } catch (e) { return; }
      if (typeof raw !== 'string' || raw.length <= lastLen) return;
      var chunk = raw.slice(lastLen);
      lastLen = raw.length;
      var frames = frameDecoder.push(chunk);
      for (var i = 0; i < frames.length; i++) flushFrame(frames[i]);
      dispatchStream(extractor.think, extractor.text, extractor.finished);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, resolveStatus(extractor, false), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'xhr-finished-frame' }, extractor.snapshot()));
      }
    }

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 3 || xhr.readyState === 4) consumeChunk();
      if (xhr.readyState === 4 && !dispatched) {
        var rest = frameDecoder.finish();
        for (var i = 0; i < rest.length; i++) flushFrame(rest[i]);
        dispatched = true;
        // XHR status=0：请求未完成就被取消（停止按钮 / 页面跳转），按用户停止处理
        var aborted = xhr.status === 0;
        var st = resolveStatus(extractor, aborted);
        if (st === 'error') {
          var xhrRL = xhr.status === 429;
          if (!xhrRL) {
            try { xhrRL = isRateLimitText(String(xhr.responseText || '').slice(0, 2000)); } catch (e) { /* ignore */ }
          }
          if (xhrRL) console.log('[Cuckoo Code][hook] XHR 命中限流（status=' + xhr.status + '）');
          dispatch(extractor.text, 'error', extractor.tokenUsage, extractor.msgIds, { reason: xhrRL ? 'rate_limit' : 'xhr', httpStatus: xhr.status, sessionId: reqSessionId }, Object.assign({ path: 'xhr-error', httpStatus: xhr.status }, extractor.snapshot()));
        } else {
          dispatch(extractor.text, st, extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'xhr-end', httpStatus: xhr.status }, extractor.snapshot()));
        }
      }
    });
  }
}

install();

export { install };

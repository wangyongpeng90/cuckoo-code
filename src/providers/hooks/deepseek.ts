/**
 * DeepSeek 网络拦截器（注入 AI 网页主世界执行）
 *
 * 构建期经 esbuild 打包为自包含 IIFE（见 scripts/build-hooks.mjs），
 * 运行时仍是单个字符串，故可自由 import 共享模块（打包时内联）。
 * 共享 SSE 解码见 ./shared/sse.js。
 */
import { createFrameDecoder, parseBlock } from './shared/sse.js';

function install(): void {
  var MARKER = '__cuckooDeepseekHookInstalled__';
  if (window[MARKER]) return;
  window[MARKER] = true;

  var COMPLETION_PATH = '/api/v0/chat/completion';
  var STOP_STREAM_PATH = '/api/v0/chat/stop_stream';
  // 用户主动停止标志：拦截到 stop_stream 请求时置位，新的 completion 开始时复位
  var userStopped = false;

  function isStopStream(url, method) {
    if (!url) return false;
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    try {
      var u = new URL(url, document.baseURI);
      return u.pathname === STOP_STREAM_PATH;
    } catch (e) {
      return String(url).indexOf(STOP_STREAM_PATH) !== -1;
    }
  }

  function isCompletion(url, method) {
    if (!url) return false;
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    try {
      var u = new URL(url, document.baseURI);
      return u.pathname === COMPLETION_PATH;
    } catch (e) {
      return String(url).indexOf(COMPLETION_PATH) !== -1;
    }
  }

  // 限流关键词（响应体文案检测）：DeepSeek 除 429 / biz_code 外，
  // 还会用普通 HTTP 错误 + 中文文案表达"频率过快"，需识别以免误走普通重试（短间隔）。
  var RL_KEYWORDS = [
    '过于频繁', '频率过快', '稍后再发', '稍后再试', '请稍后重试',
    'too frequently', 'rate limit', 'too many requests', 'too fast',
  ];
  function isRateLimitText(s) {
    if (!s || typeof s !== 'string') return false;
    var low = s.toLowerCase();
    for (var i = 0; i < RL_KEYWORDS.length; i++) {
      if (low.indexOf(RL_KEYWORDS[i].toLowerCase()) >= 0) return true;
    }
    return false;
  }

  // 从当前 URL 提取会话 ID（用于错误事件的会话校验）
  // 提取请求体里的用户消息文本（用于对话记录落盘）
  function extractUserText(body) {
    if (!body) return '';
    try {
      var raw = body;
      if (typeof raw !== 'string') {
        if (raw && typeof raw.toString === 'function') raw = raw.toString();
        else return '';
      }
      var obj = null;
      try { obj = JSON.parse(raw); } catch (e) { /* 非 JSON，忽略 */ }
      if (obj && typeof obj === 'object') {
        if (typeof obj.prompt === 'string' && obj.prompt.trim()) return obj.prompt;
        if (typeof obj.content === 'string' && obj.content.trim()) return obj.content;
        if (typeof obj.text === 'string' && obj.text.trim()) return obj.text;
        if (Array.isArray(obj.messages)) {
          for (var i = obj.messages.length - 1; i >= 0; i--) {
            var m = obj.messages[i];
            if (m && m.role === 'user') {
              if (typeof m.content === 'string' && m.content.trim()) return m.content;
              if (Array.isArray(m.content)) {
                var acc = '';
                for (var j = 0; j < m.content.length; j++) {
                  var part = m.content[j];
                  if (part && typeof part.text === 'string') acc += part.text;
                  else if (typeof part === 'string') acc += part;
                }
                if (acc.trim()) return acc;
              }
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // 派发"用户消息"事件（供对话记录落盘）
  function dispatchUserMessage(text, sessionId) {
    var t = String(text || '').trim();
    if (!t) return;
    try {
      window.dispatchEvent(new CustomEvent('cuckoo-user-message', {
        detail: { text: t, sessionId: sessionId || getSessionIdFromUrl(), ts: Date.now() }
      }));
    } catch (e) { /* ignore */ }
  }

  function getSessionIdFromUrl() {
    try {
      var m = String(location.href).match(/\/chat\/s\/([a-f0-9-]+)/i);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // 终态判定：'finished' 正常完成 / 'stopped' 用户主动停止 / 'error' 失败或服务端截断
  //
  // 判定优先级（自上而下）：
  //  1) 用户主动停止（拦截到 stop_stream 请求）→ 'stopped'
  //  2) 服务端截断（SSE INCOMPLETE 且非用户停止）→ 'error'（触发重试）
  //  3) 收到 FINISHED 且正文非空 → 'finished'
  //  4) 收到 FINISHED 但正文为空、只有思考 → 'error'（思考被中断、正文未生成，触发重试）
  //  5) 未收到 FINISHED，但流已正常结束（stream-end）且有正文 → 'finished'
  //     ⚠️ 实测 DeepSeek 有时不发 FINISHED 帧，正文却已完整生成。
  //     此前这种情况会被判为 'error'，导致"摘要成功却报失败"（压缩流程等不到完成而超时）。
  //     故：无截断标记、无用户停止、且有正文时，视为正常完成。
  //  6) 以上都不满足（无正文、无 FINISHED）→ 'error'
  function resolveStatus(extractor) {
    // 1) 用户主动停止
    if (userStopped) return 'stopped';
    // 2) 服务端截断（无 stop_stream 的 INCOMPLETE）
    if (extractor.incomplete) return 'error';
    // 3/4) 收到 FINISHED 帧
    if (extractor.finished) {
      // 正文为空（哪怕有思考）→ 视为空回复，触发普通失败重试
      if (extractor.textLen === 0) return 'error';
      return 'finished';
    }
    // 5) 未收到 FINISHED，但有正文（流已正常结束）→ 视为完成
    if (extractor.textLen > 0) return 'finished';
    // 6) 兜底
    return 'error';
  }

  // 流式增量事件（纯新增，供纯净模式实时渲染；节流 ~80ms）
  var lastStreamAt = 0;
  // acc：服务端下发的 accumulated_token_usage（= prompt + 已生成输出），
  // 下游用"当前 acc − 本轮起始 acc"得到精确的本轮输出 token 数。
  function dispatchStream(think, text, finished, acc) {
    var now = Date.now();
    if (!finished && now - lastStreamAt < 80) return;
    lastStreamAt = now;
    try {
      window.dispatchEvent(new CustomEvent('cuckoo-ai-stream', {
        detail: {
          think: think || '',
          text: text || '',
          finished: !!finished,
          accumulatedTokens: typeof acc === 'number' ? acc : null
        }
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
        var respDetail: any = { text: text || '', finished: status === 'finished', status: status, tokenUsage: tokenUsage || null, msgIds: msgIds || null };
        if (dbg) respDetail.dbg = dbg;
        window.dispatchEvent(new CustomEvent('cuckoo-ai-response', { detail: respDetail }));
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- 回复文本提取（区分 THINK / RESPONSE 片段）----------
  function createExtractor() {
    var fragmentTypes = [];
    var currentIndex = -1;
    var observed = false;
    var text = '';
    // 思考内容（THINK 片段）：单独累计，用于识别"只有思考、正文为空"的截断
    var thinkText = '';
    var finished = false;
    // 用户主动停止：服务端下发 response/status = INCOMPLETE
    var incomplete = false;
    // 服务端权威 token 统计（accumulated_token_usage 含 prompt/context + 输出）
    var tokenUsage = null;
    // 本条回复的消息 id：requestMessageId（用户提问）+ responseMessageId（AI 回复）
    var msgIds = null;
    // 诊断：记录收到的所有 status 帧（response/status、quasi_status）
    var statusFrames = [];

    // 从对象里捕获消息 id 字段
    function captureMsgIds(src) {
      if (!src || typeof src !== 'object') return;
      if (!msgIds) msgIds = {};
      if (typeof src.request_message_id === 'number') msgIds.requestMessageId = src.request_message_id;
      if (typeof src.response_message_id === 'number') msgIds.responseMessageId = src.response_message_id;
      // 快照形式：{v:{response:{message_id, parent_id}}}
      if (typeof src.message_id === 'number') msgIds.responseMessageId = src.message_id;
      if (typeof src.parent_id === 'number') msgIds.requestMessageId = src.parent_id;
    }

    // 从对象里捕获 token 相关字段（幂等，只保留最后一次值）
    function captureTokenUsage(src) {
      if (!src || typeof src !== 'object') return;
      var changed = false;
      if (!tokenUsage) tokenUsage = {};
      if (typeof src.accumulated_token_usage === 'number') {
        tokenUsage.accumulatedTokens = src.accumulated_token_usage; changed = true;
      }
      if (typeof src.inserted_at === 'number') {
        tokenUsage.insertedAt = src.inserted_at; changed = true;
      }
      if (typeof src.updated_at === 'number') {
        tokenUsage.updatedAt = src.updated_at; changed = true;
      }
      if (typeof src.model_type === 'string') {
        tokenUsage.modelType = src.model_type; changed = true;
      }
      if (!changed && Object.keys(tokenUsage).length === 0) tokenUsage = null;
    }

    function lastSeg(p) { return typeof p === 'string' ? p.split('/').pop() : ''; }
    function isTextPatch(p) {
      var s = lastSeg(p);
      return s === 'content' || s === 'text' || s === 'markdown' || s === 'delta';
    }
    function isResponsePatch(p) {
      return typeof p === 'string' && (p === 'response' || p.indexOf('response/') === 0);
    }
    function isResponseTextPatch(p) { return isTextPatch(p) && isResponsePatch(p); }
    function isThinkingPatch(p) {
      var s = lastSeg(p);
      return s === 'reasoning_content' || s === 'thinking_content';
    }
    function isFragmentsAppend(p) {
      return p && typeof p.p === 'string' && p.p.slice(-10) === '/fragments' &&
        p.o === 'APPEND' && Array.isArray(p.v);
    }
    function snapshotFragments(p) {
      if (!p || p.p !== undefined || !p.v || typeof p.v !== 'object') return null;
      var r = p.v.response;
      if (!r || typeof r !== 'object') return null;
      var f = r.fragments;
      return Array.isArray(f) && f.length > 0 ? f : null;
    }
    function fragText(f) {
      if (!f || typeof f !== 'object') return '';
      if (typeof f.content === 'string') return f.content;
      if (typeof f.text === 'string') return f.text;
      return '';
    }
    function typeAt(i) {
      if (i === -1) i = currentIndex;
      if (i < 0 || i >= fragmentTypes.length) return null;
      return fragmentTypes[i];
    }
    function isThink(t) { return String(t).toUpperCase() === 'THINK'; }
    function consumeFragmentContent(fragments, types) {
      for (var i = 0; i < fragments.length; i++) {
        var c = fragText(fragments[i]);
        if (!c) continue;
        if (isThink(types[i])) thinkText += c;
        else text += c;
      }
    }

    function consume(parsed) {
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
        for (var i = 0; i < parsed.v.length; i++) consume(parsed.v[i]);
        return;
      }
      // ---- 消息 id 捕获 ----
      // 顶层帧：{"request_message_id":668,"response_message_id":669,...}
      captureMsgIds(parsed);
      // ---- token 字段捕获 ----
      // 1) 消息快照：{"v":{"response":{"accumulated_token_usage":...}}}
      if (parsed.v && typeof parsed.v === 'object' && parsed.v.response && typeof parsed.v.response === 'object') {
        captureTokenUsage(parsed.v.response);
        captureMsgIds(parsed.v.response);
      }
      // 2) 独立帧：{"p":"accumulated_token_usage","v":123}
      if (typeof parsed.p === 'string' && lastSeg(parsed.p) === 'accumulated_token_usage' && typeof parsed.v === 'number') {
        captureTokenUsage({ accumulated_token_usage: parsed.v });
      }
      // 3) 顶层 updated_at：{"updated_at":1789351765.04}
      if (parsed.updated_at !== undefined) {
        captureTokenUsage(parsed);
      }
      if (isFragmentsAppend(parsed)) {
        var types = [];
        for (var j = 0; j < parsed.v.length; j++) {
          types.push(String((parsed.v[j] && parsed.v[j].type) || 'RESPONSE'));
        }
        for (var ti = 0; ti < types.length; ti++) fragmentTypes.push(types[ti]);
        currentIndex = fragmentTypes.length - 1;
        observed = true;
        consumeFragmentContent(parsed.v, types);
        return;
      }
      var snap = snapshotFragments(parsed);
      if (snap) {
        var first = !observed;
        var stypes = [];
        for (var k = 0; k < snap.length; k++) {
          stypes.push(String((snap[k] && snap[k].type) || 'RESPONSE'));
        }
        fragmentTypes = stypes;
        currentIndex = fragmentTypes.length - 1;
        observed = true;
        if (first) consumeFragmentContent(snap, stypes);
        return;
      }
      if (isThinkingPatch(parsed.p) && typeof parsed.v === 'string') return;
      if (typeof parsed.p === 'string' && isResponseTextPatch(parsed.p) && typeof parsed.v === 'string') {
        var m = /^response\/fragments\/(-?\d+)\//.exec(parsed.p);
        var idx = m ? Number(m[1]) : -1;
        if (isThink(typeAt(idx))) thinkText += parsed.v;
        else text += parsed.v;
        return;
      }
      if (parsed.p === undefined && typeof parsed.v === 'string') {
        if (isThink(typeAt(currentIndex))) thinkText += parsed.v;
        else text += parsed.v;
        return;
      }
      if (parsed.p === 'response/status' || parsed.p === 'quasi_status') {
        statusFrames.push(parsed.p + '=' + parsed.v);
        if (statusFrames.length > 20) statusFrames.shift();
        if (parsed.v === 'FINISHED') finished = true;
        else if (parsed.v === 'INCOMPLETE') incomplete = true;
      }
    }

    return {
      consume: consume,
      get text() { return text; },
      get think() { return thinkText; },
      get finished() { return finished; },
      get incomplete() { return incomplete; },
      get tokenUsage() { return tokenUsage; },
      get msgIds() { return msgIds; },
      get thinkLen() { return thinkText.length; },
      get textLen() { return text.length; },
      snapshot: function () {
        return {
          finished: finished,
          incomplete: incomplete,
          userStopped: userStopped,
          thinkLen: thinkText.length,
          textLen: text.length,
          textTail: text.slice(-200),
          thinkTail: thinkText.slice(-200),
          statusFrames: statusFrames.slice()
        };
      }
    };
  }

  // 读看门狗超时配置（毫秒，<=0 禁用）；默认 300000
  function readIdleTimeout() {
    try {
      var v = parseInt(localStorage.getItem('cuckoo-xhr-idle-timeout') || '', 10);
      if (isFinite(v)) return v;
    } catch (e) { /* ignore */ }
    return 300000;
  }

  function observeBody(body) {
    if (!body) return;
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var frameDecoder = createFrameDecoder();
    var extractor = createExtractor();
    var dispatched = false;
    // ---- 流活跃度自检：任何数据（含心跳）到达都刷新 lastActiveAt ----
    var lastActiveAt = Date.now();
    var idleTimer = null;
    var idleSessionId = getSessionIdFromUrl();
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
            window.dispatchEvent(new CustomEvent('cuckoo-stream-idle', { detail: { sessionId: idleSessionId } }));
          } catch (e) { /* ignore */ }
        }
      }, 5000);
    }

    function feed(chunk) {
      var frames = frameDecoder.push(chunk);
      for (var i = 0; i < frames.length; i++) {
        var parsed = parseBlock(frames[i]);
        if (parsed) extractor.consume(parsed);
      }
      dispatchStream(extractor.think, extractor.text, extractor.finished, extractor.tokenUsage ? extractor.tokenUsage.accumulatedTokens : null);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, resolveStatus(extractor), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'feed-finished-frame' }, extractor.snapshot()));
      }
    }

    function pump() {
      reader.read().then(function (r) {
        if (r.done) {
          stopIdleTimer();
          var tail = decoder.decode();
          if (tail) feed(tail);
          var rest = frameDecoder.finish();
          for (var i = 0; i < rest.length; i++) {
            var parsed = parseBlock(rest[i]);
            if (parsed) extractor.consume(parsed);
          }
          if (!dispatched) {
            dispatched = true;
            dispatch(extractor.text, resolveStatus(extractor), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'stream-end' }, extractor.snapshot()));
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
          console.log('[Cuckoo Code][hook] fetch stream error name=' + (e && e.name));
          dispatch(extractor.text, 'error', extractor.tokenUsage, extractor.msgIds, { reason: 'stream', name: e && e.name, sessionId: getSessionIdFromUrl() }, Object.assign({ path: 'stream-error' }, extractor.snapshot()));
        }
      });
    }
    pump();
  }

  // ---------- 缓存真实请求头（供压缩时直接 fetch 使用）----------
  // DeepSeek 的 share/create 需要 authorization + x-client-* 头，
  // 拦截任意请求时缓存最新一组，供后续直接调用 API。
  // 上次写入的内容，用于去重（避免高频 localStorage 写入）
  var lastCachedHeaders = '';
  function cacheHeaders(hdrs) {
    try {
      if (!hdrs) return;
      var lower = {};
      for (var k in hdrs) {
        if (Object.prototype.hasOwnProperty.call(hdrs, k)) {
          lower[String(k).toLowerCase()] = hdrs[k];
        }
      }
      if (!lower['authorization']) return;
      var s = JSON.stringify(lower);
      if (s === lastCachedHeaders) return; // 内容未变，跳过同步写入
      lastCachedHeaders = s;
      localStorage.setItem('cuckoo-ds-headers', s);
    } catch (e) { /* ignore */ }
  }

  // ---------- fetch 拦截 ----------
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input: any, init: any) {
      var url = typeof input === 'string' ? input
        : (input && input.url) ? input.url
        : (input && input.href) ? input.href : '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      // 缓存请求头
      try {
        if (init && init.headers) {
          var h = init.headers;
          var obj = {};
          if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach(function (v, k) { obj[k] = v; }); }
          else if (Array.isArray(h)) { h.forEach(function (p) { obj[p[0]] = p[1]; }); }
          else { obj = h; }
          cacheHeaders(obj);
        }
      } catch (e) { /* ignore */ }
      var p = origFetch.apply(this, arguments);
      if (isStopStream(url, method)) {
        userStopped = true;
        console.log('[Cuckoo Code][hook] 检测到 stop_stream(fetch)，标记用户停止');
        return p;
      }
      if (!isCompletion(url, method)) return p;
      userStopped = false; // 新的 completion 开始：复位用户停止标志
      var fetchSessionId = getSessionIdFromUrl(); // 发起时记录会话
      // 对话记录：派发用户消息（fetch 请求体）
      try { dispatchUserMessage(extractUserText(init && init.body), fetchSessionId); } catch (e) { /* ignore */ }
      return p.then(function (response) {
        try {
          if (response && response.ok === false) {
            // HTTP 429 = 操作频繁，标记 reason 供重试引擎走"操作频繁"策略
            var isRL = response.status === 429;
            if (isRL) {
              dispatch('', 'error', null, null, { reason: 'rate_limit', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
            } else {
              // 非 429：读响应体，检测"频率过快/请稍后再试"等文案（DeepSeek 有时用普通错误码 + 中文文案）
              response.clone().text().then(function (bodyText) {
                var rl = isRateLimitText(bodyText);
                if (rl) console.log('[Cuckoo Code][hook] HTTP ' + response.status + ' 响应体命中限流文案，按操作频繁处理');
                dispatch('', 'error', null, null, { reason: rl ? 'rate_limit' : 'http', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
              }).catch(function () {
                dispatch('', 'error', null, null, { reason: 'http', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
              });
            }
          } else if (response && response.body) {
            // 注：这里必须 clone —— 页面自己要消费原 body，我们只能看一份副本。
            // 这是 fetch API 下"只观察不改写"的必要手段，浏览器对 clone 有优化。
            var ct = '';
            try { ct = (response.headers && response.headers.get && response.headers.get('content-type')) || ''; } catch (e2) { /* ignore */ }
            if (ct.indexOf('json') !== -1) {
              // 非流式 JSON 响应：可能是限流等业务错误。
              // DeepSeek 响应信封：{ code, msg, data: { biz_code, biz_msg, biz_data } }
              //  - 顶层 code=40029 → "请求过于频繁"（HTTP 层全局鉴权拦截）
              //  - data.biz_code=40029 → "操作过于频繁"（completion 非流式错误）
              // 两者都是限流，统一标记 reason='rate_limit'。
              var sid = fetchSessionId;
              response.clone().json().then(function (j) {
                var gcode = j && j.code;
                var biz = j && j.data && j.data.biz_code;
                var code = (biz !== undefined && biz !== null && biz !== 0) ? biz : gcode;
                // 文案检测：DeepSeek 的 msg / biz_msg 可能含"频率过快"等
                var msgText = String((j && j.msg) || '') + ' ' + String((j && j.data && j.data.biz_msg) || '');
                var byMsg = isRateLimitText(msgText);
                if (code !== undefined && code !== null && code !== 0) {
                  var rl = code === 40029 || byMsg;
                  console.log('[Cuckoo Code][hook] 非流式错误 code=' + code + (rl ? '（限流）' : '') + (byMsg ? ' [msg命中限流文案]' : ''));
                  dispatch('', 'error', null, null, { reason: rl ? 'rate_limit' : 'biz', bizCode: code, sessionId: sid }, { path: 'biz-error', bizCode: code });
                } else if (byMsg) {
                  console.log('[Cuckoo Code][hook] 非流式响应 msg 命中限流文案（无错误码）');
                  dispatch('', 'error', null, null, { reason: 'rate_limit', bizCode: code, sessionId: sid }, { path: 'biz-error-msg-ratelimit' });
                }
              }).catch(function () { /* 非 JSON，忽略 */ });
            } else {
              observeBody(response.clone().body);
            }
          }
        } catch (e) { /* ignore */ }
        return response;
      }, function (err) {
        console.log('[Cuckoo Code][hook] fetch completion reject name=' + (err && err.name));
        dispatch('', 'error', null, null, { reason: 'network', name: err && err.name, sessionId: fetchSessionId }, { path: 'network-error', name: err && err.name });
        throw err;
      });
    };
  }

  // ---------- XHR 拦截（被动读取 responseText）----------
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var xhrInfo = new WeakMap();
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      var inf = xhrInfo.get(this) || {};
      if (!inf.headers) inf.headers = {};
      inf.headers[name] = value;
      xhrInfo.set(this, inf);
      // 注：不在此处 cacheHeaders（每设一个头都调 → 高频）。
      // 改到 send 时统一缓存一次。
    } catch (e) { /* ignore */ }
    return origSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.open = function (method, url) {
    try { xhrInfo.set(this, { url: url, method: method }); } catch (e) { /* ignore */ }
    // 拦截 stop_stream：用户主动停止的直接证据
    try {
      if (isStopStream(url, method)) {
        userStopped = true;
        console.log('[Cuckoo Code][hook] 检测到 stop_stream，标记用户停止');
      }
    } catch (e) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var info = xhrInfo.get(this);
    // 统一在此缓存请求头（此时所有 setRequestHeader 已调用完，一次搞定）
    if (info && info.headers) cacheHeaders(info.headers);
    if (info && isCompletion(info.url, info.method)) {
      // 新的 completion 开始：复位用户停止标志
      userStopped = false;
      // 对话记录：派发用户消息（XHR 请求体）
      try { dispatchUserMessage(extractUserText(body), getSessionIdFromUrl()); } catch (e) { /* ignore */ }
      try { observeXhr(this); } catch (e) { console.error('[Cuckoo Code][hook] observeXhr 异常: ' + e.message); }
    }
    return origSend.apply(this, arguments);
  };


  function observeXhr(xhr) {
    var lastLen = 0;
    var frameDecoder = createFrameDecoder();
    var extractor = createExtractor();
    var dispatched = false;
    var reqSessionId = getSessionIdFromUrl(); // 发起时记录会话

    function consumeChunk() {
      var raw;
      try { raw = xhr.responseText; } catch (e) { return; }
      if (typeof raw !== 'string' || raw.length <= lastLen) return;
      var chunk = raw.slice(lastLen);
      lastLen = raw.length;
      var frames = frameDecoder.push(chunk);
      for (var i = 0; i < frames.length; i++) {
        var parsed = parseBlock(frames[i]);
        if (parsed) extractor.consume(parsed);
      }
      dispatchStream(extractor.think, extractor.text, extractor.finished, extractor.tokenUsage ? extractor.tokenUsage.accumulatedTokens : null);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, resolveStatus(extractor), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'xhr-finished-frame' }, extractor.snapshot()));
      }
    }

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 3 || xhr.readyState === 4) consumeChunk();
      if (xhr.readyState === 4 && !dispatched) {
        var rest = frameDecoder.finish();
        for (var i = 0; i < rest.length; i++) {
          var parsed = parseBlock(rest[i]);
          if (parsed) extractor.consume(parsed);
        }
        dispatched = true;
        var st = resolveStatus(extractor);
        if (st === 'error') {
          // 限流检测：HTTP 429 或响应体命中限流文案（DeepSeek 可能用普通状态码 + 中文提示）
          var xhrRL = xhr.status === 429;
          if (!xhrRL) {
            try { xhrRL = isRateLimitText(String(xhr.responseText || '').slice(0, 2000)); } catch (e) { /* ignore */ }
          }
          if (xhrRL) console.log('[Cuckoo Code][hook] XHR 命中限流（status=' + xhr.status + '）');
          dispatch(extractor.text, 'error', extractor.tokenUsage, extractor.msgIds, { reason: xhrRL ? 'rate_limit' : 'xhr', httpStatus: xhr.status, sessionId: reqSessionId }, Object.assign({ path: 'xhr-error', httpStatus: xhr.status }, extractor.snapshot()));
        } else {
          dispatch(extractor.text, st, extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'xhr-end' }, extractor.snapshot()));
        }
      }
    });
  }

  // ---------- IDB 写入拦截：history-message 写入成功时发事件 ----------
  // 仅当 URL 带 cuckoo-compact 标记时启用（压缩流程用），日常零开销。
  // 目的：压缩清 IDB + 刷新后，精确知道 DeepSeek 已把完整历史写回。
  try {
    var hasCompactFlag = false;
    try { hasCompactFlag = String(location.search).indexOf('cuckoo-compact') !== -1; } catch (e) { /* ignore */ }
    if (hasCompactFlag && typeof IDBObjectStore !== 'undefined' && IDBObjectStore.prototype.put) {
      var origPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        var result = origPut.apply(this, arguments);
        try {
          if (this && this.name === 'history-message' && result && typeof result.addEventListener === 'function') {
            // 用 addEventListener 而非覆盖 onsuccess，避免破坏 DeepSeek 自己的 await 处理
            result.addEventListener('success', function () {
              try {
                var k = (key !== undefined && key !== null) ? key : (value && value.key);
                console.log('[Cuckoo Code][hook] history-message 写入完成 key=' + k);
                window.dispatchEvent(new CustomEvent('cuckoo-idb-history-written', { detail: { key: k } }));
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return result;
      };
    }
  } catch (e) { /* ignore */ }
}

install();

export { install };

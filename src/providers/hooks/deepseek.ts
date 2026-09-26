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

  // ---------- 性能探针（诊断长对话卡顿）----------
  // 采集：我方 consume 耗时 / 读取字节 / 页面长任务，流结束时经事件上报。
  var perf = {
    t0: 0, frames: 0, consumeMs: 0, maxConsume: 0, bytes: 0,
    longTasks: 0, longTaskMs: 0, maxLongTask: 0,
    // 长任务明细：[{off: 相对流起点的偏移ms, dur: 时长ms}]，最多记 120 条
    longList: [],
    // chunk 到达时间点（相对流起点 ms），最多记 200 条
    chunkTimes: [],
    reset: function () {
      this.t0 = performance.now();
      this.frames = 0; this.consumeMs = 0; this.maxConsume = 0; this.bytes = 0;
      this.longTasks = 0; this.longTaskMs = 0; this.maxLongTask = 0;
      this.longList = []; this.chunkTimes = [];
    },
    addConsume: function (ms) { this.consumeMs += ms; if (ms > this.maxConsume) this.maxConsume = ms; },
    addChunkTime: function () {
      if (this.chunkTimes.length < 200) this.chunkTimes.push(Math.round(performance.now() - this.t0));
    },
    summary: function () {
      var now = performance.now();
      return {
        durMs: Math.round(now - this.t0),
        frames: this.frames,
        bytes: this.bytes,
        consumeMs: Math.round(this.consumeMs),
        consumePct: (now - this.t0) > 0 ? Math.round(this.consumeMs / (now - this.t0) * 100) : 0,
        maxConsumeMs: Math.round(this.maxConsume * 10) / 10,
        longTasks: this.longTasks,
        longTaskMs: Math.round(this.longTaskMs),
        maxLongTaskMs: Math.round(this.maxLongTask),
        longList: this.longList.slice(0, 120),
        chunkTimes: this.chunkTimes.slice(0, 200)
      };
    }
  };
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      var _po = new PerformanceObserver(function (list) {
        var es = list.getEntries();
        for (var i = 0; i < es.length; i++) {
          perf.longTasks++;
          perf.longTaskMs += es[i].duration;
          if (es[i].duration > perf.maxLongTask) perf.maxLongTask = es[i].duration;
          if (perf.longList.length < 120) {
            perf.longList.push({
              off: Math.round(es[i].startTime - perf.t0),
              dur: Math.round(es[i].duration)
            });
          }
        }
      });
      _po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { /* 不支持 longtask 则忽略 */ }
  // ---------- DOM 结构探测（找"消息列表容器"选择器，供 content-visibility 优化）----------
  // 策略：找"子元素数 >= 5 且子元素 className 高度相似"的容器（消息列表的典型特征）。
  function dumpDom() {
    var out = [];
    try {
      var all = document.querySelectorAll('div, ul, ol, section');
      for (var i = 0; i < all.length && out.length < 40; i++) {
        var el = all[i];
        var kids = el.children;
        if (!kids || kids.length < 5) continue;
        var cls0 = kids[0] && kids[0].getAttribute ? (kids[0].getAttribute('class') || '') : '';
        if (!cls0) continue;
        var same = 0;
        for (var j = 0; j < kids.length; j++) {
          var cj = kids[j].getAttribute ? (kids[j].getAttribute('class') || '') : '';
          if (cj === cls0) same++;
        }
        if (same >= kids.length * 0.8) {
          var own = el.getAttribute ? (el.getAttribute('class') || '') : '';
          out.push({
            tag: el.tagName,
            cls: String(own).slice(0, 100),
            count: kids.length,
            childTag: kids[0].tagName,
            childCls: String(cls0).slice(0, 100)
          });
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  }
  function perfReport(path, extra) {
    try {
      window.dispatchEvent(new CustomEvent('cuckoo-perf', { detail: Object.assign({ path: path, sessionId: getSessionIdFromUrl() }, perf.summary(), extra || {}, { dom: dumpDom() }) }));
    } catch (e) { /* ignore */ }
  }

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

  // 从当前 URL 提取会话 ID（用于错误事件的会话校验）
  function getSessionIdFromUrl() {
    try {
      var m = String(location.href).match(/\/chat\/s\/([a-f0-9-]+)/i);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // 终态判定：'finished' 正常完成 / 'stopped' 用户主动停止 / 'error' 失败或服务端截断
  // 触发重试（归 error）的两种情况：
  //  1) 仅 SSE INCOMPLETE 而无 stop_stream：服务端自己截断；
  //  2) 已收到 FINISHED，但正文为空、只有思考内容：思考被中断、正文未生成
  //     （网页显示"已停止"但正文一个字都没有，此前会被当作正常完成而丢弃）。
  // 用户主动停止的可靠证据：拦截到 stop_stream 请求（点停止按钮才会发）。
  function resolveStatus(extractor) {
    var st = 'error';
    if (extractor.finished) {
      // 完成帧已到，但正文为空、只有思考内容：属"思考被中断、正文未生成"，
      // 归为 error 以触发自动重试（否则会被当作正常完成而静默丢弃）。
      if (extractor.thinkLen > 0 && extractor.textLen === 0) st = 'error';
      else st = 'finished';
    } else if (userStopped) st = 'stopped';
    return st;
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
    perf.reset();

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
      var _t = performance.now();
      perf.addChunkTime();
      perf.bytes += (chunk ? chunk.length : 0);
      var frames = frameDecoder.push(chunk);
      perf.frames += frames.length;
      for (var i = 0; i < frames.length; i++) {
        var parsed = parseBlock(frames[i]);
        if (parsed) extractor.consume(parsed);
      }
      perf.addConsume(performance.now() - _t);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, resolveStatus(extractor), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'feed-finished-frame' }, extractor.snapshot()));
        perfReport('fetch-stream-end', { textLen: extractor.text.length, thinkLen: extractor.thinkLen });
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
      return p.then(function (response) {
        try {
          if (response && response.ok === false) {
            // HTTP 429 = 操作频繁，标记 reason 供重试引擎走"操作频繁"策略
            var isRL = response.status === 429;
            dispatch('', 'error', null, null, { reason: isRL ? 'rate_limit' : 'http', httpStatus: response.status, sessionId: fetchSessionId }, { path: 'http-error', httpStatus: response.status });
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
                if (code !== undefined && code !== null && code !== 0) {
                  var rl = code === 40029;
                  console.log('[Cuckoo Code][hook] 非流式错误 code=' + code + (rl ? '（操作/请求过于频繁）' : ''));
                  dispatch('', 'error', null, null, { reason: rl ? 'rate_limit' : 'biz', bizCode: code, sessionId: sid }, { path: 'biz-error', bizCode: code });
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
    var xhrReads = 0;      // responseText 全量读取次数
    var xhrRawBytes = 0;   // responseText 累计长度（诊断 O(n²)）
    perf.reset();

    function consumeChunk() {
      var _t = performance.now();
      var raw;
      try { raw = xhr.responseText; } catch (e) { return; }
      if (typeof raw !== 'string' || raw.length <= lastLen) return;
      xhrReads++;
      xhrRawBytes += raw.length;
      perf.addChunkTime();
      var chunk = raw.slice(lastLen);
      lastLen = raw.length;
      var frames = frameDecoder.push(chunk);
      perf.frames += frames.length;
      for (var i = 0; i < frames.length; i++) {
        var parsed = parseBlock(frames[i]);
        if (parsed) extractor.consume(parsed);
      }
      perf.addConsume(performance.now() - _t);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, resolveStatus(extractor), extractor.tokenUsage, extractor.msgIds, null, Object.assign({ path: 'xhr-finished-frame' }, extractor.snapshot()));
        perfReport('xhr-stream-end', { textLen: extractor.text.length, xhrReads: xhrReads, xhrRawBytes: xhrRawBytes });
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
          dispatch(extractor.text, 'error', extractor.tokenUsage, extractor.msgIds, { reason: 'xhr', httpStatus: xhr.status, sessionId: reqSessionId }, Object.assign({ path: 'xhr-error', httpStatus: xhr.status }, extractor.snapshot()));
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

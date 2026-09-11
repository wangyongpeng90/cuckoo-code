/**
 * ChatGPT 请求拦截器（注入到页面主世界执行）
 * 被动观察 chatgpt.com / chat.openai.com 的 conversation SSE 响应，
 * 提取 AI 回复文本，通过 'cuckoo-ai-response' CustomEvent 交给隔离世界。
 * 仅旁路读取，不修改请求与响应。
 *
 * 兼容两种流格式：
 *   1) 快照格式：每个事件含 message.content.parts（累积全文）→ 直接替换
 *   2) patch 格式：{"p":"/message/content/parts/0","o":"append","v":"..."} → 追加
 */
function chatgptHookInstaller() {
  var MARKER = '__cuckooChatgptHookInstalled__';
  if (window[MARKER]) return;
  window[MARKER] = true;

  function isCompletion(url, method) {
    if (!url) return false;
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    try {
      var u = new URL(url, document.baseURI);
      var host = u.hostname;
      if (host.indexOf('chatgpt.com') === -1 && host.indexOf('chat.openai.com') === -1) return false;
      return /\/backend-api\/(?:f\/)?conversation\/?$/.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  function dispatch(text, finished) {
    try {
      window.dispatchEvent(new CustomEvent('cuckoo-ai-response', {
        detail: { text: text || '', finished: !!finished }
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------- SSE 帧解码 ----------
  function createFrameDecoder() {
    var buffer = '', scanFrom = 0;
    return {
      push: function (text) {
        buffer += text;
        var frames = [], re = /\r?\n\r?\n/g, offset = 0, m;
        re.lastIndex = scanFrom;
        while ((m = re.exec(buffer)) !== null) {
          frames.push(buffer.slice(offset, m.index));
          offset = m.index + m[0].length;
        }
        buffer = buffer.slice(offset);
        scanFrom = Math.max(0, buffer.length - 3);
        return frames;
      },
      finish: function () {
        var frames = [];
        if (buffer) frames.push(buffer);
        buffer = ''; scanFrom = 0;
        return frames;
      }
    };
  }

  // 返回 { data: string|null, done: boolean }
  function parseBlock(block) {
    if (!block || !block.trim()) return { data: null, done: false };
    var data = null;
    var lines = block.split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('data:') === 0) {
        var d = line.slice(5).trim();
        data = data == null ? d : data + '\n' + d;
      }
    }
    if (data == null) return { data: null, done: false };
    if (data === '[DONE]') return { data: null, done: true };
    return { data: data, done: false };
  }

  // ---------- 回复文本提取 ----------
  function createExtractor() {
    var text = '';
    var finished = false;
    var sawSnapshot = false;

    function extractParts(content) {
      if (!content || !Array.isArray(content.parts)) return null;
      var out = '';
      for (var i = 0; i < content.parts.length; i++) {
        var p = content.parts[i];
        if (typeof p === 'string') out += p;
        else if (p && typeof p === 'object' && typeof p.text === 'string') out += p.text;
      }
      return out;
    }

    // 递归寻找快照文本（message.content.parts / content.parts）
    function findSnapshot(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.message && node.message.content) {
        var r = extractParts(node.message.content);
        if (r !== null) return r;
      }
      if (node.content && Array.isArray(node.content.parts)) {
        var r2 = extractParts(node.content);
        if (r2 !== null) return r2;
      }
      if (node.o === 'BATCH' && Array.isArray(node.v)) {
        for (var i = 0; i < node.v.length; i++) {
          var rr = findSnapshot(node.v[i]);
          if (rr !== null) return rr;
        }
      }
      return null;
    }

    function isFinish(node) {
      if (!node || typeof node !== 'object') return false;
      if (node.type === 'message_stream_complete' || node.type === 'message_stream_completed') return true;
      if (node.status === 'finished_successfully') return true;
      if (node.message && node.message.status === 'finished_successfully') return true;
      if (node.o === 'BATCH' && Array.isArray(node.v)) {
        for (var i = 0; i < node.v.length; i++) { if (isFinish(node.v[i])) return true; }
      }
      return false;
    }

    function isNoisePath(p) {
      if (typeof p !== 'string') return false;
      return /metadata|recipient|channel|author|content_type|thinking|reasoning/i.test(p);
    }

    function applyPatch(node) {
      if (!node || typeof node !== 'object') return;
      if (node.o === 'BATCH' && Array.isArray(node.v)) {
        for (var i = 0; i < node.v.length; i++) applyPatch(node.v[i]);
        return;
      }
      var p = node.p, o = node.o, v = node.v;
      if (typeof p !== 'string') return;
      if (isNoisePath(p)) return;
      if (!/content\/parts\/\d+$/.test(p)) return;
      if (typeof v !== 'string') return;
      if (o === 'append' || o === 'add') text += v;
      else text = v;
    }

    function consume(parsed) {
      if (!parsed || typeof parsed !== 'object') return;
      if (isFinish(parsed)) finished = true;
      var snap = findSnapshot(parsed);
      if (snap !== null) {
        sawSnapshot = true;
        text = snap; // 快照累积，直接替换
        return;
      }
      if (!sawSnapshot) applyPatch(parsed);
    }

    return {
      consume: consume,
      markDone: function () { finished = true; },
      get text() { return text; },
      get finished() { return finished; }
    };
  }

  // 调试：打印前若干条原始 chunk/事件，便于定位格式
  var debugCount = 0;
  var rawDebugCount = 0;
  function debugRaw(parsed) {
    if (debugCount >= 3) return;
    debugCount++;
    try { console.log('[Cuckoo Code][GPT-Hook] raw#' + debugCount + ':', JSON.stringify(parsed).slice(0, 800)); } catch (e) {}
  }
  function debugRawRaw(msg) {
    if (rawDebugCount >= 6) return;
    rawDebugCount++;
    try { console.log('[Cuckoo Code][GPT-Hook] chunk#' + rawDebugCount + ':', String(msg).slice(0, 1200)); } catch (e) {}
  }

  function observeBody(body) {
    if (!body) return;
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var frameDecoder = createFrameDecoder();
    var extractor = createExtractor();
    var dispatched = false;

    function flushFrame(frame) {
      var r = parseBlock(frame);
      if (r.done) { extractor.markDone(); return; }
      if (r.data == null) return;
      var parsed;
      try { parsed = JSON.parse(r.data); } catch (e) {
        debugRawRaw('[解析失败] ' + r.data);
        return;
      }
      debugRaw(parsed);
      extractor.consume(parsed);
    }

    function feed(chunk) {
      debugRawRaw('[chunk] ' + chunk.slice(0, 1000));
      var frames = frameDecoder.push(chunk);
      for (var i = 0; i < frames.length; i++) flushFrame(frames[i]);
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, true);
      }
    }

    function pump() {
      reader.read().then(function (r) {
        if (r.done) {
          var tail = decoder.decode();
          if (tail) feed(tail);
          var rest = frameDecoder.finish();
          for (var i = 0; i < rest.length; i++) flushFrame(rest[i]);
          if (!dispatched) { dispatched = true; dispatch(extractor.text, true); }
          return;
        }
        feed(decoder.decode(r.value, { stream: true }));
        pump();
      }).catch(function () {
        if (!dispatched) { dispatched = true; dispatch(extractor.text, true); }
      });
    }
    pump();
  }

  // ---------- fetch 拦截 ----------
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input
        : (input && input.url) ? input.url
        : (input && input.href) ? input.href : '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var p = origFetch.apply(this, arguments);
      if (!isCompletion(url, method)) return p;
      console.log('[Cuckoo Code][GPT-Hook] 命中 completion 请求:', url);
      return p.then(function (response) {
        try {
          if (response && response.body) observeBody(response.clone().body);
        } catch (e) { /* ignore */ }
        return response;
      });
    };
  }

  // ---------- XHR 拦截 ----------
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var xhrInfo = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url) {
    try { xhrInfo.set(this, { url: url, method: method }); } catch (e) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var info = xhrInfo.get(this);
    if (info && isCompletion(info.url, info.method)) {
      console.log('[Cuckoo Code][GPT-Hook] 命中 completion 请求(XHR):', info.url);
      try { observeXhr(this); } catch (e) { /* ignore */ }
    }
    return origSend.apply(this, arguments);
  };

  function observeXhr(xhr) {
    var lastLen = 0;
    var frameDecoder = createFrameDecoder();
    var extractor = createExtractor();
    var dispatched = false;

    function flushFrame(frame) {
      var r = parseBlock(frame);
      if (r.done) { extractor.markDone(); return; }
      if (r.data == null) return;
      var parsed;
      try { parsed = JSON.parse(r.data); } catch (e) { return; }
      debugRaw(parsed);
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
      if (extractor.finished && !dispatched) {
        dispatched = true;
        dispatch(extractor.text, true);
      }
    }

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 3 || xhr.readyState === 4) consumeChunk();
      if (xhr.readyState === 4 && !dispatched) {
        var rest = frameDecoder.finish();
        for (var i = 0; i < rest.length; i++) flushFrame(rest[i]);
        dispatched = true;
        dispatch(extractor.text, true);
      }
    });
  }
}

function chatgptHookSource() {
  return '(' + chatgptHookInstaller.toString() + ')();';
}

module.exports = { chatgptHookSource };

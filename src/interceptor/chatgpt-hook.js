/**
 * ChatGPT 请求拦截器（注入到页面主世界执行）
 * 被动观察 chatgpt.com / chat.openai.com 的 conversation SSE 响应，
 * 提取 AI 回复文本，通过 'cuckoo-ai-response' CustomEvent 交给隔离世界。
 * 仅旁路读取，不修改请求与响应。
 */
function chatgptHookInstaller() {
  var MARKER = '__cuckooChatgptHookInstalled__';
  if (window[MARKER]) return;
  window[MARKER] = true;

  // ChatGPT 流式端点：
  //   /backend-api/conversation
  //   /backend-api/f/conversation（新版）
  function isCompletion(url, method) {
    if (!url) return false;
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    try {
      var u = new URL(url, document.baseURI);
      var host = u.hostname;
      if (host.indexOf('chatgpt.com') === -1 && host.indexOf('chat.openai.com') === -1) return false;
      return /\/backend-api\/(f\/)?conversation$/.test(u.pathname);
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

  // 返回 { data: string | null, done: boolean }
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

  // ---------- 回复文本提取（ChatGPT patch 流）----------
  // 关注：
  //   {"p":"/message/content/parts/0","o":"append","v":"..."}  → 追加正文
  //   {"o":"BATCH","v":[...]}                                  → 递归
  //   {"type":"message_stream_complete"}                       → finished
  //   data: [DONE]                                             → finished
  // 过滤：路径含 metadata / recipient / channel / author / thinking / reasoning
  function createExtractor() {
    var text = '';
    var finished = false;

    function isNoisePath(p) {
      if (typeof p !== 'string') return false;
      return /\/metadata\/|\/recipient|\/channel|\/author|\/content_type|thinking|reasoning/i.test(p);
    }

    function isAssistantTextPath(p) {
      return typeof p === 'string' && /^\/message\/content\/parts\/\d+$/.test(p);
    }

    function applyNode(node) {
      if (!node || typeof node !== 'object') return;

      if (node.o === 'BATCH' && Array.isArray(node.v)) {
        for (var i = 0; i < node.v.length; i++) applyNode(node.v[i]);
        return;
      }

      // 显式结束
      if (node.type === 'message_stream_complete' || node.type === 'message_stream_completed') {
        finished = true;
        return;
      }

      var p = node.p;
      var o = node.o;
      var v = node.v;

      if (typeof p === 'string') {
        if (isNoisePath(p)) return;
        if (isAssistantTextPath(p) && typeof v === 'string') {
          if (o === 'append' || o === 'add') {
            text += v;
          } else if (o === 'replace') {
            text = v;
          } else if (o === undefined || o === null) {
            // 无操作符的覆盖
            text = v;
          }
          return;
        }
        return; // 其他路径忽略
      }
    }

    function consume(parsed) {
      if (!parsed || typeof parsed !== 'object') return;
      applyNode(parsed);
    }

    return {
      consume: consume,
      markDone: function () { finished = true; },
      get text() { return text; },
      get finished() { return finished; }
    };
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
      try { parsed = JSON.parse(r.data); } catch (e) { return; }
      extractor.consume(parsed);
    }

    function feed(chunk) {
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

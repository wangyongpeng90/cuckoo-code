/**
 * ChatGPT 请求拦截器（注入到页面主世界执行）
 * 被动观察 chatgpt.com / chat.openai.com 的 conversation SSE 响应，
 * 提取 AI 回复文本，通过 'cuckoo-ai-response' CustomEvent 交给隔离世界。
 * 仅旁路读取，不修改请求与响应。
 *
 * 帧解码与回复提取逻辑位于 src/shared/sse-extract.js（纯函数、可单测），
 * 此处通过 .toString() 把它们与安装器一起拼装成注入源码，
 * 保证 Node 侧测试覆盖的就是页面里实际运行的代码。
 *
 * 实测流格式（/backend-api/f/conversation）：
 *   data: {"v":"文本"}                                      → 裸 v，追加正文
 *   data: {"p":"","o":"add","v":{"message":{...}}}          → 消息快照
 *   data: {"p":"","o":"patch","v":[ {p,o,v}, ... ]}         → 批量操作
 *   data: {"p":"/message/content/parts/0","o":"append","v":"..."} → 正文追加
 *   data: {"p":"/message/status","o":"replace","v":"finished_successfully"} → 结束
 */
const {
  cuckooSSECreateFrameDecoder,
  cuckooSSEParseBlock,
  cuckooCreateChatgptExtractor,
} = require('../shared/sse-extract');

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

  function observeBody(body) {
    if (!body) return;
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var frameDecoder = cuckooSSECreateFrameDecoder();
    var extractor = cuckooCreateChatgptExtractor();
    var dispatched = false;

    function flushFrame(frame) {
      var r = cuckooSSEParseBlock(frame);
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
    var frameDecoder = cuckooSSECreateFrameDecoder();
    var extractor = cuckooCreateChatgptExtractor();
    var dispatched = false;

    function flushFrame(frame) {
      var r = cuckooSSEParseBlock(frame);
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
  // 顺序：共享解析函数先声明，安装器随即可见（页面世界顶层作用域）
  return [
    'var cuckooSSECreateFrameDecoder = ' + cuckooSSECreateFrameDecoder.toString() + ';',
    'var cuckooSSEParseBlock = ' + cuckooSSEParseBlock.toString() + ';',
    'var cuckooCreateChatgptExtractor = ' + cuckooCreateChatgptExtractor.toString() + ';',
    '(' + chatgptHookInstaller.toString() + ')();'
  ].join('\n');
}

module.exports = { chatgptHookSource };

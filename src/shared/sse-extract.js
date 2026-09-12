/**
 * 流式响应解析核心（纯函数，可在 Node 单测，也可经 .toString() 注入页面主世界）
 *
 * 设计约束：
 * - 每个导出函数必须自包含（仅依赖更早定义的顶层函数与标量，不引用模块作用域），
 *   以便 hook 通过 `fn.toString()` 直接拼装成注入页面的源码，保持单一实现。
 * - 不使用 ES6 class / 箭头函数依赖外部闭包；getter 可用（对象字面量内）。
 */

/**
 * SSE 帧解码器：把任意切分的文本流切成一个一个 SSE 帧（以空行分隔）。
 * @returns {{push:(s:string)=>string[], finish:()=>string[]}}
 */
function cuckooSSECreateFrameDecoder() {
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

/**
 * 解析单个 SSE 帧：聚合所有 data: 行；识别 [DONE]。
 * @returns {{data:(string|null), done:boolean}}
 */
function cuckooSSEParseBlock(block) {
  if (!block || !block.trim()) return { data: null, done: false };
  var data = null;
  var lines = block.split(/\r\n|\r|\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // 兼容 event: / id: / retry: 等字段，仅取 data:
    if (line.indexOf('data:') === 0) {
      var d = line.slice(5);
      if (d.charAt(0) === ' ') d = d.slice(1);
      data = data == null ? d : data + '\n' + d;
    }
  }
  if (data == null) return { data: null, done: false };
  data = data.trim();
  if (data === '[DONE]') return { data: null, done: true };
  return { data: data, done: false };
}

/**
 * OpenAI 兼容流式提取器（/v1/chat/completions stream:true）。
 * 累加 choices[0].delta.content；遇到 finish_reason 或 [DONE] 视为完成。
 * 兼容 delta 与 message（部分网关非流式末包），并保留工具调用增量（若有）。
 * @returns {{consume:(o:object)=>void, markDone:()=>void, readonly text:string, readonly finished:boolean, readonly toolName:(string|null)}}
 */
function cuckooCreateOpenAIExtractor() {
  var text = '';
  var finished = false;
  var toolName = null;

  function consume(parsed) {
    if (!parsed || typeof parsed !== 'object') return;
    // 网关返回错误体
    if (parsed.error) { finished = true; return; }

    var choices = parsed.choices;
    if (!Array.isArray(choices) || choices.length === 0) return;
    var c = choices[0];
    if (!c || typeof c !== 'object') return;

    var d = c.delta || c.message || {};
    // 主流：正文增量
    if (typeof d.content === 'string') text += d.content;
    // 部分推理网关把正文放在 reasoning_content，仅当无 content 时兜底采纳
    else if (typeof d.reasoning_content === 'string' && text === '') {
      // 不采纳推理链，避免把思考过程当正文；留空
    }

    // 工具调用增量（本 app 走 cuckoo 代码块协议，这里仅记录名字，不改写正文）
    if (Array.isArray(d.tool_calls)) {
      for (var i = 0; i < d.tool_calls.length; i++) {
        var fn = d.tool_calls[i] && d.tool_calls[i].function;
        if (fn && typeof fn.name === 'string' && fn.name) toolName = fn.name;
      }
    }

    if (c.finish_reason) finished = true;
  }

  function markDone() { finished = true; }

  return {
    consume: consume,
    markDone: markDone,
    get text() { return text; },
    get finished() { return finished; },
    get toolName() { return toolName; }
  };
}

/**
 * ChatGPT 网页版 /backend-api/f/conversation 流提取器。
 * 覆盖四类实测帧格式：
 *   {"v":"..."}                              裸 v 追加正文
 *   {"o":"add","v":{"message":{...}}}        assistant 快照（整体替换）
 *   {"o":"patch","v":[{...},...]}            批量操作
 *   {"p":"/message/content/parts/N","o":"append","v":"..."}  正文追加
 *   {"p":"/message/status","v":"finished_successfully"}      完成
 */
function cuckooCreateChatgptExtractor() {
  var text = '';
  var finished = false;

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

  function applyOp(node) {
    if (!node || typeof node !== 'object') return;

    // 1) 批量操作
    if (Array.isArray(node.v) && (node.o === 'patch' || node.o === 'BATCH')) {
      for (var i = 0; i < node.v.length; i++) applyOp(node.v[i]);
      return;
    }

    // 2) 消息快照
    if (node.v && typeof node.v === 'object' && node.v.message) {
      var m = node.v.message;
      var role = m.author && m.author.role;
      if (role === 'assistant') {
        var snap = extractParts(m.content);
        if (snap !== null) text = snap;
      }
      return;
    }

    // 3) 路径操作
    if (typeof node.p === 'string' && node.p !== '') {
      if (node.p === '/message/status' && node.v === 'finished_successfully') { finished = true; return; }
      if (node.p === '/message/end_turn' && node.v === true) { finished = true; return; }
      if (/\/message\/content\/parts\/\d+$/.test(node.p)) {
        if (typeof node.v === 'string') {
          if (node.o === 'append' || node.o === 'add') text += node.v;
          else text = node.v;
        }
      }
      return;
    }

    // 4) 裸 v 字符串
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
    get finished() { return finished; }
  };
}

module.exports = {
  cuckooSSECreateFrameDecoder: cuckooSSECreateFrameDecoder,
  cuckooSSEParseBlock: cuckooSSEParseBlock,
  cuckooCreateOpenAIExtractor: cuckooCreateOpenAIExtractor,
  cuckooCreateChatgptExtractor: cuckooCreateChatgptExtractor,
};

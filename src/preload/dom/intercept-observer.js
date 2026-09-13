/**
 * DeepSeek 拦截模式下的回复处理器（隔离世界）
 * 监听主世界注入的 'cuckoo-ai-response' 事件，收到完整回复后走与 DOM 模式
 * 相同的工具调用/JS 代码块处理流程。
 */
const { extractJsToolBlocks, BT } = require('./js-detector');
const { tryParseToolCall } = require('./tool-parser');
const { handleToolCall, handleJsToolScript } = require('./observer');
const { sendToolResultToChat, sendCombinedJsResultsToChat, sendMessageToChat } = require('./chat-input');
const { hasTool, toolNamesList } = require('../tool-names');
const { detectWrongToolFormat } = require('./format-hint');

const MAX_JS_RETRY = 3;
// 连续 XML 提示次数（防止无限循环）
let xmlHintCount = 0;
const XML_HINT_MAX = 10;
// 上次已处理的文本（去重，防同一条回复重复处理）
let lastProcessedText = '';

function looksLikeIncompleteCodeError(error) {
  if (!error || typeof error !== 'string') return false;
  return /SyntaxError|Missing initializer|Unexpected end of input|Unexpected token|Unexpected identifier|Unexpected reserved word|Invalid or unexpected token/i.test(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 执行 JS 代码块，遇到"代码不完整"错误时自动重试。
 * 拦截模式下文本已完整（finished），无需重新提取，简单重试执行即可。
 */
async function executeJsBlocksWithRetry(blocks) {
  let results = [];
  for (let attempt = 0; attempt <= MAX_JS_RETRY; attempt++) {
    results = [];
    for (const code of blocks) {
      const r = await handleJsToolScript(code);
      if (r) results.push(r);
    }
    const hasIncompleteFailure = results.some(
      (item) => item && item.result && !item.result.success && looksLikeIncompleteCodeError(item.result.error)
    );
    if (!hasIncompleteFailure) break;
    if (attempt < MAX_JS_RETRY) await sleep(1000);
  }
  return results;
}

/**
 * 处理一条已完成的 AI 回复文本
 * @param {string} text 完整回复文本（Markdown 原文）
 */
async function processInterceptedResponse(text) {
  const raw = (text || '').trim();
  if (!raw) return;
  if (raw === lastProcessedText) return;
  lastProcessedText = raw;

  console.log('[Cuckoo Code][拦截] 收到完整回复，长度=' + raw.length);

  // 1. 优先检测 JS 工具代码块（cuckoo / js 代码块）
  const jsBlocks = extractJsToolBlocks(raw);
  if (jsBlocks.length > 0) {
    console.log('[Cuckoo Code][拦截] 检测到 JS 工具代码块（' + jsBlocks.length + ' 个），开始执行');
    xmlHintCount = 0;
    const results = await executeJsBlocksWithRetry(jsBlocks);
    if (results.length > 0) sendCombinedJsResultsToChat(results);
    return;
  }

  // 2. JSON 工具调用
  const toolCall = tryParseToolCall(raw);
  if (toolCall) {
    xmlHintCount = 0;
    if (!hasTool(toolCall.toolName)) {
      console.log('[Cuckoo Code][拦截] 工具不存在: ' + toolCall.toolName);
      sendToolResultToChat(
        toolCall,
        { success: false, error: '工具 ' + toolCall.toolName + ' 不存在，可用工具: ' + toolNamesList() }
      );
      return;
    }
    console.log('[Cuckoo Code][拦截] 工具存在: ' + toolCall.toolName + ', 开始执行');
    await handleToolCall(toolCall);
    return;
  }

  // 3. 工具调用格式提示（未按 ```cuckoo 格式输出的常见错误形态：
  //    XML invoke 族 / AntML 特殊 token / JSON 工具调用对象）
  const wrong = detectWrongToolFormat(raw);
  if (wrong.detected) {
    if (xmlHintCount >= XML_HINT_MAX) {
      console.log('[Cuckoo Code][拦截] 已连续提示 ' + xmlHintCount + ' 次格式错误，停止发送');
      return;
    }
    xmlHintCount++;
    console.log('[Cuckoo Code][拦截] 检测到非约定格式工具调用（' + wrong.kind + '，第 ' + xmlHintCount + ' 次提示）');
    sendMessageToChat(
      '请使用' + BT + BT + BT + 'cuckoo' + BT + BT + BT + ' 代码块进行工具调用，不要使用 ' +
      (wrong.kind === 'json' ? 'JSON 工具调用对象' : 'XML/特殊标记') + ' 格式。',
      '工具格式提示'
    );
    return;
  }

  // 4. 普通文本回复
  console.log('[Cuckoo Code][拦截] 正常文本回复，未检测到工具调用');
  try {
    window.electronAPI.showAiNotification().catch(() => {});
  } catch (e) { /* ignore */ }
}

/**
 * 启动拦截事件监听
 */
function startInterceptObserver() {
  window.addEventListener('cuckoo-ai-response', (ev) => {
    try {
      const detail = ev && ev.detail;
      if (!detail || !detail.finished) return;
      processInterceptedResponse(detail.text);
    } catch (err) {
      console.error('[Cuckoo Code][拦截] 处理回复事件出错:', err);
    }
  });
  console.log('[Cuckoo Code][拦截] 已启动 cuckoo-ai-response 事件监听');
}

module.exports = { startInterceptObserver, processInterceptedResponse };

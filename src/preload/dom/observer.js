/**
 * 回复解析主流程：MutationObserver、完成检测、工具/JS 脚本执行
 * 由原 preload.js 拆分而来，逻辑保持不变。
 */
const {
  showOverlay, setTaskStatus, showToast, showConfirmDialog, addHistory, flashBadge, truncate, displayCommand, generateId,
} = require('../overlay/ui');
const { scanForCommands } = require('./detector');
const { tryParseToolCall } = require('./tool-parser');
const { getJsCodeBlocksFromMarkdown, getSubagentResultBlocksFromMarkdown, isGenerationInterrupted, looksIncompleteSubagentResult, looksLikeIncompleteCodeError, FENCE } = require('./js-detector');
const { sendToolResultToChat, sendCombinedJsResultsToChat, sendMessageToChat } = require('./chat-input');
const { isAIResponseComplete } = require('./ai-response');
const { getProviderByUrl } = require('../../../src/providers');
const { hasTool, toolNamesList } = require('../tool-names');
const state = require('./state');

/**
 * 手动解析按钮点击处理
 * 用户点击后，仅解析最后一条 AI 回复中的工具调用并执行
 */
async function triggerManualParseAttention() {
  const btn = document.getElementById('cuckoo-btn-manual-parse');
  if (btn) {
    btn.classList.remove('cuckoo-btn-attention');
    // 强制回流以重新触发动画
    void btn.offsetWidth;
    btn.classList.add('cuckoo-btn-attention');
    // 动画结束后移除类，避免状态残留
    setTimeout(() => {
      btn.classList.remove('cuckoo-btn-attention');
    }, 3500);
  }
}

// 是否正在执行命令或工具（供手动解析等入口判断）
let isExecuting = false;

async function handleManualParse() {
  if (isExecuting) {
    showToast('命令正在执行，无需手动解析', 3000);
    return;
  }
  const btn = document.getElementById('cuckoo-btn-manual-parse');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '解析中...';
  }

  try {
    // 复用自动解析逻辑：仅解析最后一条 AI 回复
    processLatestAIResponse(0, true);
    showToast('已触发手动解析最后一条 AI 回复', 3000);
  } catch (err) {
    console.error('[Cuckoo Code] 手动解析出错:', err);
    showToast('手动解析出错: ' + err.message, 3000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '手动解析';
    }
  }
}
// ========== MutationObserver ==========

// 已处理过的消息节点集合（避免重复处理）
let processedMessages = new WeakSet();

// JS 代码块稳定性校验状态：msg → {snapshot, blocksSig, lastChange}
// 由 mutation 驱动更新；interval 兜底在内容稳定满窗口后执行，不依赖单次 setTimeout（智谱等 SPA 下不可靠）
let jsStability = new Map();
let stabilityTimer = null;

// 连续 XML 提示次数（防止 AI 持续用 XML 格式回复导致无限循环）
let xmlHintCount = 0;
const XML_HINT_MAX = 10;

// ========== Task 13.2：生成中断恢复（仅子 Agent 窗口）==========
// 空内容 / 过短 / 服务器繁忙 → 等 3-5s → 点重试按钮，最多 2 次
const GENERATION_RETRY_MAX = 2;
const GENERATION_RETRY_DELAY_MIN = 3000;
const GENERATION_RETRY_DELAY_MAX = 5000;
const DEEPSEEK_RETRY_BUTTON_SELECTOR = "div[role='button'].ds-button--warning.ds-button--circle";
let generationRetryCount = 0;
// subagent_result XML 格式提示次数（子 Agent 用 <subagent_result> 而非代码块时的熔断）
let subagentXmlHintCount = 0;
const SUBAGENT_XML_HINT_MAX = 10;
// subagent_result 完整性提示次数（疑似截断时提示重试的熔断）
let subagentIncompleteHintCount = 0;
const SUBAGENT_INCOMPLETE_HINT_MAX = 3;

// 重置已处理状态（URL 切换/新会话时调用）
function resetProcessedState() {
  processedMessages = new WeakSet();
  jsStability = new Map();
  if (stabilityTimer) {
    clearInterval(stabilityTimer);
    stabilityTimer = null;
  }
  xmlHintCount = 0;
  subagentXmlHintCount = 0;
  subagentIncompleteHintCount = 0;
  generationRetryCount = 0;
}

// 内容不完整时的最大重试次数（AI 生成长内容可能需 30 秒+）
const MAX_RETRY_COUNT = 2;
// 重试间隔（ms）
const RETRY_INTERVAL = 2000;
// JS 代码块稳定确认窗口（ms）
const JS_STABILITY_WINDOW = 800;
// subagent_result 稳定确认窗口（ms）：交付物长、无重试兜底，需更长窗口防中途停顿误判为"稳定"
const SUBAGENT_RESULT_STABILITY_WINDOW = 3000;
// interval 兜底轮询间隔（ms）
const STABILITY_POLL_INTERVAL = 500;
/**
 * 检查字符串是否为"疑似工具调用但内容不完整"
 * 规则：文本包含 { 且含工具调用特征（toolName/工具名/大括号开头），
 * 则从第一个 { 开始检查括号配对；配对不完整返回 false（需要重试）
 */
function isJsonBalanced(str) {
  const trimmed = (str || '').trim();
  // 不含 { 或没有工具调用特征 → 不是工具调用，直接通过
  if (!trimmed.includes('{')) return true;
  if (!/toolName|"tool"|file_|json复制|```/.test(trimmed) && !trimmed.trimStart().startsWith('{')) {
    return true;
  }
  // 从第一个 { 开始检查括号配对
  const jsonPart = trimmed.substring(trimmed.indexOf('{'));
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  for (const char of jsonPart) {
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount < 0) return true; // 多出的 }，视为异常但不再等
      }
    }
  }
  return braceCount === 0;
}
/**
 * 获取当前平台 Provider（若未识别则返回 null）
 */
function getCurrentProvider() {
  return getProviderByUrl(window.location.href);
}

/**
 * 获取当前平台消息容器元素列表（过滤用户消息）
 */
function getMessageCandidates() {
  const provider = getCurrentProvider();
  if (!provider || typeof provider.getMessageCandidates !== 'function') return [];
  return provider.getMessageCandidates();
}

/**
 * 获取消息容器中的回复内容根节点
 */
function getMessageMarkdown(messageEl) {
  const provider = getCurrentProvider();
  if (!provider || typeof provider.getMessageMarkdown !== 'function') return messageEl;
  return provider.getMessageMarkdown(messageEl);
}

/**
 * 执行 JS 代码块，遇到"代码不完整"类错误时自动重试。
 * 策略：等待 1 秒后重新从 markdown 获取最新代码块，最多重试 3 次。
 * 仍失败则把最终报错回传 AI。
 * @param {Array<string>} initialBlocks 初始提取的代码块
 * @param {Element} markdown 消息 markdown 根节点
 * @param {boolean} force 是否手动解析模式
 */
async function executeJsBlocksWithRetry(initialBlocks, markdown, force) {
  let blocks = initialBlocks;
  let results = [];
  const MAX_JS_RETRY = 3;

  for (let attempt = 0; attempt <= MAX_JS_RETRY; attempt++) {
    results = [];
    for (const code of blocks) {
      const r = await handleJsToolScript(code);
      if (r) results.push(r);
    }

    const hasIncompleteFailure = results.some(
      item => item && item.result && !item.result.success && looksLikeIncompleteCodeError(item.result.error)
    );

    if (!hasIncompleteFailure) break;

    if (attempt < MAX_JS_RETRY) {
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] ⏳ 代码不完整，等待 1 秒后重新获取并重试（' + (attempt + 1) + '/' + MAX_JS_RETRY + '）...');
      await sleep(1000);
      console.log('[' + new Date().toISOString() + '] [Cuckoo Code] ⏳ 等待结束，开始第 ' + (attempt + 1) + ' 次重试');
      blocks = getJsCodeBlocksFromMarkdown(markdown);
    }
  }

  const stillIncomplete = results.some(
    item => item && item.result && !item.result.success && looksLikeIncompleteCodeError(item.result.error)
  );
  if (stillIncomplete) {
    console.log('[' + new Date().toISOString() + '] [Cuckoo Code] ⚠️ 代码不完整，已重试 ' + MAX_JS_RETRY + ' 次仍失败，将报错回传 AI');
  }
  if (results.length > 0) sendCombinedJsResultsToChat(results);
}
/**
 * 稳定性 interval 兜底：mutation 驱动可能因 SPA 宏任务风暴而漏触发，
 * 这里每 STABILITY_POLL_INTERVAL 检查一次，内容稳定满 JS_STABILITY_WINDOW 即执行。
 * 与 mutation 通道共享 jsStability 快照；执行后按消息预标记，防止双通道重复处理。
 */
function ensureStabilityTimer() {
  if (stabilityTimer) return;
  stabilityTimer = setInterval(() => {
    const now = Date.now();
    for (const [msg, rec] of jsStability) {
      // 节点已被页面卸载：清理
      if (typeof msg.isConnected === 'boolean' && !msg.isConnected) {
        jsStability.delete(msg);
        continue;
      }
      if (now - rec.lastChange >= JS_STABILITY_WINDOW) {
        jsStability.delete(msg);
        if (processedMessages.has(msg)) continue; // 已被其他通道处理
        processedMessages.add(msg);
        // 内容已稳定满窗口 → force 直接执行（避免重新 set 快照导致死循环）
        processLatestAIResponse(0, true);
      }
    }
    if (jsStability.size === 0) {
      clearInterval(stabilityTimer);
      stabilityTimer = null;
    }
  }, STABILITY_POLL_INTERVAL);
}


/**
 * 回复结束后，获取最新一条 AI 回复的内容并解析工具调用
 * @param {number} retryCount 当前重试次数（内容不完整时延迟重试）
 */
function processLatestAIResponse(retryCount = 0, force = false) {
  const messages = getMessageCandidates();
  const nowIso = new Date().toISOString();
  console.log('[' + nowIso + '] [DEBUG] messages count=' + messages.length);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    console.log('[' + nowIso + '] [DEBUG] [' + i + '] cls=' + ((m.className || m.tagName || '').toString().slice(0, 60)) + ' text=' + ((m.textContent || '').trim().slice(0, 50)));
  }
  if (messages.length === 0) {
    console.log('[Cuckoo Code] 未找到 AI 消息节点');
    return;
  }

  // 从后往前找第一条有实际内容的 AI 消息，跳过空消息
  let lastMessage = null;
  let markdown = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    const md = getMessageMarkdown(candidate);
    const hasContent = md && (md.textContent || '').trim().length > 0;
    if (hasContent) {
      lastMessage = candidate;
      markdown = md;
      break;
    }
  }
  if (!lastMessage || !markdown) {
    console.log('[Cuckoo Code] 未找到有内容的 AI 回复');
    return;
  }

  if (!force && processedMessages.has(lastMessage)) {
    return; // 已处理过，跳过
  }

  // 跳过用户消息（其中包含系统提示词里的示例代码块，不应被执行）
  const providerForUser = getCurrentProvider();
  if (providerForUser && typeof providerForUser.isUserMessage === 'function' && providerForUser.isUserMessage(lastMessage)) {
    processedMessages.add(lastMessage);
    console.log('[Cuckoo Code] ⏭ 跳过用户消息（包含系统提示词示例）');
    return;
  }

  // 优先检测 JS 工具代码块（cuckoo 代码块 / 调用工具函数的 js 代码块）
  const jsBlocks = getJsCodeBlocksFromMarkdown(markdown);
  console.log('[DEBUG][processLatest] lastMessage=' + (lastMessage.className || lastMessage.tagName) +
    ' markdown=' + (markdown.className || markdown.tagName) +
    ' jsBlocks=' + jsBlocks.length +
    ' force=' + force +
    ' retryCount=' + retryCount);
  if (jsBlocks.length > 0) {
    // 稳定性双通道校验：流式渲染期间代码块只渲染了一半（曾导致 "const content"
    // 这样的残缺代码被执行 → SyntaxError）。mutation 驱动 + interval 兜底，
    // 内容稳定满 JS_STABILITY_WINDOW 后执行，不依赖单次 setTimeout（智谱等 SPA 下不可靠）。
    if (force) {
      // 手动解析：跳过稳定性校验，直接执行（标记已处理，避免同节点重复自动执行）
      processedMessages.add(lastMessage);
      console.log('[Cuckoo Code] 手动解析模式，跳过稳定性校验');
      executeJsBlocksWithRetry(jsBlocks, markdown, true);
      return;
    }

    const snapshot = markdown.textContent || '';
    const blocksSig = jsBlocks.map((b) => b.length).join(',');
    const now = Date.now();
    const rec = jsStability.get(lastMessage);
    if (!rec || rec.snapshot !== snapshot || rec.blocksSig !== blocksSig) {
      // 内容仍在变化：记录快照，等待下一次 mutation / interval 复查
      jsStability.set(lastMessage, { snapshot, blocksSig, lastChange: now });
      ensureStabilityTimer();
      console.log('[Cuckoo Code] ⏳ 检测到 JS 工具代码块，流式渲染中，等待稳定...');
      return; // 不标记 processed，稳定后执行
    }

    // 内容一致：需稳定满窗口确认
    if (now - rec.lastChange < JS_STABILITY_WINDOW) {
      console.log('[Cuckoo Code] ⏳ JS 代码块稳定中（等待 ' + JS_STABILITY_WINDOW + 'ms 确认）...');
      return;
    }

    // 稳定满窗口 → 执行
    jsStability.delete(lastMessage);
    processedMessages.add(lastMessage);
    console.log('[Cuckoo Code] ✅ 代码块稳定，检测到 JS 工具代码块（' + jsBlocks.length + ' 个），开始执行');
    // 正确使用 cuckoo 代码块，重置 XML 提示计数
    xmlHintCount = 0;
    executeJsBlocksWithRetry(jsBlocks, markdown, false);
    return;
  }

  // ========== subagent_result 检测（Task 7）==========
  // 优先级：cuckoo → subagent_result → JSON → 纯文本
  // 仅子 Agent 窗口处理 subagent_result：主窗口对话中可能正常出现这些字样，不应触发提示/上报
  if (state.subagentId) {
  const subagentBlocks = getSubagentResultBlocksFromMarkdown(markdown);
  // 非法格式检测：子 Agent 用 <subagent_result> XML 标签而非代码块 → 提醒重试（复用主项目 XML 处理机制）
  if (subagentBlocks.length === 0) {
    const rawText = (markdown.textContent || '').trim();
    const hasSubagentXml = /<\s*subagent_result\s*>/i.test(rawText) || /<\s*\/\s*subagent_result\s*>/i.test(rawText);
    if (hasSubagentXml) {
      if (!force) processedMessages.add(lastMessage);
      if (subagentXmlHintCount >= SUBAGENT_XML_HINT_MAX) {
        console.log('[Cuckoo Code] ⚠️ 已连续提示 ' + subagentXmlHintCount + ' 次 subagent_result XML 格式，熔断');
        return;
      }
      subagentXmlHintCount++;
      const BT = String.fromCharCode(96);
      console.log('[Cuckoo Code] ⚠️ 检测到 subagent_result XML 格式（第 ' + subagentXmlHintCount + ' 次提示），提示改用代码块');
      sendMessageToChat(
        '请使用 ' + BT + BT + BT + 'subagent_result' + BT + BT + BT + ' 代码块交付最终结果，不要使用 <subagent_result> XML 标签。代码块之外不要有任何文字。',
        'subagent_result 格式提示'
      );
      return;
    }
  }
  if (subagentBlocks.length > 0) {
    // 与 cuckoo 相同的快照双读稳定性校验
    if (force) {
      processedMessages.add(lastMessage);
      const text = subagentBlocks.join('\n\n---\n\n');
      window.electronAPI.notifySubagentResult({ type: 'subagent_result', text }).catch(() => {});
      console.log('[Cuckoo Code] 手动解析模式，subagent_result 已上报');
      return;
    }

    const snapshot = markdown.textContent || '';
    const blocksSig = subagentBlocks.map((b) => b.length).join(',');
    const now = Date.now();
    const rec = jsStability.get(lastMessage);
    if (!rec || rec.snapshot !== snapshot || rec.blocksSig !== ('subagent:' + blocksSig)) {
      jsStability.set(lastMessage, { snapshot, blocksSig: 'subagent:' + blocksSig, lastChange: now });
      ensureStabilityTimer();
      console.log('[Cuckoo Code] ⏳ 检测到 subagent_result，流式渲染中，等待稳定...');
      return;
    }

    if (now - rec.lastChange < SUBAGENT_RESULT_STABILITY_WINDOW) {
      console.log('[Cuckoo Code] ⏳ subagent_result 稳定中（等待 ' + SUBAGENT_RESULT_STABILITY_WINDOW + 'ms 确认）...');
      return;
    }

    const text = subagentBlocks.join('\n\n---\n\n');
    // 完整性校验：疑似截断 → 提示重试（与 XML 格式提示分开的第二种提示）
    if (looksIncompleteSubagentResult(text)) {
      if (!force) processedMessages.add(lastMessage);
      if (subagentIncompleteHintCount >= SUBAGENT_INCOMPLETE_HINT_MAX) {
        console.log('[Cuckoo Code] ⚠️ subagent_result 完整性提示达上限（' + subagentIncompleteHintCount + '），接受当前内容');
        // 熔断：接受当前内容（带提示由 runner 端处理）
      } else {
        subagentIncompleteHintCount++;
        console.log('[Cuckoo Code] ⚠️ subagent_result 疑似截断（第 ' + subagentIncompleteHintCount + ' 次提示），提示重试');
        sendMessageToChat(
          '你的 subagent_result 似乎被截断了（内容以标题结尾、缺少正文，或为空）。请重新输出【完整】的 subagent_result 代码块，包含所有章节的正文内容。',
          'subagent_result 完整性提示'
        );
        return;
      }
    }

    jsStability.delete(lastMessage);
    processedMessages.add(lastMessage);
    subagentXmlHintCount = 0; // 正确使用代码块，重置 XML 提示计数
    subagentIncompleteHintCount = 0; // 完整交付，重置完整性提示计数
    window.electronAPI.notifySubagentResult({ type: 'subagent_result', text }).catch(() => {});
    console.log('[Cuckoo Code] ✅ subagent_result 稳定，已上报（长度 ' + text.length + '）');
    return;
  }
  } // end if (state.subagentId) — subagent_result 仅子 Agent 窗口处理

  // 无 JS 代码块：文本也可能仍在流式渲染中（先文字后代码块 / 代码块中途不完整）。
  // 若直接处理，会因"疑似工具但未识别"或"普通文本"提前标记 processed，
  // 导致同一条消息后续渲染出的完整代码块被永久跳过（智谱等 SPA 回复中途
  // isResponseComplete 即可能返回 true）。与 JS 块共用稳定性通道。
  if (!force) {
    const snapshot = markdown.textContent || '';
    const now = Date.now();
    const rec = jsStability.get(lastMessage);
    if (!rec || rec.snapshot !== snapshot) {
      jsStability.set(lastMessage, { snapshot, blocksSig: 'text', lastChange: now });
      ensureStabilityTimer();
      console.log('[Cuckoo Code] ⏳ 文本内容渲染中，等待稳定（防流式中途漏检）...');
      return;
    }
    if (now - rec.lastChange < JS_STABILITY_WINDOW) {
      console.log('[Cuckoo Code] ⏳ 文本内容稳定中（等待 ' + JS_STABILITY_WINDOW + 'ms 确认）...');
      return;
    }
    jsStability.delete(lastMessage);
  }

  // 提取文本：优先从 pre code 提取（代码块内容天然不含 json/复制/下载等按钮文字）
  let text = '';
  const codeEl = markdown.querySelector('pre code');
  if (codeEl) {
    text = (codeEl.textContent || codeEl.innerText || '').trim();
    console.log('[Cuckoo Code] 提取方式: pre code 元素');
  } else {
    // 无代码块：克隆节点并剔除可能的工具栏元素
    const clone = markdown.cloneNode(true);
    clone.querySelectorAll('button, [class*="toolbar"], [class*="copy"], [class*="download"], [class*="code-block-header"], [class*="lang"], [class*="header"]').forEach(el => el.remove());
    text = (clone.textContent || clone.innerText || '').trim();
    console.log('[Cuckoo Code] 提取方式: 克隆节点(剔除工具栏)');
  }

  if (!text) {
    console.log('[DEBUG][processLatest] 提取文本为空');
    return;
  }
  console.log('[DEBUG][processLatest] text长度=' + text.length + ' 前60字符=' + JSON.stringify(text.slice(0, 60)));
  console.log(text);

  // 是否为疑似工具内容（用于控制详细日志与提示文案）
  const looksToolish = text.includes(FENCE) ||
    /toolName|"tool"|file_|await\s+(?:read|write|edit|glob|grep|bash|pwsh|todoWrite|deleteFile|webFetch|openBrowserWindow|injectJS|readFile|writeFile|editFile)\s*\(/.test(text);

  // 长度必打；原文/转义仅在疑似工具内容时打印（普通聊天回复不再刷屏）
  console.log('[Cuckoo Code] 回复文本长度: ' + text.length + (looksToolish ? '（疑似工具内容）' : '（普通文本）'));
  if (looksToolish) {
    console.log('[Cuckoo Code] 回复完整内容(原文):');
    console.log(text);
    console.log('[Cuckoo Code] 回复完整内容(转义显示):');
    console.log(JSON.stringify(text));
  }

  // 内容不完整（疑似流式输出未真正结束）：延迟重试，避免处理截断的 JSON
  if (!force && !isJsonBalanced(text)) {
    if (retryCount < MAX_RETRY_COUNT) {
      console.log('[Cuckoo Code] ⏳ JSON 不完整(疑似流式未结束)，' + (retryCount + 1) + '/' + MAX_RETRY_COUNT + ' 次延迟重试, 当前长度=' + text.length + '...');
      setTimeout(() => processLatestAIResponse(retryCount + 1), RETRY_INTERVAL);
      return; // 不标记 processed，允许重试
    }
    console.log('[Cuckoo Code] ⚠️ JSON 持续不完整（20次重试仍截断），放弃本次处理，当前长度=' + text.length);
    // 回传 AI，让它重新完整输出
    sendToolResultToChat(
      { toolName: '未知', callId: 'incomplete' },
      { success: false, error: '收到不完整的工具调用 JSON（内容被截断），请重新完整输出工具调用。' }
    );
  }

  if (!force) processedMessages.add(lastMessage);

  const toolCall = tryParseToolCall(text);
  if (toolCall) {
    // 正确使用 JSON 工具调用，重置 XML 提示计数
    xmlHintCount = 0;
    // 验证 toolName 是否在工具库中
    const available = hasTool(toolCall.toolName);
    if (!available) {
      console.log('[Cuckoo Code] ⚠️ 工具不存在: ' + toolCall.toolName + ', 可用工具: ' + toolNamesList());
      // 回传 AI，告知工具不存在
      sendToolResultToChat(
        toolCall,
        { success: false, error: '工具 ' + toolCall.toolName + ' 不存在，可用工具: ' + toolNamesList() }
      );
      return;
    }
    console.log('[Cuckoo Code] ✅ 工具存在: ' + toolCall.toolName + ', 开始执行');
    notifyToolCallDetected(toolCall);
    handleToolCall(toolCall);
  } else {
    // JSON 工具调用未解析到，再检测 XML 格式的工具调用
    // 诊断：打印 XML 检测相关状态（text 和 innerHTML）
    console.log('[Cuckoo Code] [XML诊断] text长度=' + text.length + ', 开头100字符=' + JSON.stringify(text.slice(0, 100)));
    console.log('[Cuckoo Code] [XML诊断] markdown.innerHTML长度=' + (markdown.innerHTML || '').length + ', 开头200字符=' + JSON.stringify((markdown.innerHTML || '').slice(0, 200)));
    console.log('[Cuckoo Code] [XML诊断] 是否有 pre code 元素=' + !!markdown.querySelector('pre code'));
    // 精准判断：
    // 1. <｜｜DSML｜｜ 开头直接触发（自定义标签前缀，如 <｜｜DSML｜｜tool_calls>、<｜｜DSML｜｜invoke>）
    // 2. <invoke 必须带 name 属性，且出现闭合标签或 parameter 参数标签
    const hasAntmlXml = /^<\s*｜｜DSML｜｜/i.test(text);
    const hasXmlInvoke = /<\s*(?:[\w-]+:)?invoke\s+name=/i.test(text);
    const hasXmlClose = /<\s*\/\s*(?:[\w-]+:)?invoke\s*>/i.test(text);
    const hasXmlParam = /<\s*(?:[\w-]+:)?parameter\s+name=/i.test(text);
    if (hasAntmlXml || (hasXmlInvoke && (hasXmlClose || hasXmlParam))) {
      // 防止同一条消息被反复扫描时重复发送提示语
      if (!force) processedMessages.add(lastMessage);

      if (xmlHintCount >= XML_HINT_MAX) {
        // 已连续提示多次，AI 仍用 XML 格式，熔断停止发送，避免无限循环
        console.log('[Cuckoo Code] ⚠️ 已连续提示 ' + xmlHintCount + ' 次 XML 格式，停止发送提示语');
        return;
      }
      xmlHintCount++;
      console.log('[Cuckoo Code] ⚠️ 检测到 XML 格式工具调用（第 ' + xmlHintCount + ' 次提示），提示 AI 改用 cuckoo 代码块');
      const BT = String.fromCharCode(96);
      sendMessageToChat(
        '请使用' + BT + BT + BT + 'cuckoo' + BT + BT + BT + ' 代码块进行工具调用，不要使用 XML invoke 格式。',
        'XML工具调用提示'
      );
      return;
    }

    if (looksToolish) {
      // 疑似工具内容但 JS 块检测与 JSON 解析都没命中 → 打印诊断，帮助定位
      console.log('[Cuckoo Code] ⚠️ 回复疑似工具调用但未被识别（JS 代码块未匹配 / JSON 解析失败）');
      const pres = markdown.querySelectorAll('pre');
      if (pres.length > 0) {
        for (const p of pres) {
          const providerForLang = getCurrentProvider();
          const lang = (providerForLang && typeof providerForLang.getCodeBlockLanguage === 'function')
            ? providerForLang.getCodeBlockLanguage(p)
            : '';
          console.log('[Cuckoo Code] [诊断] 代码块 language=' + (lang || '(无)') + ', 内容前80字符=' + ((p.textContent || '').trim().slice(0, 80)));
        }
      } else {
        console.log('[Cuckoo Code] [诊断] 消息中没有任何 pre 代码块');
      }
    } else {
      console.log('[Cuckoo Code] ℹ️ 正常文本回复，未检测到工具调用（无需处理）');
      // 子 Agent 窗口：纯文本上报（供 Task 10 停住检测）；主窗口：通知兜底
      if (state.subagentId) {
        window.electronAPI.notifySubagentResult({ type: 'plain_text', text }).catch(() => {});
        console.log('[Cuckoo Code] 子 Agent 纯文本已上报（供停住检测）');
      } else if (lastNotifiedText !== text) {
        lastNotifiedText = text;
        window.electronAPI.showAiNotification().catch(() => {});
      }
    }
  }
}
// 读取防抖定时器（已弃用，改用 Promise sleep + 处理中标志位）
let isProcessingResponse = false;
let lastObserverRun = 0;
let completionPollTimer = null;
let lastNotifiedText = '';
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 取最后一条有内容的 AI 回复文本（仅用于生成中断检测）。
 */
function getLastAIText() {
  const messages = getMessageCandidates();
  for (let i = messages.length - 1; i >= 0; i--) {
    const md = getMessageMarkdown(messages[i]);
    const t = md && (md.textContent || '').trim();
    if (t) return t;
  }
  return '';
}

/**
 * 查找 DeepSeek「服务器繁忙」重试按钮。
 */
function findRetryButton() {
  try {
    return document.querySelector(DEEPSEEK_RETRY_BUTTON_SELECTOR);
  } catch (_) {
    return null;
  }
}

/**
 * 检测生成中断并按需重试（等待 3-5s → 点重试按钮）。
 * 仅子 Agent 窗口生效，不改主窗口行为。
 * @returns {Promise<boolean>} true = 已触发重试（调用方本轮跳过正常处理）
 */
async function maybeRetryInterruptedGeneration() {
  if (!state.subagentId) return false; // 仅子 Agent 窗口
  if (generationRetryCount >= GENERATION_RETRY_MAX) return false;

  const text = getLastAIText();
  const reason = isGenerationInterrupted(text);
  if (!reason) {
    generationRetryCount = 0; // 正常回复，重置计数
    return false;
  }

  console.log('[Cuckoo Code] 检测到生成中断（' + reason + '），准备重试');
  const delay = GENERATION_RETRY_DELAY_MIN + Math.random() * (GENERATION_RETRY_DELAY_MAX - GENERATION_RETRY_DELAY_MIN);
  await sleep(delay);
  const btn = findRetryButton();
  if (!btn) {
    console.log('[Cuckoo Code] 未找到重试按钮，放弃本次重试');
    return false;
  }
  generationRetryCount++;
  console.log('[Cuckoo Code] 点击重试按钮（第 ' + generationRetryCount + '/' + GENERATION_RETRY_MAX + ' 次）');
  try { btn.click(); } catch (_) {}
  return true;
}
function startObserver() {
  // 子 Agent 窗口：observer 启动即上报 ready 握手
  if (state.subagentId) {
    try {
      window.electronAPI.notifySubagentReady(state.subagentId).catch(() => {});
      console.log('[Cuckoo Code] 子 Agent observer-ready 已上报:', state.subagentId);
    } catch (_) {}
  }

  const observer = new MutationObserver((mutations) => {
    // 100ms 节流：避免页面高频 DOM 变化导致日志与检测刷屏
    const now = Date.now();
    if (now - lastObserverRun < 100) return;
    lastObserverRun = now;

    let hasNewContent = false;
    const mutationStats = { childList: 0, characterData: 0, attributes: 0 };
    for (const mutation of mutations) {
      mutationStats[mutation.type] = (mutationStats[mutation.type] || 0) + 1;
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // 扫描命令
        const commands = scanForCommands(mutation.addedNodes);
        for (const cmd of commands) {
          displayCommand({ command: cmd, timestamp: Date.now(), id: generateId() });
        }
        hasNewContent = true;
      } else if (mutation.type === 'characterData' || mutation.type === 'attributes') {
        // Claude 的完成信号（retry 按钮 / 代码块）可能通过文本或属性变化出现，
        // 不产生新增子节点，也需要触发完成检测。
        hasNewContent = true;
      }
    }

    // 回复结束后读取最新 AI 回复；完成判定内部已含必要等待
    if (hasNewContent && !isProcessingResponse) {
      // 若最后一条 AI 消息已处理过，则跳过，避免反复打印和等待
      const candidates = getMessageCandidates();
      const lastMsg = candidates.length > 0 ? candidates[candidates.length - 1] : null;
      if (lastMsg && processedMessages.has(lastMsg)) {
        return;
      }

      isProcessingResponse = true;
      (async () => {
        try {
          if (await isAIResponseComplete()) {
            if (await maybeRetryInterruptedGeneration()) return; // 生成中断，已触发重试
            processLatestAIResponse();
          }
        } finally {
          isProcessingResponse = false;
        }
      })();
    }
  });

  const target = document.body || document.documentElement;
  if (target) {
    observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  // 完成检测兜底轮询：mutation 通道存在漏触发窗口——
  // 长回复期间"停止对话"按钮常驻使 isAIResponseComplete 持续 false，生成结束按钮消失
  // 这一完成信号若恰好落在 100ms 节流 / isProcessingResponse 串行窗口内会被丢弃，
  // 之后无新 DOM 变化则永久不触发。定期主动复查一次，覆盖长生成场景。
  if (!completionPollTimer) {
    completionPollTimer = setInterval(() => {
      if (isProcessingResponse) return;
      (async () => {
        try {
          if (await isAIResponseComplete()) {
            if (await maybeRetryInterruptedGeneration()) return; // 生成中断，已触发重试
            processLatestAIResponse();
          }
        } catch (_) { /* 轮询失败静默，等待下一轮 */ }
      })();
    }, 2000);
  }
}


/**
 * 通知用户检测到工具调用（闪烁状态徽章 + 展开覆盖层）
 */
function notifyToolCallDetected(toolCall) {
  // 方向 C：不强制弹面板，只更新预览和徽章
  // 更新预览区域显示检测到的工具调用
  const preview = document.getElementById('cuckoo-cmd-preview');
  if (preview) {
    preview.textContent = `[工具] ${toolCall.toolName}\n参数: ${JSON.stringify(toolCall.params, null, 2)}`;
  }
  // 闪烁状态徽章
  flashBadge('Cuckoo Code - 工具调用检测到');
}
/**
 * 通知用户检测到 JS 工具脚本（更新预览 + 闪烁徽章）
 */
function notifyJsScriptDetected(code) {
  // 方向 C：不强制弹面板
  const preview = document.getElementById('cuckoo-cmd-preview');
  if (preview) {
    preview.textContent = '[JS 工具脚本]' + String.fromCharCode(10) + code;
  }
  flashBadge('Cuckoo Code - JS 工具脚本检测到');
}
/**
 * 执行检测到的 JS 工具脚本（带双通道去重）
 */
async function handleJsToolScript(code) {
  // 方向 C：不强制弹面板
  isExecuting = true;
  notifyJsScriptDetected(code);
  setTaskStatus(true);
  showToast('开始执行命令');

  const callId = 'js_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  console.log('[Cuckoo Code] [诊断] 即将执行的代码(JSON转义): ' + JSON.stringify(code));
  try {
    const result = await window.electronAPI.executeJs(code, callId);

    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');
    if (resultSection) resultSection.classList.remove('cuckoo-hidden');

    if (result.success) {
      if (resultStatus) {
        resultStatus.textContent = '✅ JS 脚本执行成功';
        resultStatus.className = 'cuckoo-result-status success';
      }
      if (resultOutput) {
        resultOutput.textContent = result.output || '(脚本执行完成，无输出)';
      }
    } else {
      if (resultStatus) {
        resultStatus.textContent = '❌ JS 脚本执行失败';
        resultStatus.className = 'cuckoo-result-status error';
      }
      if (resultOutput) {
        resultOutput.textContent = result.error || '未知错误';
      }
    }

    addHistory({
      id: callId,
      command: '[JS] ' + truncate((code.split(String.fromCharCode(10))[0] || code), 60),
      success: result.success,
      output: result.success ? (result.output || '') : (result.error || '未知错误'),
      timestamp: Date.now(),
    });

    // 返回执行结果，由调用方统一合并回传
    return { code, result };
  } catch (err) {
    console.error('[Cuckoo Code] JS 工具脚本执行异常:', err);
    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');
    if (resultSection) resultSection.classList.remove('cuckoo-hidden');
    if (resultStatus) {
      resultStatus.textContent = '❌ 系统错误';
      resultStatus.className = 'cuckoo-result-status error';
    }
    if (resultOutput) {
      resultOutput.textContent = err.message || String(err);
    }
    return { code, result: { success: false, error: '系统异常: ' + (err.message || String(err)) } };
  } finally {
    isExecuting = false;
    setTaskStatus(false);
  }
}
/**
 * 执行工具调用
 */
async function handleToolCall(toolCall) {
  const { toolName, params, callId } = toolCall;
  console.log(`[Cuckoo Code] 执行工具: ${toolName}`, params);

  // 方向 C：不强制弹面板
  isExecuting = true;
  setTaskStatus(true);
  showToast('开始执行命令');

  try {
    const result = await window.electronAPI.executeTool(toolName, params, callId);

    // 显示执行结果
    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');

    if (resultSection) resultSection.classList.remove('cuckoo-hidden');

    if (result.success) {
      if (resultStatus) {
        resultStatus.textContent = `✅ 工具 ${toolName} 执行成功`;
        resultStatus.className = 'cuckoo-result-status success';
      }
      if (resultOutput) {
        resultOutput.textContent = JSON.stringify(result.data, null, 2);
      }
    } else {
      if (resultStatus) {
        resultStatus.textContent = `❌ 工具 ${toolName} 执行失败`;
        resultStatus.className = 'cuckoo-result-status error';
      }
      if (resultOutput) {
        resultOutput.textContent = result.error || '未知错误';
      }
    }

    // 添加到历史
    addHistory({
      id: callId,
      command: `[工具] ${toolName}`,
      success: result.success,
      output: result.success ? JSON.stringify(result.data, null, 2) : (result.error || '未知错误'),
      timestamp: Date.now(),
    });

    // 将执行结果发送回聊天，让 AI 看到结果并继续工作
    sendToolResultToChat(toolCall, result);
  } catch (err) {
    console.error('[Cuckoo Code] 工具执行异常:', err);
    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');
    if (resultSection) resultSection.classList.remove('cuckoo-hidden');
    if (resultStatus) {
      resultStatus.textContent = '❌ 系统错误';
      resultStatus.className = 'cuckoo-result-status error';
    }
    if (resultOutput) resultOutput.textContent = err.message || String(err);
    // 系统异常也要回传 AI，让它知道发生了什么
    sendToolResultToChat(toolCall, { success: false, error: '系统异常: ' + (err.message || String(err)) });
  } finally {
    isExecuting = false;
    setTaskStatus(false);
  }
}

module.exports = {
  processLatestAIResponse,
  startObserver,
  notifyToolCallDetected,
  notifyJsScriptDetected,
  handleJsToolScript,
  handleToolCall,
  handleManualParse,
};

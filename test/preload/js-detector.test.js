'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  BT,
  FENCE,
  JS_TOOL_CALL_RE,
  looksLikeIncompleteCodeError,
  looksLikeToolScript,
  hasOnlyFences,
  extractJsToolBlocks,
  hasOnlyCodeContent,
  extractSubagentResultBlocks,
  getSubagentResultBlocksFromMarkdown,
  getJsCodeBlocksFromMarkdown,
  isGenerationInterrupted,
  looksIncompleteSubagentResult,
} = require('../../src/preload/dom/js-detector');

test('BT 和 FENCE 定义', () => {
  assert.strictEqual(BT, '`');
  assert.strictEqual(FENCE, '```');
});

test('looksLikeToolScript 识别 await 工具调用', () => {
  assert.strictEqual(looksLikeToolScript('await bash("echo hi")'), true);
  assert.strictEqual(looksLikeToolScript('const x = await readFile("a.txt")'), true);
  assert.strictEqual(looksLikeToolScript('await writeFile("a", "b")'), true);
});

test('looksLikeToolScript 拒绝普通代码', () => {
  assert.strictEqual(looksLikeToolScript('fs.readFile("a.txt")'), false);
  assert.strictEqual(looksLikeToolScript('console.log(1)'), false);
  assert.strictEqual(looksLikeToolScript(''), false);
  assert.strictEqual(looksLikeToolScript(null), false);
});

test('looksLikeIncompleteCodeError 匹配语法错误', () => {
  assert.strictEqual(looksLikeIncompleteCodeError('SyntaxError: Unexpected end'), true);
  assert.strictEqual(looksLikeIncompleteCodeError('Unexpected token'), true);
  assert.strictEqual(looksLikeIncompleteCodeError('normal error'), false);
  assert.strictEqual(looksLikeIncompleteCodeError(null), false);
});

test('hasOnlyFences 仅代码块', () => {
  assert.strictEqual(hasOnlyFences('```js\ncode\n```'), true);
  assert.strictEqual(hasOnlyFences('```js\ncode\n```\n\n```js\nmore\n```'), true);
  assert.strictEqual(hasOnlyFences('text ```js\ncode\n```'), false);
  assert.strictEqual(hasOnlyFences('no fence'), false);
  assert.strictEqual(hasOnlyFences(null), false);
});

test('extractJsToolBlocks 提取 cuckoo 块', () => {
  const text = '```cuckoo\nawait read("a.txt")\n```';
  const blocks = extractJsToolBlocks(text);
  assert.deepStrictEqual(blocks, ['await read("a.txt")']);
});

test('extractJsToolBlocks js 块仅当只有代码块', () => {
  const js = '```js\nawait bash("echo")\n```';
  assert.deepStrictEqual(extractJsToolBlocks(js), ['await bash("echo")']);
  const mixed = '说明\n```js\nawait bash("echo")\n```';
  assert.deepStrictEqual(extractJsToolBlocks(mixed), []);
});

test('extractJsToolBlocks 忽略普通 js', () => {
  const js = '```js\nconsole.log(1)\n```';
  assert.deepStrictEqual(extractJsToolBlocks(js), []);
});

test('extractJsToolBlocks 空输入', () => {
  assert.deepStrictEqual(extractJsToolBlocks(''), []);
  assert.deepStrictEqual(extractJsToolBlocks(null), []);
});

test('getJsCodeBlocksFromMarkdown PRE 元素', () => {
  global.window = { location: { href: 'https://chat.deepseek.com/' } };
  const fakePre = {
    tagName: 'PRE',
    getAttribute: (name) => name === 'data-language' ? 'cuckoo' : '',
    closest: () => null,
    querySelector: () => null,
    textContent: 'await read("a")',
  };
  const blocks = getJsCodeBlocksFromMarkdown(fakePre);
  assert.deepStrictEqual(blocks, ['await read("a")']);
});


// ========== 智谱场景（2026-09-07 修复回归） ==========
// 智谱 .md-code 用 div + highlight.js span 渲染，语言标签定位不到（lang=''）：
// 1) 无 <pre> 时兜底 .md-code 容器；2) lang='' 时代码以工具调用开头即提取（不限 onlyCode）

function makeFakeRoot({ textOnly, codeText, langAttr, hasPre }) {
  const codeEl = hasPre
    ? {
        tagName: 'CODE',
        textContent: codeText,
        querySelectorAll: () => [],
        querySelector: () => null,
        closest: () => null,
        getAttribute: () => null,
        classList: [],
      }
    : null;
  const block = {
    tagName: hasPre ? 'PRE' : 'DIV',
    className: hasPre ? '' : 'markdown-body md-code',
    textContent: codeText,
    querySelector: (sel) => (sel === 'code' ? codeEl : null),
    querySelectorAll: () => [],
    closest: () => null,
    getAttribute: (n) => (n === 'data-language' ? langAttr || null : null),
    classList: [],
    remove: () => {},
  };
  return {
    tagName: 'DIV',
    textContent: (textOnly || '') + ' ' + codeText,
    cloneNode: () => ({
      textContent: textOnly || '',
      querySelectorAll: () => (textOnly ? [] : [block]),
    }),
    querySelectorAll: (sel) => (sel === 'pre' ? (hasPre ? [block] : []) : sel === '.md-code' ? [block] : []),
  };
}

test('智谱：无 pre 的 .md-code 容器 + 语言未知 + 工具调用（带文字说明）→ 提取', () => {
  global.window = { location: { href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh' } };
  const root = makeFakeRoot({
    textOnly: '这是你的页面：',
    codeText: 'await write("hello.html", "<h1>hi</h1>")',
    langAttr: null,
    hasPre: false,
  });
  const blocks = getJsCodeBlocksFromMarkdown(root);
  assert.deepStrictEqual(blocks, ['await write("hello.html", "<h1>hi</h1>")']);
});

test('智谱：无 pre 的 .md-code 容器 + 语言未知 + 工具调用（纯代码）→ 提取', () => {
  global.window = { location: { href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh' } };
  const root = makeFakeRoot({
    textOnly: '',
    codeText: 'await read("a.txt")',
    langAttr: null,
    hasPre: false,
  });
  const blocks = getJsCodeBlocksFromMarkdown(root);
  assert.deepStrictEqual(blocks, ['await read("a.txt")']);
});

test('智谱：语言未知 + 普通代码（非工具调用）→ 不提取', () => {
  global.window = { location: { href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh' } };
  const root = makeFakeRoot({
    textOnly: '',
    codeText: 'console.log(1)',
    langAttr: null,
    hasPre: false,
  });
  const blocks = getJsCodeBlocksFromMarkdown(root);
  assert.deepStrictEqual(blocks, []);
});

test('智谱：语言未知 + MCP 工具调用（mcp 前缀）→ 提取', () => {
  global.window = { location: { href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh' } };
  const root = makeFakeRoot({
    textOnly: '',
    codeText: 'log(await mcpListServers());',
    langAttr: null,
    hasPre: true,
  });
  const blocks = getJsCodeBlocksFromMarkdown(root);
  assert.strictEqual(blocks.length, 1, 'MCP 前缀工具调用应被提取');
});

test('智谱：语言未知 + log 包裹 await 调用 → 提取', () => {
  global.window = { location: { href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh' } };
  const root = makeFakeRoot({
    textOnly: '',
    codeText: 'log(await mcpGetTools("godot-ai"));',
    langAttr: null,
    hasPre: true,
  });
  const blocks = getJsCodeBlocksFromMarkdown(root);
  assert.strictEqual(blocks.length, 1, 'log 包裹的 await 工具调用应被提取');
});

test('js 语言 + 带文字说明 → 不提取（保持原收紧行为）', () => {
  global.window = { location: { href: 'https://chat.deepseek.com/' } };
  const root = makeFakeRoot({
    textOnly: '说明文字',
    codeText: 'await bash("echo hi")',
    langAttr: 'js',
    hasPre: true,
  });
  const blocks = getJsCodeBlocksFromMarkdown(root);
  assert.deepStrictEqual(blocks, []);
});

test('extractSubagentResultBlocks 提取 subagent_result 块', () => {
  const text = FENCE + 'subagent_result\n任务完成\n修改文件：a.js\n' + FENCE;
  const blocks = extractSubagentResultBlocks(text);
  assert.deepStrictEqual(blocks, ['任务完成\n修改文件：a.js']);
});

test('extractSubagentResultBlocks 忽略其他语言', () => {
  const text = FENCE + 'cuckoo\nawait read("a")\n' + FENCE + '\n' + FENCE + 'subagent_result\n交付\n' + FENCE;
  const blocks = extractSubagentResultBlocks(text);
  assert.deepStrictEqual(blocks, ['交付']);
});

test('extractSubagentResultBlocks 空输入', () => {
  assert.deepStrictEqual(extractSubagentResultBlocks(''), []);
  assert.deepStrictEqual(extractSubagentResultBlocks(null), []);
});

test('isGenerationInterrupted 过短判中断', () => {
  assert.strictEqual(isGenerationInterrupted(''), 'too_short');
  assert.strictEqual(isGenerationInterrupted('hi'), 'too_short');
  assert.strictEqual(isGenerationInterrupted('   '), 'too_short');
});

test('isGenerationInterrupted 服务器繁忙判中断', () => {
  assert.strictEqual(isGenerationInterrupted('服务器繁忙，请稍后再试'), 'server_busy'); // 11 字，命中关键词
  assert.strictEqual(isGenerationInterrupted('很抱歉，当前服务器繁忙，请稍后再试。'), 'server_busy');
  assert.strictEqual(isGenerationInterrupted('服务繁忙，请稍后重试一下'), 'server_busy');
});

test('isGenerationInterrupted 正常回复返回 null', () => {
  assert.strictEqual(isGenerationInterrupted('这是一段足够长的正常回复内容，超过了十个字符。'), null);
});

test('isGenerationInterrupted 长文本含繁忙词不误判', () => {
  // 长度 > 200 时，即使含"服务器繁忙"也是正常讨论，不判中断
  const longText = '服务器繁忙'.repeat(50); // 250 字符
  assert.strictEqual(isGenerationInterrupted(longText), null);
});

test('looksIncompleteSubagentResult 空内容判不完整', () => {
  assert.strictEqual(looksIncompleteSubagentResult(''), true);
  assert.strictEqual(looksIncompleteSubagentResult('   '), true);
  assert.strictEqual(looksIncompleteSubagentResult(null), true);
});

test('looksIncompleteSubagentResult 以标题结尾判不完整', () => {
  // 复现真机截断：标题后无正文
  assert.strictEqual(looksIncompleteSubagentResult('## 任务执行结果\n\n### 1. 当前工作目录'), true);
  assert.strictEqual(looksIncompleteSubagentResult('# 报告'), true);
});

test('looksIncompleteSubagentResult 有正文判完整', () => {
  assert.strictEqual(looksIncompleteSubagentResult('# 报告\n\n这是正文内容。'), false);
  assert.strictEqual(looksIncompleteSubagentResult('完成任务，修改了 a.js 文件。'), false);
});

test('getSubagentResultBlocksFromMarkdown 从 DOM 提取', () => {
  global.window = { location: { href: 'https://chat.deepseek.com/' } };
  const root = {
    tagName: 'DIV',
    querySelectorAll: (sel) => {
      if (sel === 'pre') return [{
        tagName: 'PRE',
        getAttribute: () => 'subagent_result',
        closest: () => null,
        querySelector: () => ({ textContent: '交付内容' }),
        textContent: '交付内容',
      }];
      return [];
    },
  };
  const blocks = getSubagentResultBlocksFromMarkdown(root);
  assert.deepStrictEqual(blocks, ['交付内容']);
});

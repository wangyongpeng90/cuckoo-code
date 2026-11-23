/**
 * Cuko 运行协议测试（主进程运行循环依赖的纯函数）
 * 覆盖：SSE 分帧、cuckoo 代码块提取、工具名提取、提示词分段、错误翻译
 */
import { describe, it, expect } from 'vitest';
import {
  createSseDecoder,
  extractCuckooBlocks,
  extractToolNames,
  friendlyError,
  isCuckooLang,
  parseFenceLang,
  splitPromptByH1,
} from '../src/app/cuko-run-protocol.js';

const collect = () => {
  const events = [];
  const decoder = createSseDecoder((event, data) => events.push({ event, data }));
  return { events, decoder };
};

describe('createSseDecoder', () => {
  it('按空行分帧，data 多行拼接', () => {
    const { events, decoder } = collect();
    decoder.push('event: message\ndata: {"a":1}\n\n');
    decoder.push('event: done\ndata: line1\ndata: line2\n\n');
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'done', data: 'line1\nline2' },
    ]);
  });

  it('跨 chunk 边界也能拼完整', () => {
    const { events, decoder } = collect();
    decoder.push('event: mess');
    decoder.push('age\ndata: hel');
    decoder.push('lo\n');
    decoder.push('\n');
    expect(events).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('兼容 CRLF，默认事件名是 message', () => {
    const { events, decoder } = collect();
    decoder.push('data: x\r\n\r\n');
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
  });
});

describe('extractCuckooBlocks', () => {
  it('只取 cuckoo 语言块', () => {
    const text = [
      '先看：',
      '```cuckoo',
      'await write({ filePath: "a.txt" });',
      '```',
      '再看：',
      '```js',
      'console.log(1);',
      '```',
      '```cuckoo',
      'return 1;',
      '```',
    ].join('\n');
    expect(extractCuckooBlocks(text)).toEqual([
      'await write({ filePath: "a.txt" });',
      'return 1;',
    ]);
  });

  it('未闭合的块不返回', () => {
    expect(extractCuckooBlocks('```cuckoo\nreturn 1;')).toEqual([]);
  });

  // 实测：模型把围栏写成 ```cuckoo id="58216"（带属性）时整行 lowercase 成
  // "cuckoo id=\"58216\""，旧实现按整行比较语言标记，块被整条丢弃、工具不执行。
  it('围栏带属性（cuckoo id="58216"）也要认', () => {
    const text = ['```cuckoo id="58216"', 'log("hi");', 'return 1;', '```'].join('\n');
    expect(extractCuckooBlocks(text)).toEqual(['log("hi");\nreturn 1;']);
  });

  it('围栏带大小写 / 连字符变体也要认', () => {
    expect(extractCuckooBlocks(['```CUCKOO', 'return 1;', '```'].join('\n'))).toEqual(['return 1;']);
    expect(extractCuckooBlocks(['```cuckoo-js', 'return 1;', '```'].join('\n'))).toEqual(['return 1;']);
    expect(extractCuckooBlocks(['```cuckoo_js', 'return 1;', '```'].join('\n'))).toEqual(['return 1;']);
  });

  it('CRLF 回复也能提取（去掉行尾 \\r）', () => {
    const text = ['```cuckoo id="1"', 'return 1;', '```'].join('\r\n');
    expect(extractCuckooBlocks(text)).toEqual(['return 1;']);
  });

  it('非 cuckoo 语言（含 cuckoo 前缀的假语言）不误判', () => {
    expect(extractCuckooBlocks(['```json', '{"a":1}', '```'].join('\n'))).toEqual([]);
    expect(extractCuckooBlocks(['```cuckooish', 'return 1;', '```'].join('\n'))).toEqual([]);
  });
});

describe('parseFenceLang / isCuckooLang', () => {
  it('只取围栏后第一个 token', () => {
    expect(parseFenceLang('```cuckoo id="1"')).toBe('cuckoo');
    expect(parseFenceLang('```Cuckoo,js')).toBe('cuckoo');
    expect(parseFenceLang('```')).toBe('');
    expect(parseFenceLang('```js')).toBe('js');
  });

  it('识别 cuckoo 家族语言', () => {
    expect(isCuckooLang('cuckoo')).toBe(true);
    expect(isCuckooLang('cuckoo-js')).toBe(true);
    expect(isCuckooLang('cuckooish')).toBe(false);
    expect(isCuckooLang('')).toBe(false);
  });
});

describe('extractToolNames', () => {
  it('去重并保持出现顺序', () => {
    const code = 'await read({ filePath: "a" });\nawait write({});\nawait read({ filePath: "b" });';
    expect(extractToolNames(code)).toEqual(['read', 'write']);
  });

  it('普通函数调用不算', () => {
    expect(extractToolNames('const x = foo(1); await bar(2);')).toEqual(['bar']);
  });
});

describe('splitPromptByH1', () => {
  it('按一级标题分段，保留段首标题', () => {
    const prompt = '# A\naaa\n# B\nbbb\nccc';
    expect(splitPromptByH1(prompt)).toEqual(['# A\naaa', '# B\nbbb\nccc']);
  });

  it('空串返回空数组', () => {
    expect(splitPromptByH1('')).toEqual([]);
  });
});

describe('friendlyError', () => {
  it('已知错误码翻译并附加原文', () => {
    expect(friendlyError('rate_limit_exceeded', 'slow down')).toContain('请求过于频繁');
    expect(friendlyError('rate_limit_exceeded', 'slow down')).toContain('slow down');
  });

  it('未知错误码保留原文', () => {
    expect(friendlyError('weird', 'boom')).toBe('boom');
  });
});

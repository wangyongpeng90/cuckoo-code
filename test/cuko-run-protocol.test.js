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

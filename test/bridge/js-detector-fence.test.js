import { describe, it, expect } from 'vitest';
import { extractJsToolBlocks } from '../../src/bridge/parser/js-detector.js';

const NL = String.fromCharCode(10);
const fence = (lang, code) => ['```' + lang, code, '```'].join(NL);

describe('extractJsToolBlocks 围栏语言解析', () => {
  it('带属性的围栏也能识别（cuckoo id="58216"）', () => {
    expect(extractJsToolBlocks(fence('cuckoo id="58216"', 'await bash("echo hi");'))).toEqual(['await bash("echo hi");']);
  });

  it('tab / 逗号分隔也能识别', () => {
    expect(extractJsToolBlocks(fence('cuckoo' + String.fromCharCode(9) + 'js', 'await bash("echo hi");'))).toEqual(['await bash("echo hi");']);
    expect(extractJsToolBlocks(fence('cuckoo,js', 'await bash("echo hi");'))).toEqual(['await bash("echo hi");']);
  });

  it('cuckoo-js / CUCKOO 变体', () => {
    expect(extractJsToolBlocks(fence('cuckoo-js', 'await bash("echo hi");'))).toEqual(['await bash("echo hi");']);
    expect(extractJsToolBlocks(fence('CUCKOO', 'await bash("echo hi");'))).toEqual(['await bash("echo hi");']);
  });

  it('围栏挤在正文末尾（行内出现）也要认', () => {
    const sample = ['结论如下。', '确保不破坏现有流程。' + '```' + 'cuckoo id="c8v5mt"', 'await bash("echo hi");', '```'].join(NL);
    expect(extractJsToolBlocks(sample)).toEqual(['await bash("echo hi");']);
  });

  it('闭围栏后面跟正文也要认', () => {
    expect(extractJsToolBlocks('```cuckoo' + NL + 'await bash("x");' + NL + '``` 后面' + NL)).toEqual(['await bash("x");']);
  });

  it('json 块不误判', () => {
    expect(extractJsToolBlocks(fence('json', '{"a":1}'))).toEqual([]);
  });
});

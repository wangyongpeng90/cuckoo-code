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

  it('json 块不误判', () => {
    expect(extractJsToolBlocks(fence('json', '{"a":1}'))).toEqual([]);
  });
});

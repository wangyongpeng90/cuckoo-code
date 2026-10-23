'use strict';
import { test, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert';
import Module from 'node:module';

// sections.ts 经 mcp/client 间接依赖 electron（app.getAppPath）。与 prompt-builder.test.js
// 一致：只 mock 这个外部运行时边界，不 mock 内部模块。
const origLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'electron') {
    return {
      app: {
        getAppPath: () => process.cwd(),
        getPath: () => process.cwd(),
        isPackaged: false,
      },
    };
  }
  return origLoad.apply(this, arguments);
};

let sections;
beforeAll(async () => {
  sections = await import('../../src/session/prompt/sections.js');
});

afterAll(() => {
  Module._load = origLoad;
});

test('buildPlatformInfo 含操作系统与路径分隔符说明', () => {
  const s = sections.buildPlatformInfo();
  assert.ok(s.includes('操作系统'));
  assert.ok(s.includes('路径分隔符'));
});

test('applyPlaceholders 替换全部占位符（单遍 split/join）', () => {
  const tpl = 'A={{X}} B={{Y}} C={{X}}';
  const out = sections.applyPlaceholders(tpl, { '{{X}}': '1', '{{Y}}': '2' });
  assert.strictEqual(out, 'A=1 B=2 C=1');
});

test('applyPlaceholders 值含 $ 不被特殊解释', () => {
  const out = sections.applyPlaceholders('v={{V}}', { '{{V}}': "$& $1 $$" });
  assert.strictEqual(out, 'v=$& $1 $$');
});

test('applyPlaceholders 未匹配占位符原样保留', () => {
  const out = sections.applyPlaceholders('a={{X}} b={{Z}}', { '{{X}}': '1' });
  assert.strictEqual(out, 'a=1 b={{Z}}');
});

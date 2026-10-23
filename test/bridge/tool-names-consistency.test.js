'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { TOOL_NAMES } from '../../src/bridge/generated/tool-names.generated.js';
import { registry } from '../../src/tools/index.js';

/**
 * 护栏：生成的工具名清单必须与工具注册表完全一致。
 * 若新增/删除工具后忘记重新编译（生成 tool-names.generated.ts），此测试会失败，
 * 从而避免 bridge/parser/js-detector.ts 的检测正则与真实工具集漂移。
 */
test('TOOL_NAMES 与注册表工具名集合一致', () => {
  const registered = registry.listNames().slice().sort();
  const generated = Array.from(TOOL_NAMES).slice().sort();
  assert.deepStrictEqual(generated, registered,
    '生成的 TOOL_NAMES 与注册表不一致，请运行 npm run compile 重新生成');
});

test('TOOL_NAMES 无重复', () => {
  assert.strictEqual(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
});

test('detector 正则能识别每个工具名的 await 调用', async () => {
  const { looksLikeToolScript } = await import('../../src/bridge/parser/js-detector.js');
  for (const name of TOOL_NAMES) {
    assert.strictEqual(looksLikeToolScript('await ' + name + '()'), true,
      'looksLikeToolScript 未能识别 await ' + name + '()');
  }
});

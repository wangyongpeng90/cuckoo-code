// @vitest-environment happy-dom
'use strict';
/**
 * 杂项覆盖测试。
 * Task 8：project-dir / session-list 相关用例随源码删除（功能已迁往 shell 面板，
 * 由 test/ui/panels-*.test.js 覆盖）；保留 chat-input 的 randomDelay 用例。
 */
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';

import { setupDom } from '../helpers/dom';

let ctx;

beforeEach(() => {
  ctx = setupDom('');
});

afterEach(() => {
  ctx.cleanup();
  delete window.electronAPI;
});

test('randomDelay 返回 2000-3999ms', async () => {
  const { randomDelay } = await import('../../src/overlay/chat-input.js');
  for (let i = 0; i < 10; i++) {
    const d = randomDelay();
    assert.ok(d >= 2000 && d <= 3999);
  }
});

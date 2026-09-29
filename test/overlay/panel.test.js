'use strict';
import { test } from 'vitest';
import assert from 'node:assert';

// Task 8 之后 panel.ts 只剩瞬态 UI：注入（CSS/HTML）、toast、工具遮罩。
// 面板/历史/首页模式/确认弹窗等已迁往 shell 或删除，对应断言一并移除。

const mkEl = () => ({
  textContent: '',
  innerHTML: '',
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
});
global.document = {
  createElement: () => mkEl(),
  getElementById: () => null,
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
};
global.requestAnimationFrame = (fn) => fn();
global.setTimeout = (_fn, _ms) => 0;
global.clearTimeout = () => {};

const ui = await import('../../src/overlay/panel.js');

test('injectCSS/injectOverlay 不抛错', () => {
  assert.doesNotThrow(() => ui.injectCSS());
  assert.doesNotThrow(() => ui.injectOverlay());
});

test('showToast 不抛错', () => {
  assert.doesNotThrow(() => ui.showToast('test'));
});

test('showToolMask/hideToolMask 不抛错（含取消回调形态）', () => {
  assert.doesNotThrow(() => ui.showToolMask());
  assert.doesNotThrow(() => ui.showToolMask(() => {}));
  assert.doesNotThrow(() => ui.hideToolMask());
});

test('已删除的面板 API 不再导出', () => {
  const removed = [
    'showConfirmDialog', 'setTaskStatus', 'showOverlay', 'hideOverlay',
    'displayCommand', 'displayResult', 'handleExecute', 'handleIgnore',
    'addHistory', 'renderHistory', 'commandHistory', 'flashBadge',
    'updateHomeMode', 'setSuppressHomeMode', 'forceShowOverlay',
    'startOverlayWatcher', 'showFirstTimeDialog', 'hideFirstTimeDialog',
    'generateId', 'formatTime', 'truncate',
  ];
  for (const name of removed) {
    assert.strictEqual(ui[name], undefined, 'panel.js 不应再导出 ' + name);
  }
});

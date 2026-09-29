'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { OVERLAY_HTML, OVERLAY_CSS } from '../../src/overlay/template.generated.js';

// Task 8 契约：overlay 注入页只剩瞬态元素（工具遮罩 + 动态创建的 toast / retry-countdown）

test('OVERLAY_HTML 包含工具调用遮罩及提示文案', () => {
  assert.ok(OVERLAY_HTML.includes('id="cuckoo-tool-mask"'));
  assert.ok(OVERLAY_HTML.includes('id="cuckoo-tool-mask-cancel"'));
  assert.ok(OVERLAY_HTML.includes('正在执行工具调用，请稍候…'));
});

test('OVERLAY_HTML 不再包含已迁往 shell 的面板/弹窗/悬浮球元素', () => {
  const removed = [
    'cuckoo-overlay',
    'cuckoo-status-badge',
    'cuckoo-session-list',
    'cuckoo-window-manager',
    'cuckoo-mcp-manager',
    'cuckoo-settings',
    'cuckoo-first-time-dialog',
    'cuckoo-conv-token-count',
    'cuckoo-cmd-preview',
    'cuckoo-history-list',
    'cuckoo-btn-init',
    'cuckoo-btn-immersive',
    'cuckoo-btn-manual-parse',
  ];
  for (const id of removed) {
    assert.ok(!OVERLAY_HTML.includes(id), 'OVERLAY_HTML 不应再包含 ' + id);
  }
});

test('OVERLAY_CSS 包含遮罩 / toast / retry-countdown 样式', () => {
  assert.ok(OVERLAY_CSS.includes('.cuckoo-tool-mask'));
  assert.ok(OVERLAY_CSS.includes('.cuckoo-tool-mask-spinner'));
  assert.ok(OVERLAY_CSS.includes('.cuckoo-toast'));
  assert.ok(OVERLAY_CSS.includes('.cuckoo-retry-countdown'));
  assert.ok(OVERLAY_CSS.includes('cuckoo-hidden'));
});

test('OVERLAY_CSS 不再包含已删除面板的样式', () => {
  const removed = ['.cuckoo-overlay', '.cuckoo-window-manager', '.cuckoo-first-time-dialog', '#cuckoo-status-badge', '.cuckoo-confirm-dialog'];
  for (const sel of removed) {
    assert.ok(!OVERLAY_CSS.includes(sel), 'OVERLAY_CSS 不应再包含 ' + sel);
  }
});

test('OVERLAY_HTML 不包含内联样式', () => {
  assert.ok(!OVERLAY_HTML.includes('style="'), 'OVERLAY_HTML 中不应存在 style=" 内联样式');
});

test('OVERLAY_HTML 所有 class 值均带 cuckoo- 前缀（防宿主样式污染）', () => {
  const classAttrs = OVERLAY_HTML.match(/class="([^"]*)"/g) || [];
  assert.ok(classAttrs.length > 0, 'OVERLAY_HTML 中应存在 class 属性');
  for (const attr of classAttrs) {
    const value = attr.slice('class="'.length, -1);
    const names = value.split(/\s+/).filter(Boolean);
    assert.ok(names.length > 0, 'class 属性不应为空');
    for (const name of names) {
      assert.ok(name.startsWith('cuckoo-'), `class 值 "${name}" 缺少 cuckoo- 前缀`);
    }
  }
});

test('OVERLAY_HTML 不含 🔄 等 emoji 装饰', () => {
  assert.ok(!OVERLAY_HTML.includes('🔄'), 'OVERLAY_HTML 中不应存在 🔄 emoji');
});

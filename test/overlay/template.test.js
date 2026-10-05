'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { OVERLAY_HTML, OVERLAY_CSS } from '../../src/overlay/template.generated.js';

// 注：旧侧边面板 / 窗口管理 / MCP / 设置弹窗 / 悬浮球 已移除（迁移到壳窗口侧边栏）。
// 注入页面只剩：工具遮罩 + 首次对话引导框。
test('OVERLAY_HTML 只保留工具遮罩 + 首次引导框', () => {
  // 保留的
  assert.ok(OVERLAY_HTML.includes('id="cuckoo-tool-mask"'));
  assert.ok(OVERLAY_HTML.includes('id="cuckoo-first-time-dialog"'));
  assert.ok(OVERLAY_HTML.includes('cuckoo-btn-first-init'));
  // 已移除的旧 UI 不应再出现
  assert.ok(!OVERLAY_HTML.includes('cuckoo-overlay'));
  assert.ok(!OVERLAY_HTML.includes('cuckoo-status-badge'));
  assert.ok(!OVERLAY_HTML.includes('cuckoo-session-list'));
});

test('OVERLAY_HTML 包含工具调用遮罩及提示文案', () => {
  assert.ok(OVERLAY_HTML.includes('id="cuckoo-tool-mask"'));
  assert.ok(OVERLAY_HTML.includes('工具执行中'));
});

test('OVERLAY_CSS 包含核心样式', () => {
  assert.ok(OVERLAY_CSS.includes('--ck-primary'));
  assert.ok(OVERLAY_CSS.includes('cuckoo-hidden'));
});

test('OVERLAY_CSS 包含工具调用遮罩样式', () => {
  assert.ok(OVERLAY_CSS.includes('.cuckoo-tool-mask'));
  assert.ok(OVERLAY_CSS.includes('.cuckoo-tool-mask-spinner'));
});

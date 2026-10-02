'use strict';
/**
 * harness 页面（src/ui/harness.html）内联脚本守卫测试。
 *
 * 背景：这个文件是内联 JS，没有模块边界，改错只能靠真机跑出来 ——
 * 运行态状态机已被改坏过两次（先"网页在跑、界面却停了"，后"网页答完、界面还在跑"）。
 * 这里钉住三条底线：
 *   1) 内联脚本语法可解析（防手改引入语法错误）
 *   2) 权威终态信号 task-idle 必须接住（收尾不靠超时猜）
 *   3) 静默兜底必须有界（不允许出现数分钟级的"卡在运行态"）
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HTML_PATH = path.join(import.meta.dirname, '..', '..', 'src', 'ui', 'harness.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

/** 取出内联 <script> 正文（harness.html 只有一个内联脚本） */
function inlineScript() {
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  assert.ok(start >= 0 && end > start, 'harness.html 应含内联 <script>');
  return html.slice(start + '<script>'.length, end);
}

const script = inlineScript();

test('内联脚本语法可解析', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'harness-inline.js' }));
});

test('接住权威终态信号 task-idle（网页执行完就收尾）', () => {
  assert.ok(script.includes("case 'task-idle'"), '事件分发应处理 task-idle');
  assert.ok(/function onTaskIdle\s*\(/.test(script), '应有 onTaskIdle 处理函数');
  // 收尾必须落到"就绪"，否则网页答完界面仍显示运行中
  const fn = script.slice(script.indexOf('function onTaskIdle'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(body.includes("setStatus('就绪', 'ready')"), 'task-idle 应收尾为就绪');
});

test('框架侧投递有运行态反馈（framework-send）', () => {
  assert.ok(script.includes("case 'framework-send'"), '事件分发应处理 framework-send');
  assert.ok(/function onFrameworkSend\s*\(/.test(script), '应有 onFrameworkSend 处理函数');
});

test('接住权威生成状态心跳 ai-state（解套"卡在运行中"）', () => {
  assert.ok(script.includes("case 'ai-state'"), '事件分发应处理 ai-state');
  assert.ok(/function onAiState\s*\(/.test(script), '应有 onAiState 处理函数');
  const idx = script.indexOf('function onAiState');
  const body = script.slice(idx, idx + 900);
  // 权威判定"已停止"时必须清零工具计数（防 tool-end 丢失导致永久卡住）
  assert.ok(body.includes('toolRunningCount = 0'), 'ai-state 收尾时应清零工具计数');
  assert.ok(body.includes("setStatus('就绪', 'ready')"), 'ai-state 收尾时应复位为就绪');
  // 静默期保护：刚投递消息的窗口内不能据"未生成"收尾，否则会退回"网页在跑界面却停了"
  assert.ok(/AI_STATE_QUIET_MS/.test(script), '应有静默期保护常量');
});

test('静默兜底有界：不允许数分钟级卡在运行态', () => {
  const m = script.match(/var limit = Date\.now\(\) < frameworkDriveUntil \? (\d+) : (\d+);/);
  assert.ok(m, '应能找到静默兜底的容忍上限');
  const inWindow = Number(m[1]);
  const outWindow = Number(m[2]);
  assert.ok(inWindow > outWindow, '框架驱动窗口内的容忍度应更宽');
  assert.ok(inWindow <= 180000, '框架驱动窗口上限不应超过 3 分钟（实测: ' + inWindow + '）');
  assert.ok(outWindow <= 60000, '常规静默上限不应超过 1 分钟（实测: ' + outWindow + '）');
});

test('兜底超时后必须重置为就绪（不能只换文案）', () => {
  const idx = script.indexOf('var limit = Date.now() < frameworkDriveUntil');
  assert.ok(idx > 0, '应能找到兜底判定');
  const tail = script.slice(idx, idx + 400);
  assert.ok(tail.includes("setStatus('就绪', 'ready')"), '超时后应重置为就绪');
});

test('工具计数泄漏有自愈兜底（tool-end 丢失不会永久卡住）', () => {
  const idx = script.indexOf('if (toolRunningCount > 0) {');
  assert.ok(idx > 0, '应有工具计数泄漏兜底');
  const tail = script.slice(idx, idx + 400);
  assert.ok(tail.includes('toolRunningCount = 0'), '超过上限应清零工具计数');
  assert.ok(tail.includes("setStatus('就绪', 'ready')"), '超过上限应复位为就绪');
});

test('goal 收束仍走 goalDone 工具事件（回归保护）', () => {
  assert.ok(script.includes("case 'goal-done'"), '事件分发应处理 goal-done');
  assert.ok(!script.includes('[[GOAL_DONE]]'), '不应回退到文本标记方案');
});

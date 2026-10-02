'use strict';
/**
 * harness-bridge 上报行为测试
 *
 * 回归背景（两次真实故障）：
 *  1. AI 页面每次导航/重载都会重建 preload，靠"切换时下发一次"的门控会永久失配 →
 *     所有上报被静默丢弃 → 界面空白 + 状态卡死。故**上报不再设门控**，一律放行
 *     （主进程在没有 harness 视图时本就会丢弃）。这里钉住"没有门控也不会哑"。
 *  2. harness 曾只能靠超时猜"是否结束"，出现"网页答完、界面还在跑"。
 *     现在由 ai-state（AI 页面生成状态心跳）作为权威校正信号，必须如实上报。
 */
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

/** 共享状态容器：vi.mock 工厂被提升到顶部，用对象属性保证闭包拿到同一容器 */
const S = {
  reported: [],
  invoked: [],
  userMsgListener: null,
  stopListener: null,
  intervals: [],
};

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRequire: () => () => ({
      ipcRenderer: {
        on: (ch, fn) => {
          if (ch === 'harness-user-message') S.userMsgListener = fn;
          if (ch === 'harness-stop-signal') S.stopListener = fn;
        },
        invoke: (ch, payload) => {
          S.invoked.push(ch);
          if (ch === 'harness-event-report') { S.reported.push(payload); return Promise.resolve({ success: true }); }
          return Promise.resolve({});
        },
      },
    }),
  };
});

// observer 与 chat-input 是外部边界：只关心 bridge 是否按要求上报
const CB = { response: null, stream: null, tool: null, delivered: null, taskIdle: null, aiError: null };
vi.mock('../../src/bridge/intercept/observer.js', () => ({
  onInterceptedResponse: (cb) => { CB.response = cb; return () => {}; },
  onStream: (cb) => { CB.stream = cb; return () => {}; },
  onToolCall: (cb) => { CB.tool = cb; return () => {}; },
  onTaskIdle: (cb) => { CB.taskIdle = cb; return () => {}; },
  onAiError: (cb) => { CB.aiError = cb; return () => {}; },
  requestAbort: () => {},
  clearAbort: () => {},
}));

vi.mock('../../src/overlay/chat-input.js', () => ({
  sendToChat: () => Promise.resolve(true),
  cancelPendingSend: () => {},
  onMessageDelivered: (cb) => { CB.delivered = cb; return () => {}; },
}));

/** 便捷触发 */
function responseCb(t) { return CB.response(t); }
function streamCb(ev) { return CB.stream(ev); }
function toolCb(ev) { return CB.tool(ev); }
function deliveredCb(info) { return CB.delivered(info); }
function taskIdleCb() { return CB.taskIdle(); }
function types() { return S.reported.map((p) => p.type); }
function lastAiState() {
  const list = S.reported.filter((p) => p.type === 'ai-state');
  return list.length ? list[list.length - 1].generating : null;
}

beforeEach(async () => {
  vi.resetModules();
  S.reported = [];
  S.invoked = [];
  S.userMsgListener = null;
  S.stopListener = null;
  S.intervals = [];
  CB.response = null;
  CB.stream = null;
  CB.tool = null;
  CB.delivered = null;
  CB.taskIdle = null;
  CB.aiError = null;
  globalThis.window = {};
  globalThis.document = { addEventListener: () => {} };
  // 捕获心跳定时器（不真跑），用于断言周期上报
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { S.intervals.push({ fn, ms }); return 0; };
  try {
    const mod = await import('../../../src/bridge/harness-bridge.js');
    mod.initHarnessBridge();
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});

// ===== 无门控：不再有"静默丢弃"整类故障 =====

test('未收到任何门控广播也照常上报（杜绝哑界面）', async () => {
  responseCb('回复内容');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(types().includes('assistant-done'), '应上报 assistant-done，实际: ' + types().join(','));
});

test('流式事件照常上报', async () => {
  streamCb({ think: '', text: '正在输出', finished: false });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(types().includes('stream'), '应上报 stream');
});

test('工具事件照常上报', async () => {
  toolCb({ phase: 'start', code: 'await read("a")' });
  toolCb({ phase: 'end', code: 'await read("a")', success: true, output: 'ok' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(types().includes('tool-start'));
  assert.ok(types().includes('tool-end'));
});

test('任务空闲照常上报 task-idle', async () => {
  taskIdleCb();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(types().includes('task-idle'));
});

test('框架投递上报 framework-send，harness 自身消息不报', async () => {
  deliveredCb({ text: '【系统提示词】...', tag: '系统提示词', isSystem: true });
  deliveredCb({ text: '你好', tag: 'harness', isSystem: false });
  await new Promise((r) => setTimeout(r, 0));
  const fw = S.reported.filter((p) => p.type === 'framework-send');
  assert.strictEqual(fw.length, 1, '只应上报框架侧那一条');
  assert.strictEqual(fw[0].tag, '系统提示词');
});

// ===== ai-state：权威生成状态 =====

test('心跳定时器已注册（周期上报，harness 中途创建也能拿到状态）', () => {
  const hb = S.intervals.find((x) => x.ms === 2000);
  assert.ok(hb, '应注册 2 秒心跳');
});

test('心跳会周期性上报当前状态', async () => {
  const hb = S.intervals.find((x) => x.ms === 2000);
  S.reported.length = 0;
  hb.fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(types().includes('ai-state'), '心跳应上报 ai-state');
});

test('流式输出 → ai-state 置为生成中', async () => {
  streamCb({ think: '', text: '输出中', finished: false });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), true);
});

test('无工具调用的回复完成 → ai-state 置为已停止', async () => {
  streamCb({ think: '', text: '输出中', finished: false });
  responseCb('最终回复（无工具调用）');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), false, '无工具调用说明本轮结束');
});

test('含工具调用的回复不算结束（后面还有工具循环）', async () => {
  streamCb({ think: '', text: '输出中', finished: false });
  responseCb('看代码：\n```cuckoo\nawait read("a.js")\n```\n');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), true, '含工具调用时不能判为已停止');
});

test('task-idle → ai-state 置为已停止', async () => {
  streamCb({ think: '', text: '输出中', finished: false });
  taskIdleCb();
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), false);
});

test('投递消息 → ai-state 置为生成中（AI 即将工作）', async () => {
  deliveredCb({ text: 'x', tag: '系统提示词', isSystem: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), true);
});

test('AI 请求失败 → ai-state 置为已停止', async () => {
  streamCb({ think: '', text: '输出中', finished: false });
  CB.aiError({ status: 500 });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), false);
});

test('状态未变化时不重复上报（避免刷屏）', async () => {
  streamCb({ think: '', text: 'a', finished: false });
  await new Promise((r) => setTimeout(r, 0));
  S.reported.length = 0;
  streamCb({ think: '', text: 'ab', finished: false });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(types().filter((t) => t === 'ai-state').length, 0, '状态未变不应重复上报');
});

test('收到停止信号 → ai-state 置为已停止', async () => {
  streamCb({ think: '', text: '输出中', finished: false });
  S.stopListener();
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(lastAiState(), false);
});

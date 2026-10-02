/**
 * 纯净对话模式（Harness）的 bridge 侧逻辑
 *
 * 运行在 AI 页面（preload）。职责：
 *   1. 订阅 AI 回复（onInterceptedResponse）→ 上报主进程 → harness 页面显示
 *   2. 订阅工具调用事件（onToolCall）→ 上报工具开始/结束
 *   3. 监听主进程转发的 'harness-user-message' → 调 sendToChat 发到 AI
 *   4. 目标模式：goalDone 工具（主进程）直接向 harness 视图推送 goal-done，无需在此识别文本标记
 *   5. 生成状态心跳（ai-state）：周期上报"AI 页面是否正在生成"，供 harness 校正运行态
 *
 * 与官方解耦：仅在 bridge/entry.ts 中 import 激活；其余为独立文件。
 *
 * 【为什么不做上报门控】
 * 这里曾用主进程下发的 'harness-mode' 开关做门控（"关闭时零开销"）。但它有个致命性质：
 * 只要判断错一次（AI 页面导航/重载重建 preload 会丢广播；查询通道本身也可能失败），
 * 所有上报被静默丢弃 —— 界面表现是"对话流空白 + 状态永久卡在运行中"，
 * 而且因为丢弃是静默的，排查成本极高（实测踩过两次）。
 * 现在一律上报：主进程在没有 harness 视图时本就会丢弃，多出的开销只是几次 IPC，
 * 换掉一整类"哑界面"故障是划算的。
 */
import { createRequire } from 'node:module';
import {
  onInterceptedResponse, onToolCall, onStream, onTaskIdle, onAiError,
  requestAbort, clearAbort,
} from './intercept/observer.js';
import { sendToChat, cancelPendingSend, onMessageDelivered } from '../overlay/chat-input.js';

const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

/** 移除文本中的 cuckoo / js 工具代码块（工具调用改由卡片展示） */
function stripToolBlocks(text: string): string {
  if (!text) return '';
  let out = text;
  out = out.replace(/```(?:cuckoo|javascript|js)\s*\n[\s\S]*?```/gi, '');
  // 流式输出中途：代码块尚未闭合 → 从开标记起全部隐藏，避免 ```cuckoo 内容闪现
  out = out.replace(/```(?:cuckoo|javascript|js)\s*\n[\s\S]*$/gi, '');
  out = out.replace(/```(?:cuckoo|javascript|js)\s*$/gi, '');
  return out.trim();
}

/** 回复里是否含工具调用代码块（有则说明后面还有工具循环，本轮不算结束） */
const HAS_TOOL_BLOCK_RE = /```(?:cuckoo|javascript|js)\s*\n/i;

function report(payload: any): void {
  try {
    ipcRenderer.invoke('harness-event-report', payload).catch(() => {});
  } catch (_) { /* ignore */ }
}

/** 初始化 harness bridge（幂等） */
let inited = false;
export function initHarnessBridge(): void {
  if (inited) return;
  inited = true;

  // ===== AI 页面生成状态（权威信号）=====
  // 由 hook 事件驱动，是"网页到底还在不在干活"的唯一可靠来源。
  // 变化即时上报 + 每 2 秒心跳（harness 页面可能在生成中途才被创建/刷新，
  // 只报变化的话它会拿不到当前状态）。
  let aiGenerating = false;
  function setAiGenerating(next: boolean): void {
    if (aiGenerating === next) return;
    aiGenerating = next;
    report({ type: 'ai-state', generating: next });
  }
  try {
    setInterval(() => report({ type: 'ai-state', generating: aiGenerating }), 2000);
  } catch (_) { /* ignore */ }

  // 流式增量 → 上报
  onStream((ev: any) => {
    if (!ev) return;
    // 有实际输出 = 正在生成（finished 帧只是收尾快照，不算新一轮）
    if (!ev.finished && (ev.text || ev.think)) setAiGenerating(true);
    const t = stripToolBlocks(ev.text || '');
    report({ type: 'stream', think: ev.think || '', text: t, finished: !!ev.finished });
  });

  // AI 回复完成 → 上报（目标收束由 goalDone 工具在主进程直接推送，这里不再检测文本标记）
  onInterceptedResponse((text: string) => {
    const raw = text || '';
    // 回复里没有工具调用 → 本轮真的结束（有工具调用时后面还有工具循环）
    if (!HAS_TOOL_BLOCK_RE.test(raw)) setAiGenerating(false);
    report({ type: 'assistant-done', text: stripToolBlocks(raw).trim() });
  });

  // 任务空闲（observer 判定：回复里没有工具调用 = 本轮任务真的结束）→ 上报。
  // 这是"网页执行完了"的权威终态信号：harness 据此收尾，不再靠超时猜。
  onTaskIdle(() => {
    setAiGenerating(false);
    report({ type: 'task-idle' });
  });

  // AI 请求失败 → 不再处于生成中（重试引擎会重新投递，届时再置忙）
  onAiError(() => {
    setAiGenerating(false);
  });

  // 工具调用事件 → 上报（含计划解析）
  onToolCall((ev: any) => {
    if (!ev) return;
    if (ev.phase === 'start') {
      report({ type: 'tool-start', code: ev.code });
      // 计划（todoWrite）改由主进程读官方 globalThis.__cuckooTodos 后推送，这里不再用正则解析
    } else if (ev.phase === 'end') {
      report({
        type: 'tool-end',
        code: ev.code,
        success: !!ev.success,
        output: ev.output || '',
        error: ev.error || '',
      });
    }
  });

  // 框架侧投递（系统提示词 / 工具结果回传 / 看门狗 / 重试 / 压缩等）→ 上报运行态。
  // 内容不进对话流（那是底层指令），但要给 harness 一个"框架正在驱动 AI 页面"的反馈。
  // harness 自己发的用户消息（tag='harness'）不上报：气泡已显示，状态机自己管。
  onMessageDelivered((info: any) => {
    if (!info) return;
    setAiGenerating(true); // 有消息投递 = AI 页面即将工作
    if (info.tag === 'harness') return;
    report({ type: 'framework-send', tag: info.tag || '', system: !!info.isSystem });
  });

  // 用户在 harness 输入 → 主进程转发到此 → 发到 AI
  ipcRenderer.on('harness-user-message', (_e: any, payload: any) => {
    const text = payload && payload.text;
    if (!text) return;
    clearAbort(); // 新消息：清除中止标志
    sendToChat(text, 'harness', 300).catch(() => {});
  });

  // 停止：取消延时发送 + 中止工具回传
  ipcRenderer.on('harness-stop-signal', () => {
    try { cancelPendingSend(); } catch (_) { /* ignore */ }
    try { requestAbort(); } catch (_) { /* ignore */ }
    setAiGenerating(false);
    console.log('[Cuckoo Harness] 收到停止信号：已取消待发送 + 中止工具回传');
  });
}

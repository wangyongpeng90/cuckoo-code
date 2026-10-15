/**
 * IPC：飞书同步
 *  - 配置读写 / 启停 / 状态查询（壳页面「飞书」页调用）
 *  - 接收 AI 页面上报（feishu-report）→ 按配置推送飞书
 *  - 飞书来消息 → 转发给当前活跃窗口的 AI 页面
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import * as feishuClient from '../../feishu/client.js';
import { readConfig, writeConfig } from '../../feishu/config.js';
import { getProfileById, getProfileByFeishuChat, setProfileFeishuChat } from '../profile.js';
import { hasRunningSubagent } from '../subagent.js';
import fs from 'node:fs';
import path from 'node:path';
import { guessMimeType } from '../../tools/impl/attach-file.js';
import { uploadAttachment } from './attach-upload.js';
import { ToolPushThrottle } from '../../feishu/throttle.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

let feishuInited = false;

// ========== 工具状态推送限流 ==========
// 单轮任务内，工具状态（tool-start/tool-end）推送超过阈值即自动暂停，
// 并在飞书询问用户「继续 / 暂停」。仅本轮有效，下一轮用户消息自动重置。
// 纯逻辑在 src/feishu/throttle.ts（可单测），此处只负责编排：推送 + 询问 + 超时。
const ASK_WAIT_MS = 15000;        // 询问后等待用户回复的时长（超时保持暂停）
const throttle = new ToolPushThrottle();
const askTimers = new Map<string, any>();  // chatId → 询问超时定时器

/**
 * 处理用户对限流询问的回复。
 * @returns true 表示该文本被当作控制指令消费掉（不应转发给 AI）
 */
function handleThrottleReply(text: string, chatId: string): boolean {
  const action = throttle.handleReply(chatId, text);
  if (!action) return false;
  const timer = askTimers.get(chatId);
  if (timer) { try { clearTimeout(timer); } catch (_) {} askTimers.delete(chatId); }
  if (action === 'resume') {
    feishuClient.sendText('✅ 已恢复工具状态推送', chatId).catch(() => {});
    console.log('[Feishu] 用户选择继续推送，限流状态已重置。chatId=' + chatId);
  } else {
    feishuClient.sendText('⏸ 已暂停本轮工具状态推送（AI 继续执行，回复「继续」可恢复）', chatId).catch(() => {});
    console.log('[Feishu] 用户选择暂停推送。chatId=' + chatId);
  }
  return true;
}

/**
 * 飞书来消息 → 按 chatId 找到"绑定了该群的窗口" → 转发给它的 AI 页面。
 * - 群消息（chatId 非空）：只发给绑了该群的窗口
 * - 单聊（chatId 为空）：回退给最近活跃窗口
 */
function forwardUserMessage(text: string, chatId: string): void {
  let ctx: any = null;
  if (chatId) {
    const profile = getProfileByFeishuChat(chatId);
    if (!profile) {
      console.warn('[Feishu] 收到群消息，但没有窗口绑定该群，丢弃。chatId=' + chatId);
      return;
    }
    ctx = windowState.getWindowByProfileId(profile.id);
    if (!ctx) {
      console.warn('[Feishu] 群已绑定 profile，但该窗口未打开，丢弃。profileId=' + profile.id);
      return;
    }
  } else {
    ctx = windowState.getMainContext();
  }
  // 子代理运行期间：拒收（避免插进正在进行的 AI 循环），并回一条提示
  try {
    if (ctx && ctx.profileId && hasRunningSubagent(ctx.profileId)) {
      console.log('[Feishu] 子代理运行中，拒收飞书消息并回提示');
      feishuClient.sendText('AI 正在使用子代理执行任务，请等子代理结束后再发消息。', chatId || undefined).catch(() => {});
      return;
    }
  } catch (_) { /* ignore */ }
  // 限流控制指令（继续/暂停）：拦截并消费，不转发给 AI
  if (handleThrottleReply(text, chatId)) return;
  const view = ctx && ctx.view;
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    console.warn('[Feishu] 目标窗口不可用，消息丢弃');
    return;
  }
  try {
    view.webContents.send('feishu-user-message', { text });
    console.log('[Feishu] 已转发消息到 AI 页面, 长度=' + text.length + (chatId ? ' (群)' : ' (活跃窗口)'));
  } catch (err: any) {
    console.error('[Feishu] 转发失败:', err.message);
  }
}

/**
 * 飞书来图片 → 按 chatId 找到绑定窗口 → 注入上传脚本，把图片塞进 AI 页面输入框。
 * 复用 attachFile 的注入机制（构造 File 对象 + 触发 input[type=file] change）。
 * 未打开窗口/子代理运行中：与文本一致，丢弃（回一条提示）。
 */
async function forwardUserImage(filePath: string, chatId: string): Promise<void> {
  let ctx: any = null;
  if (chatId) {
    const profile = getProfileByFeishuChat(chatId);
    if (!profile) {
      console.warn('[Feishu] 收到群图片，但没有窗口绑定该群，丢弃。chatId=' + chatId);
      return;
    }
    ctx = windowState.getWindowByProfileId(profile.id);
    if (!ctx) {
      console.warn('[Feishu] 群已绑定 profile，但该窗口未打开，丢弃。profileId=' + profile.id);
      return;
    }
  } else {
    ctx = windowState.getMainContext();
  }
  try {
    if (ctx && ctx.profileId && hasRunningSubagent(ctx.profileId)) {
      console.log('[Feishu] 子代理运行中，拒收飞书图片并回提示');
      feishuClient.sendText('AI 正在使用子代理执行任务，请等子代理结束后再发图片。', chatId || undefined).catch(() => {});
      return;
    }
  } catch (_) { /* ignore */ }
  const view = ctx && ctx.view;
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    console.warn('[Feishu] 目标窗口不可用，图片丢弃');
    return;
  }
  try {
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mimeType = guessMimeType(fileName);
    const base64 = buffer.toString('base64');
    // 复用公共上传通道（CDP 真实鼠标优先，合成事件兜底）——与 harness 附件一致
    const result = await uploadAttachment(ctx as any, { name: fileName, data: base64, mime: mimeType });
    if (result && result.success === true) {
      console.log('[Feishu] 图片已上传到输入框:', fileName, 'mode=' + (result.mode || ''));
    } else {
      console.warn('[Feishu] 图片上传失败:', (result && result.error) || '未知错误');
      feishuClient.sendText('图片上传失败：' + ((result && result.error) || '未知错误'), chatId || undefined).catch(() => {});
    }
  } catch (err: any) {
    console.error('[Feishu] 图片注入失败:', err.message);
  }
}

/** 通知所有 AI 页面：飞书启用状态（bridge 据此决定是否上报） */
function broadcastFeishuMode(enabled: boolean): void {
  for (const ctx of windowState.getAllContexts()) {
    try {
      const v = ctx && ctx.view;
      if (v && v.webContents && !v.webContents.isDestroyed()) {
        v.webContents.send('feishu-mode', { enabled });
      }
    } catch (_) {}
  }
}

/** 初始化飞书（启动时调用：若配置为启用则自动连接） */
function initFeishu(): void {
  if (feishuInited) return;
  feishuInited = true;
  const cfg = readConfig();
  if (!cfg.enabled || !cfg.appId || !cfg.appSecret) return;
  feishuClient.connect({
    onUserMessage: (text, chatId) => forwardUserMessage(text, chatId),
    onUserImage: (filePath, chatId) => { forwardUserImage(filePath, chatId).catch(() => {}); },
  });
  broadcastFeishuMode(true);
  console.log('[Feishu] 启动时自动连接（已启用）');
}

function registerFeishuIpc(): void {
  // bridge 初始化时查询启用状态（避免错过广播时机）
  ipcMain.handle('feishu-is-enabled', async () => {
    const cfg = readConfig();
    return { enabled: cfg.enabled === true && !!cfg.appId && !!cfg.appSecret };
  });

  // 读配置 + 状态
  ipcMain.handle('feishu-get-config', async () => {
    const cfg = readConfig();
    const st = feishuClient.getStatus();
    // 不把 appSecret 明文回传（用掩码）
    return {
      success: true,
      config: {
        appId: cfg.appId,
        appSecret: cfg.appSecret ? '••••••' : '',
        hasSecret: !!cfg.appSecret,
        enabled: cfg.enabled,
        targetOpenId: cfg.targetOpenId,
        hasTarget: !!cfg.targetOpenId,
        pushUserMessage: cfg.pushUserMessage,
        pushAiReply: cfg.pushAiReply,
        pushToolStatus: cfg.pushToolStatus,
        pushToolName: cfg.pushToolName,
      },
      status: st.status,
      statusDetail: st.detail,
    };
  });

  // 保存配置 + （按需）启停连接
  ipcMain.handle('feishu-save-config', async (_event: any, { data }: any) => {
    const before = readConfig();
    const d: any = { ...(data || {}) };
    // 掩码密码不回写（保留原值）
    if (d.appSecret === '••••••') delete d.appSecret;
    const ok = writeConfig(d);
    if (!ok) return { success: false, error: '保存失败' };
    const cfg = readConfig();
    // 仅当"凭证或启用状态"变化时才重连（纯改推送选项不重连）
    const connChanged = before.appId !== cfg.appId
      || before.appSecret !== cfg.appSecret
      || before.enabled !== cfg.enabled;
    if (!connChanged) return { success: true };
    // 按启用状态连接/断开
    if (cfg.enabled && cfg.appId && cfg.appSecret) {
      feishuClient.connect({
        onUserMessage: (text, chatId) => forwardUserMessage(text, chatId),
        onUserImage: (filePath, chatId) => { forwardUserImage(filePath, chatId).catch(() => {}); },
      });
      broadcastFeishuMode(true);
    } else {
      feishuClient.disconnect();
      broadcastFeishuMode(false);
    }
    return { success: true };
  });

  // 查询机器人所在的群列表（供窗口下拉选择绑定）
  ipcMain.handle('feishu-list-chats', async () => {
    return await feishuClient.listChats();
  });

  // 读取当前窗口绑定的群
  ipcMain.handle('feishu-get-binding', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const profile = ctx ? getProfileById(ctx.profileId) : null;
    return {
      success: true,
      chatId: (profile && profile.feishuChatId) || '',
      chatName: (profile && profile.feishuChatName) || '',
      profileId: ctx ? ctx.profileId : '',
    };
  });

  // 绑定/解绑当前窗口的群
  ipcMain.handle('feishu-bind-chat', async (event: any, { chatId, chatName }: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    if (!ctx || !ctx.profileId) return { success: false, error: '找不到窗口' };
    const p = setProfileFeishuChat(ctx.profileId, chatId || '', chatName || '');
    if (!p) return { success: false, error: '更新失败' };
    return { success: true };
  });

  // 手动重连
  ipcMain.handle('feishu-reconnect', async () => {
    const cfg = readConfig();
    if (!cfg.appId || !cfg.appSecret) return { success: false, error: '未配置凭证' };
    feishuClient.connect({
      onUserMessage: (text, chatId) => forwardUserMessage(text, chatId),
      onUserImage: (filePath, chatId) => { forwardUserImage(filePath, chatId).catch(() => {}); },
    });
    return { success: true };
  });

  // 断开
  ipcMain.handle('feishu-disconnect', async () => {
    feishuClient.disconnect();
    broadcastFeishuMode(false);
    return { success: true };
  });

  // AI 页面上报（用户消息 / AI 回复 / 工具状态）→ 按"发起窗口绑定的群"推送
  ipcMain.handle('feishu-report', async (event: any, payload: any) => {
    const cfg = readConfig();
    if (!cfg.enabled) return { success: false };
    // 从发起方（AI 页面）反查窗口 → 取该窗口绑定的群
    const ctx = windowState.getContextByWebContents(event.sender);
    const profile = ctx ? getProfileById(ctx.profileId) : null;
    const chatId = (profile && profile.feishuChatId) || '';
    if (!chatId) {
      // 该窗口未绑定群：不推送（按需求：未绑定=飞书功能关闭）
      return { success: false, error: 'no-chat-bound' };
    }
    const type = payload && payload.type;
    // 统一推送 + 结果检查（失败打日志，便于排查）
    const push = async (text: string, label: string) => {
      const r = await feishuClient.sendText(text, chatId);
      if (!r.success) console.warn('[Feishu] 推送失败（' + label + '）:', r.error);
      return r;
    };
    // Markdown 推送（AI 回复用，渲染 MD）
    const pushMd = async (md: string, label: string) => {
      const r = await feishuClient.sendMarkdown(md, chatId);
      if (!r.success) console.warn('[Feishu] 推送失败（' + label + '）:', r.error);
      return r;
    };
    try {
      if (type === 'user-message') {
        // 新一轮任务：重置工具状态限流
        throttle.reset(chatId);
        const oldTimer = askTimers.get(chatId);
        if (oldTimer) { try { clearTimeout(oldTimer); } catch (_) {} askTimers.delete(chatId); }
        if (!cfg.pushUserMessage) return { success: true };
        const t = String(payload.text || '').trim();
        if (t) return await push('👤 我：' + t, 'user-message');
      } else if (type === 'ai-reply') {
        if (!cfg.pushAiReply) return { success: true };
        const t = String(payload.text || '').trim();
        if (t) return await pushMd('**🤖 AI：**\n\n' + t, 'ai-reply');
      } else if (type === 'tool-start' || type === 'tool-end') {
        if (!cfg.pushToolStatus) return { success: true };
        const { allow, shouldAsk } = throttle.tryPush(chatId);
        // 达到阈值：暂停本轮工具状态推送 + 询问用户
        if (shouldAsk) {
          console.log('[Feishu] 工具状态推送达阈值，自动暂停并询问。chatId=' + chatId);
          await feishuClient.sendText(
            '⚠️ 本轮的「工具调用状态」推送过于频繁（已达 ' + throttle.limitValue + ' 条），已自动暂停这类推送。\n' +
            'AI 仍在继续执行，AI 回复和你的消息不受影响。\n' +
            '回复「继续」恢复工具状态推送 / 回复「暂停」保持暂停（' + Math.round(ASK_WAIT_MS / 1000) + ' 秒内有效）。',
            chatId
          ).catch(() => {});
          // 超时未回复：保持暂停（关闭询问窗口即可）
          const oldTimer = askTimers.get(chatId);
          if (oldTimer) { try { clearTimeout(oldTimer); } catch (_) {} }
          askTimers.set(chatId, setTimeout(() => { throttle.askTimeout(chatId); askTimers.delete(chatId); }, ASK_WAIT_MS));
          return { success: true };
        }
        if (!allow) return { success: true };  // 本轮已暂停：静默丢弃
        const label = type === 'tool-start' ? 'tool-start' : 'tool-end';
        const text = type === 'tool-start'
          ? (cfg.pushToolName && payload.toolName ? '🔧 正在调用工具：' + payload.toolName : '🔧 AI 正在调用工具…')
          : '✅ 工具调用完成';
        return await push(text, label);
      }
    } catch (err: any) {
      console.error('[Feishu] 推送异常:', err.message);
      return { success: false, error: err.message };
    }
    return { success: true };
  });
}

export { registerFeishuIpc, initFeishu, broadcastFeishuMode };

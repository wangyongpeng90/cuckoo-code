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
import { findImagePaths } from '../../feishu/images.js';
import { getProfileById, getProfileByFeishuChat, setProfileFeishuChat } from '../profile.js';
import { hasRunningSubagent } from '../subagent.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

let feishuInited = false;

/** 最近已回传过的图片路径（防同图重复发送；上限 50，超出丢弃最旧） */
const recentlySentImages = new Set<string>();
function rememberSentImage(p: string): void {
  recentlySentImages.add(p.toLowerCase());
  if (recentlySentImages.size > 50) {
    const first = recentlySentImages.values().next().value;
    if (first) recentlySentImages.delete(first);
  }
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
 * 收图（飞书 → Cuckoo）：图片已由 client 下载到本地，这里按消息同样的路由
 * 告知 AI 页面（带绝对路径，AI 可直接用文件工具查看/处理）。
 * 定向规则与 forwardUserMessage 一致：群消息只进绑定窗口，单聊进活跃窗口。
 */
function forwardUserImage(imagePath: string, chatId: string): void {
  const text = '📩 收到飞书图片，已保存到：' + imagePath + '\n（请查看并处理这张图片）';
  forwardUserMessage(text, chatId);
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
    onUserImage: (imagePath, chatId) => forwardUserImage(imagePath, chatId),
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
        onUserImage: (imagePath, chatId) => forwardUserImage(imagePath, chatId),
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
      onUserImage: (imagePath, chatId) => forwardUserImage(imagePath, chatId),
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
        if (!cfg.pushUserMessage) return { success: true };
        const t = String(payload.text || '').trim();
        if (t) return await push('👤 我：' + t, 'user-message');
      } else if (type === 'ai-reply') {
        if (!cfg.pushAiReply) return { success: true };
        const t = String(payload.text || '').trim();
        let r = { success: true };
        if (t) r = await pushMd('**🤖 AI：**\n\n' + t, 'ai-reply');
        // 图片回传：AI 回复里提到的本地图片（如生成/处理的产物）→ 作为图片消息发到飞书
        if (cfg.pushImages) {
          const imgs = findImagePaths(t);
          for (const img of imgs) {
            if (recentlySentImages.has(img.toLowerCase())) continue;
            const ir = await feishuClient.sendImage(img, chatId);
            if (ir.success) {
              rememberSentImage(img);
              console.log('[Feishu] 已回传图片:', img);
            } else {
              console.warn('[Feishu] 回传图片失败（' + img + '）:', ir.error);
            }
          }
        }
        return r;
      } else if (type === 'image') {
        // 显式图片上报（页面/插件主动指定图片路径发送）
        const p = String((payload && payload.path) || '').trim();
        if (!p) return { success: false, error: '缺少 path' };
        const ir = await feishuClient.sendImage(p, chatId);
        if (ir.success) rememberSentImage(p);
        return ir;
      } else if (type === 'tool-start') {
        if (!cfg.pushToolStatus) return { success: true };
        return await push(cfg.pushToolName && payload.toolName ? '🔧 正在调用工具：' + payload.toolName : '🔧 AI 正在调用工具…', 'tool-start');
      } else if (type === 'tool-end') {
        if (!cfg.pushToolStatus) return { success: true };
        return await push('✅ 工具调用完成', 'tool-end');
      }
    } catch (err: any) {
      console.error('[Feishu] 推送异常:', err.message);
      return { success: false, error: err.message };
    }
    return { success: true };
  });
}

export { registerFeishuIpc, initFeishu, broadcastFeishuMode };

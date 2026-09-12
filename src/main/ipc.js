/**
 * IPC 处理器注册（渲染进程 → 主进程）
 * 多窗口版：按 event.sender 路由到对应窗口的 profile 上下文。
 */
const { app, dialog, ipcMain, Notification } = require('electron');
const { exec } = require('child_process');

const windowState = require('./window');
const profileManager = require('./profile-manager');
const { toolRegistry, jsRunner } = require('./tool-registry');
const { initProject } = require('./project-context');
const { isDangerous } = require('./dangerous-commands');
const { decodeOutput, normalizeCommand } = require('../../tools/decodeOutput');

function registerIpcHandlers() {
  // 初始化项目
  ipcMain.handle('init-project', async (event, { skipPrompt = false } = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    return initProject(skipPrompt, ctx);
  });

  // 列出会话
  ipcMain.handle('list-sessions', async (event) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    if (!store || !store.state.selectedProjectDir) {
      return { success: true, sessions: [] };
    }
    const all = store.readSessionStore();
    const sessions = Object.keys(all).filter(id => all[id] === store.state.selectedProjectDir);
    return { success: true, sessions };
  });

  // 导航到会话
  ipcMain.handle('navigate-session', async (event, { sessionId }) => {
    if (!sessionId) return { success: false, error: '缺少会话ID' };
    const ctx = windowState.getContextByWebContents(event.sender);
    const win = ctx ? ctx.win : null;
    if (!win || win.isDestroyed()) return { success: false, error: '窗口已关闭' };
    // 按当前 provider 拼会话 URL（智谱 cid=、DeepSeek /chat/s/、Claude /chat/）
    let url = null;
    try {
      const { getProviderByUrl } = require('../providers');
      const provider = getProviderByUrl(win.webContents.getURL());
      if (provider && typeof provider.sessionUrlBase === 'string' && provider.sessionUrlBase) {
        url = provider.sessionUrlBase + sessionId;
      }
    } catch (_) { /* 回退 ChatGPT（GPT 定制版默认平台）*/ }
    if (!url) url = 'https://chatgpt.com/';
    try {
      await win.webContents.loadURL(url);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 执行命令
  ipcMain.handle('execute-command', async (event, { command, id }) => {
    if (!command || typeof command !== 'string') {
      return { id, success: false, error: '无效的命令' };
    }
    const trimmed = normalizeCommand(command.trim());
    if (!trimmed) return { id, success: false, error: '命令为空' };

    const ctx = windowState.getContextByWebContents(event.sender);
    const win = ctx ? ctx.win : windowState.getMainWindow();
    const store = ctx ? ctx.sessionStore : null;
    const selectedDir = store ? store.state.selectedProjectDir : null;

    const dangerWarning = isDangerous(trimmed) ? '\n\n⚠️ 警告：此命令可能存在风险，请谨慎确认！' : '';
    const result = await dialog.showMessageBox(win, {
      type: isDangerous(trimmed) ? 'warning' : 'question',
      buttons: ['取消', '确认执行'],
      defaultId: 0,
      cancelId: 0,
      title: '确认执行命令',
      message: '将执行以下命令：',
      detail: trimmed + dangerWarning,
    });
    if (result.response !== 1) {
      return { id, success: false, error: '用户取消了执行', canceled: true };
    }
    return new Promise((resolve) => {
      const child = exec(
        trimmed,
        {
          cwd: selectedDir || process.env.USERPROFILE || app.getPath('home'),
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          encoding: 'buffer',
        },
        (error, stdout, stderr) => {
          resolve({
            id,
            success: !error,
            stdout: decodeOutput(stdout),
            stderr: decodeOutput(stderr),
            error: error ? error.message : null,
          });
        }
      );
    });
  });

  // 执行工具
  ipcMain.handle('execute-tool', async (event, { toolName, params, callId }) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    const selectedDir = store ? store.state.selectedProjectDir : null;
    try {
      const result = await toolRegistry.execute(toolName, { ...params, projectDir: selectedDir });
      return { callId, success: result.success, data: result.data, error: result.error };
    } catch (err) {
      return { callId, success: false, error: err.message };
    }
  });

  // AI 回复完成时：窗口已聚焦则不打扰；否则弹通知并让任务栏/Dock 闪烁
  ipcMain.handle('show-ai-notification', async (event) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const win = ctx ? ctx.win : windowState.getMainWindow();

      if (win && !win.isDestroyed() && win.isFocused()) {
        // 用户正在查看该窗口，不弹通知、不闪烁
        return { success: true, skipped: true, reason: 'window-focused' };
      }

      if (win && !win.isDestroyed()) {
        let windowName = 'Cuckoo Code';
        if (ctx && ctx.profileId) {
          const profile = profileManager.getProfileById(ctx.profileId);
          if (profile && profile.name) windowName = profile.name;
        }

        const notification = new Notification({
          title: windowName + ' - AI任务已完成',
          body: 'AI 已完成回复',
        });
        notification.show();

        win.flashFrame(true);
        win.once('focus', () => {
          if (!win.isDestroyed()) win.flashFrame(false);
        });
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 执行 JS 脚本
  ipcMain.handle('execute-js', async (event, { code, callId }) => {
    if (!code || typeof code !== 'string') {
      return { callId, success: false, error: '无效的 JS 代码' };
    }
    const ctx = windowState.getContextByWebContents(event.sender);
    const store = ctx ? ctx.sessionStore : null;
    const selectedDir = store ? store.state.selectedProjectDir : null;
    try {
      const result = await jsRunner.run(code, selectedDir);
      return { callId, ...result };
    } catch (err) {
      return { callId, success: false, error: err.message };
    }
  });

  // 站点原生发送：向聚焦输入框注入真实级 Enter（智谱只响应 isTrusted=true 的输入，合成事件免疫）
  ipcMain.handle('chat-send-enter', async (event) => {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return false;
    try {
      sender.sendInputEvent({ type: 'keyDown', keyCode: 'Return', key: 'Enter' });
      sender.sendInputEvent({ type: 'char', keyCode: 'Return', key: '\r' });
      sender.sendInputEvent({ type: 'keyUp', keyCode: 'Return', key: 'Enter' });
      return true;
    } catch (err) {
      console.error('[Cuckoo Code] ❌ 原生 Enter 发送失败:', err.message);
      return false;
    }
  });

  // ========== 网关（OpenAI 兼容）IPC ==========
  // 配置/密钥/会话历史全部只留在主进程；页面仅能拿到脱敏配置与文本结果。
  const { createGatewayStore } = require('./gateway-store');
  const gatewayClient = require('./gateway-client');
  let gatewayStore = null;
  function getGatewayStore() {
    if (!gatewayStore) {
      gatewayStore = createGatewayStore(app.getPath('userData'));
    }
    return gatewayStore;
  }
  // 每会话同一时刻仅允许一路进行中的补全，防止工具回传与用户输入互相踩历史
  const gatewayInflight = new Set();
  const GATEWAY_ROLES = new Set(['system', 'user', 'assistant']);
  function sanitizeHistory(history) {
    return (history || [])
      .filter(m => m && GATEWAY_ROLES.has(m.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content }));
  }

  ipcMain.handle('gateway-get-config', async () => {
    return { success: true, config: getGatewayStore().getConfigSafe() };
  });

  ipcMain.handle('gateway-save-config', async (_event, { patch }) => {
    return getGatewayStore().saveConfig(patch);
  });

  ipcMain.handle('gateway-get-history', async (_event, { sessionId }) => {
    if (!sessionId || typeof sessionId !== 'string') return { success: false, error: '缺少会话ID', history: [] };
    return { success: true, history: sanitizeHistory(getGatewayStore().getHistory(sessionId)) };
  });

  ipcMain.handle('gateway-send', async (event, payload) => {
    const { sessionId, text } = payload || {};
    if (!sessionId || typeof sessionId !== 'string') return { ok: false, text: '', error: '缺少会话ID' };
    if (!text || typeof text !== 'string' || !text.trim()) return { ok: false, text: '', error: '消息为空' };

    const store = getGatewayStore();
    const cfg = store.getConfig();
    if (!cfg.apiKey) return { ok: false, text: '', error: '尚未配置 API Key，请点击右上角「网关设置」' };
    if (!cfg.model) return { ok: false, text: '', error: '尚未配置模型名' };
    if (gatewayInflight.has(sessionId)) return { ok: false, text: '', error: '该会话正在生成中，请稍候' };

    gatewayInflight.add(sessionId);
    const sender = event.sender;
    try {
      // 历史 + 本条用户消息 → 请求体
      const history = sanitizeHistory(store.getHistory(sessionId));
      const messages = history.concat([{ role: 'user', content: text }]);
      store.appendMessages(sessionId, [{ role: 'user', content: text }]);

      const result = await gatewayClient.streamCompletion({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        temperature: cfg.temperature,
        messages,
        onDelta: (delta) => {
          if (sender && !sender.isDestroyed()) {
            sender.send('gateway-delta', { sessionId, delta });
          }
        },
      });

      if (sender && !sender.isDestroyed()) {
        sender.send('gateway-delta', { sessionId, delta: '', done: true });
      }
      if (result.ok && result.text) {
        store.appendMessages(sessionId, [{ role: 'assistant', content: result.text }]);
      } else if (result.ok) {
        // 空回复也记录，避免后续请求出现连续 user 消息
        store.appendMessages(sessionId, [{ role: 'assistant', content: '' }]);
      }
      return result;
    } finally {
      gatewayInflight.delete(sessionId);
    }
  });
}

module.exports = { registerIpcHandlers };

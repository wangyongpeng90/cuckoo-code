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

function registerIpcHandlers(subagentRunner = null) {
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
    } catch (_) { /* 回退 DeepSeek */ }
    if (!url) url = 'https://chat.deepseek.com/a/chat/s/' + sessionId;
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

  // 执行工具 → Task 10：子 Agent 活动信号 + 轮次硬顶拦截（markActivity 零新增消息复用）
  ipcMain.handle('execute-tool', async (event, { toolName, params, callId }) => {
    if (subagentRunner) {
      const subState = subagentRunner.findTaskByWebContents(event.sender);
      if (subState && !subagentRunner.markActivity(subState)) {
        return { callId, success: false, error: '已达到轮次上限，请输出 subagent_result 交付结果' };
      }
    }
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

  // 执行 JS 脚本 → Task 10：子 Agent 活动信号 + 轮次硬顶拦截（markActivity 零新增消息复用）
  ipcMain.handle('execute-js', async (event, { code, callId }) => {
    if (!code || typeof code !== 'string') {
      return { callId, success: false, error: '无效的 JS 代码' };
    }
    if (subagentRunner) {
      const subState = subagentRunner.findTaskByWebContents(event.sender);
      if (subState && !subagentRunner.markActivity(subState)) {
        return { callId, success: false, error: '已达到轮次上限，请输出 subagent_result 交付结果' };
      }
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

  // 子 Agent observer-ready 握手：preload 上报后 resolve runner 的 readyPromise
  ipcMain.handle('subagent-ready', async (event, { subagentId } = {}) => {
    if (!subagentId || !subagentRunner) return { success: false, error: '缺少 subagentId 或 runner 未初始化' };
    const ok = subagentRunner.markReady(subagentId, event.sender);
    console.log('[Cuckoo Code] subagent-ready 握手:', subagentId, ok ? 'OK' : '未匹配（可能已超时/终止）');
    return { success: ok };
  });

  // 子 Agent 候选结果上报：按 event.sender 反查 activeTasks
  ipcMain.handle('subagent-candidate-result', async (event, payload = {}) => {
    if (!subagentRunner) return { success: false, error: 'runner 未初始化' };
    return subagentRunner.handleCandidateResult(event.sender, payload);
  });

  // 获取当前可用 agent 清单 + 用户 agent 目录（多 Agent 按钮机制说明拼接用）
  ipcMain.handle('get-agent-list', async () => {
    if (!subagentRunner) return { success: false, error: 'runner 未初始化' };
    const agents = subagentRunner.getAgentList();
    const { getUserAgentDir } = require('./agent-templates');
    return { success: true, agents, agentDir: getUserAgentDir() };
  });

  // 切换/聚焦子 Agent 窗口
  ipcMain.handle('focus-subagent-window', async (_event, { windowId } = {}) => {
    if (!subagentRunner || !windowId) return { success: false, error: '缺少 windowId' };
    const ok = subagentRunner.focusByWindowId(windowId);
    return { success: ok };
  });

  // 中止子 Agent 任务
  ipcMain.handle('subagent-abort', async (_event, { windowId } = {}) => {
    if (!subagentRunner || !windowId) return { success: false, error: '缺少 windowId' };
    const ok = subagentRunner.abortByWindowId(windowId);
    return { success: ok };
  });
}

module.exports = { registerIpcHandlers };

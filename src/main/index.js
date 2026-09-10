/**
 * Cuckoo Code 主进程入口（多窗口多 profile 版）
 * 由项目根目录 main.js 薄壳加载。
 */
const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const windowState = require('./window');
const profileManager = require('./profile-manager');
const { createSessionStore } = require('./session-store');
const { getProvider } = require('../providers');
const updater = require('./updater');

// ========== 持久化会话配置 ==========
const SESSION_DIR = process.env.CUCKOO_SESSION_DIR || 'cuckoo-ai-pro-session';
app.setPath('userData', path.join(app.getPath('appData'), SESSION_DIR));
console.log('[Cuckoo Code] Session 数据目录:', app.getPath('userData'));

// 渲染进程日志输出目录（仅开发环境持久化；打包版不写日志文件）
const RENDERER_LOG_DIR = app.isPackaged
  ? null
  : path.join(app.getPath('userData'), 'wyp', 'log');
if (RENDERER_LOG_DIR) {
  fs.mkdirSync(RENDERER_LOG_DIR, { recursive: true });
}

const { registerIpcHandlers } = require('./ipc');

// 退出前需要 flush 的 sessions
const sessionsToFlush = new Set();

async function flushAllSessions() {
  const promises = [];
  for (const ses of sessionsToFlush) {
    promises.push(ses.flushStorageData().catch(err => {
      console.error('[Cuckoo Code] 刷新 session 失败:', err.message);
    }));
  }
  await Promise.all(promises);
  console.log('[Cuckoo Code] 全部 session 数据已刷新到磁盘');
}

/**
 * 创建窗口（绑定指定 profile）
 * @param {object|null} profile profile 对象，null 则使用默认 profile
 */
function createWindow(profile) {
  const profileData = profile || profileManager.getDefaultProfile();
  const provider = getProvider(profileData.providerId || 'deepseek') || getProvider('deepseek');
  const storeDir = app.getPath('userData');
  const sessionStore = createSessionStore(profileData.id, storeDir, windowState);
  const hasExplicitProfile = !!profile;
  // providerId 已确定 → 直接打开；未确定 → 显示平台选择页
  const providerChosen = !!profileData.providerId;

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    title: 'Cuckoo Code Pro - ' + provider.name + ' - ' + profileData.name,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: profileData.partition, // 每个 profile 独立持久化 session
      backgroundThrottling: false,
      additionalArguments: ['--cuckoo-user-data=' + app.getPath('userData')],
    },
  });

  // 保存 session 引用（窗口销毁后 webContents 不可访问）
  const winSession = mainWindow.webContents.session;

  // 注册窗口上下文（记录 providerId，未确定时为空字符串）
  windowState.addWindow(mainWindow, profileData.id, profileData.providerId || '', sessionStore);
  sessionsToFlush.add(winSession);

  // 更新主窗口引用
  windowState.setMainWindow(mainWindow);

  // 初始化自动更新（仅第一个窗口时初始化）
  if (windowState.getAllWindows().length === 1) {
    updater.initAutoUpdater(mainWindow);
  }

  // 转发渲染进程的 console.log 到主进程，并按平台写入独立日志文件
  mainWindow.webContents.on('console-message', (_event, level, message, _line, _sourceId) => {
    console.log('[Renderer Console][' + profileData.name + ']', message);

    // 打包版不进行日志持久化
    if (!RENDERER_LOG_DIR) return;

    // 根据当前窗口上下文确定 providerId，未确定用 default
    let providerId = profileData.providerId || 'default';
    const ctx = windowState.getContextByWebContents(mainWindow.webContents);
    if (ctx && ctx.providerId) providerId = ctx.providerId;

    const logFile = path.join(RENDERER_LOG_DIR, providerId + '.log');
    const timeIso = new Date().toISOString();
    fs.appendFileSync(logFile, '[' + timeIso + '][' + profileData.name + '] ' + message + '\n', 'utf-8');
  });

  mainWindow.maximize();

  // 设置与 Electron 33（Chromium 130）匹配的普通 Chrome UA：
  // 1. 不带 Electron 标识，避免 DeepSeek 识别为第三方客户端
  // 2. 与内核版本一致，避免 Google OAuth 因 UA/sec-ch-ua 不一致报“浏览器不安全”
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  mainWindow.webContents.setUserAgent(userAgent);

  if (providerChosen) {
    // 平台已确定，直接进入平台首页
    mainWindow.loadURL(provider.homeUrl);
  } else {
    // 平台未确定，显示平台选择页
    const selectPage = path.join(__dirname, '..', 'ui', 'platform-select.html');
    mainWindow.loadFile(selectPage);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('page-loaded');
      sessionStore.tryRestoreSessionFromUrl(mainWindow);
    }
  });

  mainWindow.webContents.on('did-navigate', (_event, url) => {
    sessionStore.handleUrlChange(url, mainWindow);
  });

  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    sessionStore.handleUrlChange(url, mainWindow);
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    sessionsToFlush.delete(winSession);
    windowState.removeWindow(mainWindow.id);
  });
}

// ========== 应用菜单 ==========
function setupAppMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const profiles = profileManager.readProfiles();
            createWindow(profileManager.createProfile('窗口' + (profiles.length + 1), ''));
          }
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'delete', label: '删除' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '导航',
      submenu: [
        {
          label: '后退',
          accelerator: 'Alt+Left',
          click: (_item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.navigationHistory.goBack();
          }
        },
        {
          label: '前进',
          accelerator: 'Alt+Right',
          click: (_item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.navigationHistory.goForward();
          }
        },
        { type: 'separator' },
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: (_item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload();
          }
        },
        {
          label: '停止加载',
          accelerator: 'Esc',
          click: (_item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.stop();
          }
        },
        { type: 'separator' },
        {
          label: '主页',
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              const ctx = windowState.getContextByWebContents(focusedWindow.webContents);
              if (ctx && ctx.providerId) {
                const provider = getProvider(ctx.providerId);
                if (provider) focusedWindow.loadURL(provider.homeUrl);
              }
            }
          }
        }
      ]
    },
    {
      label: '查看',
      submenu: [
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '全部置于顶层' },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新',
          click: () => {
            updater.checkForUpdates();
          }
        },
        { type: 'separator' },
        { role: 'about', label: '关于 Cuckoo Code' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ========== IPC 处理器 ==========
registerIpcHandlers();

// 覆盖层"新建窗口"按钮触发
const { ipcMain: ipcMainForProfile } = require('electron');
ipcMainForProfile.handle('create-profile-window', async (_event, { providerId } = {}) => {
  const profiles = profileManager.readProfiles();
  // 不指定平台时创建"未确定平台"的 profile，窗口会显示平台选择页
  const pid = providerId || '';
  createWindow(profileManager.createProfile('窗口' + (profiles.length + 1), pid));
  return { success: true };
});

// 列出所有 profiles
ipcMainForProfile.handle('list-profiles', async () => {
  return { success: true, profiles: profileManager.readProfiles() };
});

// 删除指定 profile（会关闭其窗口）
ipcMainForProfile.handle('delete-profile', async (_event, { profileId }) => {
  if (!profileId) return { success: false, error: '缺少窗口ID' };
  const ctx = windowState.getWindowByProfileId(profileId);
  if (ctx && ctx.win && !ctx.win.isDestroyed()) {
    ctx.win.close();
  }
  const ok = profileManager.deleteProfile(profileId);
  return { success: ok, error: ok ? null : '窗口不存在' };
});

// 列出所有内置平台
ipcMainForProfile.handle('list-providers', async () => {
  const { getAllProviders } = require('../providers');
  return {
    success: true,
    providers: getAllProviders().map(p => ({
      id: p.id,
      name: p.name,
      custom: !!p._customPath,
      path: p._customPath || null,
    })),
  };
});

// 导入自定义 Provider（弹文件选择框，复制到 userData，并处理重名）
ipcMainForProfile.handle('import-provider', async (event, { replace = false } = {}) => {
  const win = windowState.getMainWindow();
  const result = dialog.showOpenDialogSync(win, {
    properties: ['openFile'],
    filters: [{ name: 'JavaScript', extensions: ['js'] }],
    title: '选择自定义 Provider 文件',
  });
  if (!result || result.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = result[0];
  const { importCustomProvider } = require('../providers/custom/loader');
  try {
    const res = importCustomProvider(filePath, { replace });
    if (res.exists && !replace) {
      // 同名 provider 已存在，询问是否替换
      const confirmRes = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['取消', '替换'],
        defaultId: 0,
        cancelId: 0,
        title: 'Provider 已存在',
        message: '已导入过 id 为 "' + res.provider.id + '" 的 Provider，是否替换？',
      });
      if (confirmRes.response !== 1) {
        return { success: false, canceled: true };
      }
      // 用户确认替换，重新导入
      const finalRes = importCustomProvider(filePath, { replace: true });
      return { success: true, provider: { id: finalRes.provider.id, name: finalRes.provider.name, path: finalRes.targetPath } };
    }
    return { success: true, provider: { id: res.provider.id, name: res.provider.name, path: res.targetPath } };
  } catch (err) {
    return { success: false, error: '加载失败: ' + err.message };
  }
});

// 删除自定义 Provider（先检查是否有窗口在使用）
ipcMainForProfile.handle('remove-provider', async (_event, { path: filePath, providerId }) => {
  if (!filePath) return { success: false, error: '缺少文件路径' };

  // 检查是否有窗口正在使用该 provider
  const usingContexts = windowState.getAllContexts().filter(
    (ctx) => ctx.providerId === providerId
  );

  if (usingContexts.length > 0) {
    const profileNames = usingContexts
      .map((ctx) => {
        const profile = profileManager.getProfileById(ctx.profileId);
        return profile ? profile.name : ctx.profileId;
      })
      .join('、');
    return {
      success: false,
      error: '以下窗口正在使用此 Provider，请先在窗口管理中更换这些窗口的平台再删除：' + profileNames,
    };
  }

  const { removeCustomProviderPath } = require('../providers/custom/loader');
  removeCustomProviderPath(filePath);
  return { success: true };
});

// 替换自定义 Provider（弹文件选择框，校验 id 一致后覆盖）
ipcMainForProfile.handle('replace-provider', async (event, { providerId }) => {
  if (!providerId) return { success: false, error: '缺少 providerId' };
  const win = windowState.getMainWindow();
  const result = dialog.showOpenDialogSync(win, {
    properties: ['openFile'],
    filters: [{ name: 'JavaScript', extensions: ['js'] }],
    title: '选择新的 Provider 文件（id 必须为 ' + providerId + '）',
  });
  if (!result || result.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = result[0];
  const { replaceCustomProvider } = require('../providers/custom/loader');
  try {
    const res = replaceCustomProvider(providerId, filePath);
    return { success: true, provider: { id: res.provider.id, name: res.provider.name, path: res.targetPath } };
  } catch (err) {
    return { success: false, error: '替换失败: ' + err.message };
  }
});

// 用户在平台选择页选择平台后，绑定 profile 并加载平台首页
ipcMainForProfile.handle('select-platform', async (event, { providerId }) => {
  if (!providerId) return { success: false, error: '缺少平台ID' };
  const ctx = windowState.getContextByWebContents(event.sender);
  if (!ctx) return { success: false, error: '窗口上下文不存在' };

  const provider = getProvider(providerId);
  if (!provider) return { success: false, error: '平台不存在: ' + providerId };

  // 更新该窗口 profile 的 providerId 和 partition
  profileManager.updateProfileProvider(ctx.profileId, providerId);

  // 记录窗口上下文 providerId
  ctx.providerId = providerId;

  // 原地跳转到平台首页
  if (ctx.win && !ctx.win.isDestroyed()) {
    await ctx.win.loadURL(provider.homeUrl);
  }
  return { success: true };
});

// 打开指定 profile 的窗口（若已存在则聚焦）
ipcMainForProfile.handle('open-profile-window', async (_event, { profileId }) => {
  const existing = windowState.getWindowByProfileId(profileId);
  if (existing && existing.win && !existing.win.isDestroyed()) {
    const win = existing.win;
    if (win.isMinimized()) win.restore();
    win.focus();
    return { success: true, focused: true };
  }
  const profile = profileManager.getProfileById(profileId);
  if (!profile) return { success: false, error: '窗口不存在' };
  createWindow(profile);
  return { success: true, focused: false };
});

// 更新窗口名称（提取到 DeepSeek 用户信息后）
ipcMainForProfile.handle('update-window-name', async (event, { displayName }) => {
  if (!displayName || !displayName.trim()) return { success: false };
  const ctx = windowState.getContextByWebContents(event.sender);
  if (!ctx) return { success: false, error: '窗口上下文不存在' };
  const updated = profileManager.updateProfileName(ctx.profileId, displayName);
  if (updated && ctx.win && !ctx.win.isDestroyed()) {
    ctx.win.setTitle('Cuckoo Code Pro - ' + updated.name);
  }
  return { success: !!updated, name: updated ? updated.name : null };
});

// ========== MCP 相关 IPC ==========
const mcpConfig = require('./mcp-config');
const mcpClient = require('./mcp-client');

// 列出所有 MCP server（含启用状态）
ipcMainForProfile.handle('list-mcp-servers', async () => {
  const servers = mcpConfig.getServers();
  const connected = new Set(mcpClient.getConnectedServers().map(s => s.name));
  console.log('[MCP DEBUG] servers:', JSON.stringify(servers.map(s => ({ name: s.name, enabled: s.enabled }))));
  console.log('[MCP DEBUG] connected:', JSON.stringify(Array.from(connected)));
  return { success: true, servers: servers.map(s => ({ ...s, connected: connected.has(s.name) })) };
});

// 添加或更新 MCP server 配置
ipcMainForProfile.handle('upsert-mcp-server', async (_event, { server }) => {
  if (!server || !server.name || !server.type) {
    return { success: false, error: 'server 配置不完整（需要 name 和 type）' };
  }
  mcpConfig.upsertServer(server);
  return { success: true };
});

// 删除 MCP server
ipcMainForProfile.handle('remove-mcp-server', async (_event, { name }) => {
  await mcpClient.disconnectServerByName(name);
  mcpConfig.removeServer(name);
  return { success: true };
});

// 启用 MCP server（连接并拉取工具）
ipcMainForProfile.handle('enable-mcp-server', async (_event, { name }) => {
  try {
    mcpConfig.setServerEnabled(name, true);
    await mcpClient.connectServerByName(name);
    console.log('[MCP DEBUG] enable 完成, connections:', JSON.stringify(Array.from(mcpClient.getConnectedServers().map(s => s.name))));
    return { success: true };
  } catch (err) {
    console.error('[MCP DEBUG] enable 失败:', err);
    return { success: false, error: err.message };
  }
});

// 禁用 MCP server（断开连接）
ipcMainForProfile.handle('disable-mcp-server', async (_event, { name }) => {
  mcpConfig.setServerEnabled(name, false);
  await mcpClient.disconnectServerByName(name);
  return { success: true };
});

// 获取已启用 server 的工具列表（用于注入提示词）
ipcMainForProfile.handle('get-mcp-tools', async () => {
  return { success: true, tools: mcpClient.getMcpToolList() };
});

// ========== 单实例锁 ==========
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = windowState.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupAppMenu();
    createWindow(null);

    // 后台连接已启用的 MCP server，不阻塞窗口创建
    mcpClient.connectEnabledServers().catch(err => {
      console.error('[MCP] 初始化连接失败:', err.message);
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

// 退出前刷新所有 session 数据
let quitFlushed = false;
app.on('before-quit', (event) => {
  if (quitFlushed) return;
  event.preventDefault();
  quitFlushed = true;
  flushAllSessions().finally(() => {
    app.quit();
  });
});

app.on('activate', () => {
  if (windowState.getAllWindows().length === 0) {
    createWindow(null);
  }
});

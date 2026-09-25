/**
 * Cuckoo Code 主进程入口（多窗口多 profile 版）
 * 由项目根目录 main.js 薄壳加载。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as windowState from './window.js';
import * as profileManager from './profile.js';
import { createSessionStore } from '../session/store.js';
import { getProvider } from '../providers/registry.js';
import * as updater from '../updater/index.js';
import * as mcpConfig from '../mcp/config.js';
import * as mcpClient from '../mcp/client.js';
import { resolveAsset, resolveSrc } from '../infra/paths.js';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain: ipcMainForProfile } = require('electron');

// ========== 持久化会话配置 ==========
const SESSION_DIR = process.env.CUCKOO_SESSION_DIR || 'cuckoo-ai-pro-session';
const USER_DATA_DIR = path.join(app.getPath('appData'), SESSION_DIR);
// app.setPath('userData', ...) 要求目标目录必须已存在，否则会抛错导致启动闪退。
// 用户首次运行或手动删除该目录时，此处负责兜底创建。
try {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
} catch (err: any) {
  console.error('[Cuckoo Code] 创建 userData 目录失败:', err.message);
}
app.setPath('userData', USER_DATA_DIR);
console.log('[Cuckoo Code] Session 数据目录:', app.getPath('userData'));

// 渲染进程日志输出目录（仅开发环境持久化；打包版不写日志文件）
const RENDERER_LOG_DIR = app.isPackaged
  ? null
  : path.join(app.getPath('userData'), 'wyp', 'log');
if (RENDERER_LOG_DIR) {
  fs.mkdirSync(RENDERER_LOG_DIR, { recursive: true });
  // 开发环境每次启动清空平台日志，避免无限累积（与 start.js 清空 electron.log 一致）
  try {
    for (const f of fs.readdirSync(RENDERER_LOG_DIR)) {
      if (f.endsWith('.log')) fs.writeFileSync(path.join(RENDERER_LOG_DIR, f), '', 'utf-8');
    }
  } catch (err: any) {
    console.warn('[Cuckoo Code] 清空平台日志失败:', err.message);
  }
}

import { registerIpcHandlers } from './ipc/index.js';
import { pushUrlState } from './ipc/shell.js';

// 退出前需要 flush 的 sessions
const sessionsToFlush = new Set<any>();

async function flushAllSessions() {
  const promises = [];
  for (const ses of sessionsToFlush) {
    promises.push(ses.flushStorageData().catch((err: any) => {
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
function createWindow(profile: any) {
  const profileData = profile || profileManager.getDefaultProfile();
  const provider = getProvider(profileData.providerId) || null;
  const storeDir = app.getPath('userData');
  const sessionStore = createSessionStore(profileData.id, storeDir, windowState);
  const hasExplicitProfile = !!profile;
  // providerId 已确定 → 直接打开；未确定 → 显示平台选择页
  const providerChosen = !!profileData.providerId;

  // 窗口大小/位置：优先用该 profile 上次记录；无记录则用默认 + 级联偏移（避免多窗口完全重叠）
  const savedBounds = profileData.bounds;
  const winCount = windowState.getAllWindows().length;
  const defaultBounds = savedBounds
    ? { x: savedBounds.x, y: savedBounds.y, width: savedBounds.width, height: savedBounds.height }
    : { x: undefined, y: undefined, width: 1280, height: 900 };
  const cascadeOffset = savedBounds ? 0 : winCount * 30;

  // 壳窗口：webContents 承载地址栏（src/ui/shell.html），AI 页面放入下方 WebContentsView
  const mainWindow = new BrowserWindow({
    width: defaultBounds.width,
    height: defaultBounds.height,
    ...(defaultBounds.x !== undefined ? { x: defaultBounds.x + cascadeOffset, y: (defaultBounds.y || 0) + cascadeOffset } : {}),
    icon: resolveAsset('assets/icon.png'),
    title: 'Cuckoo Code Pro - ' + (provider ? provider.name : '未选择平台') + ' - ' + profileData.name,
    webPreferences: {
      // 壳页面 preload（只负责地址栏导航，与 AI 页面 preload 分离）
      preload: path.join(import.meta.dirname, 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: profileData.partition, // 每个 profile 独立持久化 session
      additionalArguments: ['--cuckoo-user-data=' + app.getPath('userData')],
    },
  });

  // AI 页面视图（复用现有 bridge preload；与壳共用 partition）
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(import.meta.dirname, '..', 'bridge', 'entry.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: profileData.partition,
      backgroundThrottling: false,
      additionalArguments: ['--cuckoo-user-data=' + app.getPath('userData')],
    },
  });
  mainWindow.contentView.addChildView(view);

  // 布局：AI 页面占地址栏下方区域，随窗口尺寸变化
  const TOOLBAR_HEIGHT = 44 + 26; // 地址栏 44 + 状态条 26
  const layoutView = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [w, h] = mainWindow.getContentSize();
    view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: Math.max(0, h - TOOLBAR_HEIGHT) });
  };
  layoutView();
  mainWindow.on('resize', layoutView);

  // 加载地址栏壳页面；壳就绪后主动推一次当前 URL 状态（避免与 view 加载竞态）
  mainWindow.loadFile(resolveSrc('ui/shell.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    pushUrlState(view);
  });

  // 保存 session 引用（窗口销毁后 webContents 不可访问）
  const winSession = view.webContents.session;

  // 注册窗口上下文（记录 providerId，未确定时为空字符串）
  windowState.addWindow(mainWindow, profileData.id, profileData.providerId || '', sessionStore, view);
  sessionsToFlush.add(winSession);

  // 更新主窗口引用
  windowState.setMainWindow(mainWindow);

  // 记录最后活跃的 profile，供下次启动恢复。
  // 创建时先记一次（覆盖首次启动无记录的情况），之后窗口获得焦点时更新。
  try { profileManager.setLastActiveProfileId(profileData.id); } catch (_) { /* ignore */ }
  mainWindow.on('focus', () => {
    try { profileManager.setLastActiveProfileId(profileData.id); } catch (_) { /* ignore */ }
  });

  // 初始化自动更新（仅第一个窗口时初始化）
  if (windowState.getAllWindows().length === 1) {
    updater.initAutoUpdater(mainWindow);
  }

  // 转发 AI 页面 console.log 到主进程，并按平台写入独立日志文件
  view.webContents.on('console-message', (_event: any, level: any, message: any, _line: any, _sourceId: any) => {
    console.log('[Renderer Console][' + profileData.name + ']', message);

    // 打包版不进行日志持久化
    if (!RENDERER_LOG_DIR) return;

    // 根据当前窗口上下文确定 providerId，未确定用 default
    let providerId = profileData.providerId || 'default';
    const ctx = windowState.getContextByWebContents(view.webContents);
    if (ctx && ctx.providerId) providerId = ctx.providerId;

    const logFile = path.join(RENDERER_LOG_DIR, providerId + '.log');
    const timeIso = new Date().toISOString();
    fs.appendFileSync(logFile, '[' + timeIso + '][' + profileData.name + '] ' + message + '\n', 'utf-8');
  });

  // 恢复最大化状态（若有记录且曾最大化）
  if (savedBounds && savedBounds.maximized) {
    mainWindow.maximize();
  }

  // 设置与 Electron 33（Chromium 130）匹配的普通 Chrome UA：
  // 1. 不带 Electron 标识，避免 DeepSeek 识别为第三方客户端
  // 2. 与内核版本一致，避免 Google OAuth 因 UA/sec-ch-ua 不一致报“浏览器不安全”
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  view.webContents.setUserAgent(userAgent);

  // 优先恢复上次关闭时的 URL（仅 http/https，且平台已确定）
  const lastUrl = profileData.lastUrl;
  console.log('[Cuckoo Code] 创建窗口: profile=' + profileData.id + ' providerChosen=' + providerChosen + ' lastUrl=' + (lastUrl || '(无)'));
  if (providerChosen && provider && lastUrl && /^https?:\/\//i.test(lastUrl)) {
    view.webContents.loadURL(lastUrl);
  } else if (providerChosen && provider) {
    // 平台已确定且存在，直接进入平台首页
    view.webContents.loadURL(provider.homeUrl);
  } else {
    // 平台未确定（或对应 provider 已缺失），显示平台选择页
    const selectPage = resolveSrc('ui/platform-select.html');
    view.webContents.loadFile(selectPage);
  }

  view.webContents.on('did-finish-load', () => {
    if (view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('page-loaded');
      sessionStore.tryRestoreSessionFromUrl(view);
      pushUrlState(view);
    }
  });

  view.webContents.on('did-navigate', (_event: any, url: string) => {
    sessionStore.handleUrlChange(url, view);
    pushUrlState(view);
    // 通知 AI 页面（overlay/看门狗）URL 已变，替代原先的渲染进程轮询
    try { view.webContents.send('cuckoo-url-changed', { url }); } catch (_) {}
  });

  view.webContents.on('did-navigate-in-page', (_event: any, url: string) => {
    sessionStore.handleUrlChange(url, view);
    pushUrlState(view);
    // SPA 路由（pushState）变化也在此触发，替代轮询
    try { view.webContents.send('cuckoo-url-changed', { url }); } catch (_) {}
  });

  view.webContents.on('before-input-event', (_event: any, input: any) => {
    if (input.key === 'F12') {
      view.webContents.toggleDevTools();
    }
  });

  // 关闭前记录窗口大小/位置（用 getNormalBounds 取"还原后"尺寸；closed 时窗口已销毁取不到）
  mainWindow.on('close', () => {
    try {
      if (mainWindow.isDestroyed()) return;
      const b = mainWindow.getNormalBounds();
      profileManager.setWindowBounds(profileData.id, {
        x: b.x, y: b.y, width: b.width, height: b.height,
        maximized: mainWindow.isMaximized(),
      });
      // 记录最后 URL（仅 http/https；view 可能已销毁）
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        const curUrl = view.webContents.getURL();
        console.log('[Cuckoo Code] 关闭窗口记录 lastUrl: profile=' + profileData.id + ' url=' + curUrl);
        profileManager.setLastUrl(profileData.id, curUrl);
      } else {
        console.log('[Cuckoo Code] 关闭窗口：view 已销毁，跳过记录 URL (profile=' + profileData.id + ')');
      }
    } catch (_) { /* ignore */ }
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
          click: (_item: any, focusedWindow: any) => {
            const ctx = focusedWindow ? windowState.getContextByWebContents(focusedWindow.webContents) : null;
            const view = ctx ? ctx.view : null;
            if (view && view.webContents.navigationHistory.canGoBack()) {
              view.webContents.navigationHistory.goBack();
            }
          }
        },
        {
          label: '前进',
          accelerator: 'Alt+Right',
          click: (_item: any, focusedWindow: any) => {
            const ctx = focusedWindow ? windowState.getContextByWebContents(focusedWindow.webContents) : null;
            const view = ctx ? ctx.view : null;
            if (view && view.webContents.navigationHistory.canGoForward()) {
              view.webContents.navigationHistory.goForward();
            }
          }
        },
        { type: 'separator' },
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: (_item: any, focusedWindow: any) => {
            const ctx = focusedWindow ? windowState.getContextByWebContents(focusedWindow.webContents) : null;
            const view = ctx ? ctx.view : null;
            if (view && view.webContents && !view.webContents.isDestroyed()) {
              view.webContents.reload();
            }
          }
        },
        {
          label: '停止加载',
          accelerator: 'Esc',
          click: (_item: any, focusedWindow: any) => {
            const ctx = focusedWindow ? windowState.getContextByWebContents(focusedWindow.webContents) : null;
            const view = ctx ? ctx.view : null;
            if (view && view.webContents && !view.webContents.isDestroyed()) {
              view.webContents.stop();
            }
          }
        },
        { type: 'separator' },
        {
          label: '主页',
          click: (_item: any, focusedWindow: any) => {
            if (!focusedWindow) return;
            const ctx = windowState.getContextByWebContents(focusedWindow.webContents);
            const view = ctx ? ctx.view : null;
            if (ctx && ctx.providerId && view && view.webContents && !view.webContents.isDestroyed()) {
              const provider = getProvider(ctx.providerId);
              if (provider) view.webContents.loadURL(provider.homeUrl);
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
ipcMainForProfile.handle('create-profile-window', async (_event: any, { providerId }: any = {}) => {
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
ipcMainForProfile.handle('delete-profile', async (_event: any, { profileId }: any) => {
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
  const { getAllProviders } = await import('../providers/registry.js');
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
ipcMainForProfile.handle('import-provider', async (event: any, { replace = false }: any = {}) => {
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
  const { importCustomProvider } = await import('../providers/custom/loader.js');
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
  } catch (err: any) {
    return { success: false, error: '加载失败: ' + err.message };
  }
});

// 删除自定义 Provider（先检查是否有窗口在使用）
ipcMainForProfile.handle('remove-provider', async (_event: any, { path: filePath, providerId }: any) => {
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

  const { removeCustomProviderPath } = await import('../providers/custom/loader.js');
  removeCustomProviderPath(filePath);
  return { success: true };
});

// 替换自定义 Provider（弹文件选择框，校验 id 一致后覆盖）
ipcMainForProfile.handle('replace-provider', async (event: any, { providerId }: any) => {
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
  const { replaceCustomProvider } = await import('../providers/custom/loader.js');
  try {
    const res = replaceCustomProvider(providerId, filePath);
    return { success: true, provider: { id: res.provider.id, name: res.provider.name, path: res.targetPath } };
  } catch (err: any) {
    return { success: false, error: '替换失败: ' + err.message };
  }
});

// 用户在平台选择页选择平台后，绑定 profile 并重建窗口（partition 必须随 profile 更新）
ipcMainForProfile.handle('select-platform', async (event: any, { providerId }: any) => {
  if (!providerId) return { success: false, error: '缺少平台ID' };
  const ctx = windowState.getContextByWebContents(event.sender);
  if (!ctx) return { success: false, error: '窗口上下文不存在' };

  const provider = getProvider(providerId);
  if (!provider) return { success: false, error: '平台不存在: ' + providerId };

  // 更新该窗口 profile 的 providerId 和 partition
  const updatedProfile = profileManager.updateProfileProvider(ctx.profileId, providerId);
  if (!updatedProfile) return { success: false, error: '更新 profile 失败' };
  // 切换平台：清掉旧平台的 lastUrl，避免用旧 URL 打开新平台
  profileManager.clearLastUrl(ctx.profileId);

  // 关闭旧窗口（其 session 仍是旧 partition）
  // 注意：这里销毁最后一个窗口会触发 window-all-closed，
  // 但紧接着会 createWindow 重建，故 window-all-closed 采用延迟确认避免误退。
  console.log('[Cuckoo Code] 切换平台: ' + ctx.providerId + ' -> ' + providerId + '，重建窗口');
  const oldWin = ctx.win;
  if (oldWin && !oldWin.isDestroyed()) {
    oldWin.destroy();
  }

  // 用新 profile（含新 partition）重建窗口
  createWindow(updatedProfile);
  console.log('[Cuckoo Code] 切换平台完成，当前窗口数=' + windowState.getAllWindows().length);
  return { success: true };
});

// 设置某 profile 是否"启动时默认打开"
ipcMainForProfile.handle('set-profile-auto-open', async (_event: any, { profileId, autoOpen }: any) => {
  if (!profileId) return { success: false, error: '缺少 profileId' };
  const p = profileManager.setAutoOpen(profileId, !!autoOpen);
  if (!p) return { success: false, error: '窗口不存在' };
  return { success: true };
});

// 打开指定 profile 的窗口（若已存在则聚焦）
ipcMainForProfile.handle('open-profile-window', async (_event: any, { profileId }: any) => {
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
ipcMainForProfile.handle('update-window-name', async (event: any, { displayName }: any) => {
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

// 列出所有 MCP server（含启用状态）
ipcMainForProfile.handle('list-mcp-servers', async () => {
  const servers = mcpConfig.getServers();
  const connected = new Set(mcpClient.getConnectedServers().map(s => s.name));
  console.log('[MCP DEBUG] servers:', JSON.stringify(servers.map(s => ({ name: s.name, enabled: s.enabled }))));
  console.log('[MCP DEBUG] connected:', JSON.stringify(Array.from(connected)));
  return { success: true, servers: servers.map(s => ({ ...s, connected: connected.has(s.name) })) };
});

// 添加或更新 MCP server 配置
ipcMainForProfile.handle('upsert-mcp-server', async (_event: any, { server }: any) => {
  if (!server || !server.name || !server.type) {
    return { success: false, error: 'server 配置不完整（需要 name 和 type）' };
  }
  mcpConfig.upsertServer(server);
  return { success: true };
});

// 删除 MCP server
ipcMainForProfile.handle('remove-mcp-server', async (_event: any, { name }: any) => {
  await mcpClient.disconnectServerByName(name);
  mcpConfig.removeServer(name);
  return { success: true };
});

// 启用 MCP server（连接并拉取工具）
ipcMainForProfile.handle('enable-mcp-server', async (_event: any, { name }: any) => {
  try {
    mcpConfig.setServerEnabled(name, true);
    await mcpClient.connectServerByName(name);
    console.log('[MCP DEBUG] enable 完成, connections:', JSON.stringify(Array.from(mcpClient.getConnectedServers().map(s => s.name))));
    return { success: true };
  } catch (err: any) {
    console.error('[MCP DEBUG] enable 失败:', err);
    return { success: false, error: err.message };
  }
});

// 禁用 MCP server（断开连接）
ipcMainForProfile.handle('disable-mcp-server', async (_event: any, { name }: any) => {
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
    // 启动时打开所有"默认打开"的窗口；若一个都没勾，回退默认（上次活跃的或第一个）
    const autoOpen = profileManager.getAutoOpenProfiles();
    if (autoOpen.length > 0) {
      console.log('[Cuckoo Code] 启动默认打开 ' + autoOpen.length + ' 个窗口');
      for (const p of autoOpen) createWindow(p);
    } else {
      createWindow(null);
    }

    // 后台连接已启用的 MCP server，不阻塞窗口创建
    mcpClient.connectEnabledServers().catch(err => {
      console.error('[MCP] 初始化连接失败:', err.message);
    });
  });
}

app.on('window-all-closed', () => {
  // 切换平台时会先销毁旧窗口（select-platform）再创建新窗口，
  // 这个间隙窗口数会短暂为 0，若直接 quit 会导致闪退。
  // 延迟确认：稍后仍无窗口才真正退出。
  setTimeout(() => {
    if (windowState.getAllWindows().length === 0) {
      app.quit();
    }
  }, 500);
});

// 退出前刷新所有 session 数据
let quitFlushed = false;
app.on('before-quit', (event: any) => {
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

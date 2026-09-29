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
import { computeViewBounds, SHELL_LAYOUT } from './layout.js';
import { decideViewKeyAction } from './shortcuts.js';

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
import { injectSubagentDeps, runAgent as runAgentImpl } from './subagent.js';
import { injectAgentRunner } from '../tools/impl/run-agent.js';
import { pushUrlState, applyZoom } from './ipc/shell.js';

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
    // 无边框窗口（CherryStudio 式）：macOS 隐藏原生标题栏、红绿灯内嵌常驻标题栏。
    // trafficLightPosition.y 是红绿灯容器顶边相对窗口顶部的偏移；42px 标题栏下
    // 取 15 是实测最佳值（视觉居中，14 略偏上、16 明显偏下）。
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 13, y: 15 } }
      : { frame: false }),
    autoHideMenuBar: true,
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

  // 子代理配置：序列化后经 additionalArguments 传给 bridge（供子代理窗口自识别）
  const subagentArg = profileData.subagentConfig
    ? '--cuckoo-subagent=' + encodeURIComponent(JSON.stringify(profileData.subagentConfig))
    : null;

  // AI 页面视图（复用现有 bridge preload；与壳共用 partition）
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(import.meta.dirname, '..', 'bridge', 'entry.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: profileData.partition,
      backgroundThrottling: false,
      additionalArguments: subagentArg
        ? ['--cuckoo-user-data=' + app.getPath('userData'), subagentArg]
        : ['--cuckoo-user-data=' + app.getPath('userData')],
    },
  });
  mainWindow.contentView.addChildView(view);

  // 布局：常驻标题栏 42 + 左图标栏 52 + 面板 280×开关 + 圆角卡片边距 10（见 src/app/layout.ts）；
  // 导航条为浮层，默认不占高，滑出时临时下移 view（ctx.topbarVisible）
  view.setBorderRadius(SHELL_LAYOUT.CARD_RADIUS);
  const layoutView = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [w, h] = mainWindow.getContentSize();
    const ctx = windowState.getWindowContext(mainWindow.id);
    const panelOpen = !!(ctx && ctx.panelId);
    const topbarVisible = !!(ctx && ctx.topbarVisible);
    view.setBounds(computeViewBounds(w, h, panelOpen, topbarVisible));
  };
  layoutView();
  mainWindow.on('resize', layoutView);

  // 加载地址栏壳页面；壳就绪后主动推一次当前 URL 状态（避免与 view 加载竞态）
  mainWindow.loadFile(resolveSrc('ui/shell.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    pushUrlState(view);
    // 回放面板状态 + 项目目录：壳页面重载后其 UI 状态丢失，需与主进程 ctx.panelId 重新对齐
    try {
      const ctx = windowState.getWindowContext(mainWindow.id);
      mainWindow.webContents.send('shell-panel-restore', {
        panelId: (ctx && ctx.panelId) || null,
        // 导航条滑出期间壳重载会丢 .visible 类但主进程仍留着 view 下移的 44px 死区，一并回放
        topbarVisible: !!(ctx && ctx.topbarVisible),
      });
      const dir = (ctx && ctx.sessionStore && ctx.sessionStore.state.selectedProjectDir) || null;
      mainWindow.webContents.send('shell-project-dir-updated', dir);
    } catch (_) {}
  });

  // 保存 session 引用（窗口销毁后 webContents 不可访问）
  const winSession = view.webContents.session;

  // 注册窗口上下文（记录 providerId，未确定时为空字符串）
  windowState.addWindow(mainWindow, profileData.id, profileData.providerId || '', sessionStore, view);
  // 面板开关变化时由 shell-panel-state IPC 触发重排
  const selfCtx = windowState.getWindowContext(mainWindow.id);
  if (selfCtx) {
    selfCtx.panelId = null;
    selfCtx.relayout = layoutView;
  }
  sessionsToFlush.add(winSession);

  // 更新主窗口引用
  windowState.setMainWindow(mainWindow);

  // 记录最后活跃的 profile，供下次启动恢复。
  // 子代理窗口跳过（临时 profile，不参与"上次活跃"恢复）。
  if (!profileData.isSubagent) {
    try { profileManager.setLastActiveProfileId(profileData.id); } catch (_) { /* ignore */ }
    mainWindow.on('focus', () => {
      try { profileManager.setLastActiveProfileId(profileData.id); } catch (_) { /* ignore */ }
    });
  }

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

  // 项目目录确定后，异步自动连该项目的 MCP（不阻塞导航/窗口）
  const autoConnectMcp = () => {
    try {
      const dir = (sessionStore && sessionStore.state && sessionStore.state.selectedProjectDir) || null;
      mcpClient.autoConnectForWindow(mainWindow.id, dir);
    } catch (_) {}
  };

  view.webContents.on('did-finish-load', () => {
    if (view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('page-loaded');
      sessionStore.tryRestoreSessionFromUrl(view);
      pushUrlState(view);
      autoConnectMcp();
    }
  });

  view.webContents.on('did-navigate', (_event: any, url: string) => {
    sessionStore.handleUrlChange(url, view);
    pushUrlState(view);
    // 通知 AI 页面（overlay/看门狗）URL 已变，替代原先的渲染进程轮询
    try { view.webContents.send('cuckoo-url-changed', { url }); } catch (_) {}
    autoConnectMcp();
  });

  view.webContents.on('did-navigate-in-page', (_event: any, url: string) => {
    sessionStore.handleUrlChange(url, view);
    pushUrlState(view);
    // SPA 路由（pushState）变化也在此触发，替代轮询
    try { view.webContents.send('cuckoo-url-changed', { url }); } catch (_) {}
    autoConnectMcp();
  });

  view.webContents.on('before-input-event', (event: any, input: any) => {
    if (input.key === 'F12') {
      view.webContents.toggleDevTools();
      return;
    }
    if (input.type !== 'keyDown') return;
    // 原 overlay 快捷键迁入 shell（Task 10）：AI 页面聚焦时按键落在 view，
    // 判定为壳动作（面板切换/收起、Ctrl+L 唤出导航条聚焦 URL）则 relay 给壳页面
    // 并 preventDefault——否则会与菜单「停止加载」（曾占 Esc 加速器）或页面自身行为叠加触发。
    const ctx = windowState.getContextByWebContents(view.webContents);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
    const action = decideViewKeyAction(input, ctx.panelId || null);
    if (!action) return;
    event.preventDefault();
    // 缩放快捷键：主进程直接应用（view 是 AI 页面本体，无需经壳页面中转）
    if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') {
      applyZoom(ctx, action === 'zoom-in' ? 'in' : action === 'zoom-out' ? 'out' : 'reset');
      return;
    }
    const channel = action === 'toggle-panel' ? 'shell-toggle-panel'
      : action === 'close-panel' ? 'shell-close-panel'
      : 'shell-focus-url';
    ctx.win.webContents.send(channel);
  });

  // 关闭前记录窗口大小/位置（用 getNormalBounds 取"还原后"尺寸；closed 时窗口已销毁取不到）
  mainWindow.on('close', () => {
    if (profileData.isSubagent) return; // 子代理窗口不记录
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
    // 释放该窗口持有的 MCP 连接引用 + 清理自动连记录
    try { mcpClient.forgetWindow(mainWindow.id); } catch (_) {}
  });

  return mainWindow.id;
}

// ========== 子代理窗口 ==========
/**
 * 创建子代理窗口（复用父窗口 partition → 免登录 + token 计入同一"窗口"）。
 * @param parentProfileId 父窗口 profile id
 * @param agentName 代理名（用于窗口标题）
 * @returns 子代理窗口的 windowId
 */
function createSubagentWindow(parentProfileId: string, agentName: string): number {
  const parent = profileManager.getProfileById(parentProfileId);
  if (!parent) throw new Error('父 profile 不存在: ' + parentProfileId);
  const sub = profileManager.createSubagentProfile(parent, agentName);
  return createWindow(sub);
}

// ========== 应用菜单 ==========
// 菜单「查看 → 缩放」作用于 AI 页面 view（而不是聚焦的壳页面 webContents，缩放壳 UI 无意义）。
// 快捷键不走菜单加速器：AI 页面聚焦时由 before-input-event 直接应用，壳页面聚焦时由 shell.js 处理。
function zoomFocusedWindow(focusedWindow: any, action: 'in' | 'out' | 'reset') {
  if (!focusedWindow) return;
  const ctx = windowState.getContextByWebContents(focusedWindow.webContents);
  if (ctx) applyZoom(ctx, action);
}

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
          // 不配 Esc 加速器：Esc 已用于收起侧面板（view 侧 before-input-event 拦截，
          // 壳聚焦时走页面 keydown）。加速器会在面板收起的同时误触发 stop()，
          // 且壳页面聚焦时先消费 Esc 导致收起失效。停止加载仍可点此菜单项。
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
        {
          label: '重置缩放',
          click: (_item: any, focusedWindow: any) => zoomFocusedWindow(focusedWindow, 'reset'),
        },
        {
          label: '放大',
          click: (_item: any, focusedWindow: any) => zoomFocusedWindow(focusedWindow, 'in'),
        },
        {
          label: '缩小',
          click: (_item: any, focusedWindow: any) => zoomFocusedWindow(focusedWindow, 'out'),
        },
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

// ========== 子代理依赖注入 ==========
injectSubagentDeps({ createWindow, profileManager });
// 给 runAgent 工具注入执行器（tools 层不依赖 app）
injectAgentRunner(async ({ agent, task, currentWindowId }: any) => {
  const ctx = windowState.getWindowContext(currentWindowId);
  if (!ctx) throw new Error('父窗口上下文不存在');
  return runAgentImpl({
    parentProfileId: ctx.profileId,
    parentWindowId: currentWindowId,
    agentName: agent.name,
    task,
    systemPrompt: agent.systemPrompt,
    tools: agent.tools,
    maxTurns: agent.maxTurns,
  });
});

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

// 取事件来源窗口的 projectDir
function getProjectDirOfEvent(event: any): string | null {
  try {
    const ctx = windowState.getContextByWebContents(event.sender);
    return (ctx && ctx.sessionStore && ctx.sessionStore.state.selectedProjectDir) || null;
  } catch (_) { return null; }
}

// 列出所有 MCP server（含启用状态）。scope='user' 时只返回用户级（供 UI JSON 编辑框）
ipcMainForProfile.handle('list-mcp-servers', async (event: any, opts: any = {}) => {
  if (opts && opts.scope === 'user') {
    return { success: true, servers: mcpConfig.getUserServers() };
  }
  const projectDir = getProjectDirOfEvent(event);
  const servers = mcpClient.listConfiguredServers(projectDir);
  return { success: true, servers };
});

// 添加或更新 MCP server 配置（固定写用户级）
ipcMainForProfile.handle('upsert-mcp-server', async (_event: any, { server }: any) => {
  if (!server || !server.name || !server.type) {
    return { success: false, error: 'server 配置不完整（需要 name 和 type）' };
  }
  mcpConfig.upsertServer(server);
  return { success: true };
});

// 删除 MCP server
ipcMainForProfile.handle('remove-mcp-server', async (event: any, { name }: any) => {
  const projectDir = getProjectDirOfEvent(event);
  // 断开可能存在的连接
  await mcpClient.disconnectAll().catch(() => {});
  mcpConfig.removeServer(name);
  return { success: true };
});

// 启用 MCP server（连接并拉取工具）
ipcMainForProfile.handle('enable-mcp-server', async (event: any, { name }: any) => {
  try {
    const projectDir = getProjectDirOfEvent(event);
    mcpConfig.setServerEnabled(name, true, projectDir);
    await mcpClient.connectServerByName(name, projectDir, null);
    return { success: true };
  } catch (err: any) {
    console.error('[MCP] enable 失败:', err);
    return { success: false, error: err.message };
  }
});

// 禁用 MCP server（断开连接）
ipcMainForProfile.handle('disable-mcp-server', async (event: any, { name }: any) => {
  const projectDir = getProjectDirOfEvent(event);
  mcpConfig.setServerEnabled(name, false, projectDir);
  // 简单处理：断开该 server 可能存在的连接（引用清零后由空闲计时断开）
  await mcpClient.disconnectAll().catch(() => {});
  return { success: true };
});

// 获取已启用 server 的工具列表（用于注入提示词）
ipcMainForProfile.handle('get-mcp-tools', async (event: any) => {
  const projectDir = getProjectDirOfEvent(event);
  const servers = mcpClient.listConfiguredServers(projectDir);
  const tools: any[] = [];
  for (const s of servers) {
    if (!s.connected) continue;
    try {
      const list = await mcpClient.getToolsByServer(s.name, projectDir);
      for (const t of list) tools.push({ server: s.name, ...t });
    } catch (_) {}
  }
  return { success: true, tools };
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
    // MCP 配置首次迁移（旧 userData/mcp.json → ~/.cuckoo/mcp.json，旧文件保留）
    try { mcpConfig.migrateLegacy(); } catch (_) { /* ignore */ }
    // 启动时打开所有"默认打开"的窗口；若一个都没勾，回退默认（上次活跃的或第一个）
    const autoOpen = profileManager.getAutoOpenProfiles();
    if (autoOpen.length > 0) {
      console.log('[Cuckoo Code] 启动默认打开 ' + autoOpen.length + ' 个窗口');
      for (const p of autoOpen) createWindow(p);
    } else {
      createWindow(null);
    }

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

// 退出前刷新所有 session 数据 + 断开所有 MCP 连接
let quitFlushed = false;
app.on('before-quit', (event: any) => {
  if (quitFlushed) return;
  event.preventDefault();
  quitFlushed = true;
  Promise.all([
    flushAllSessions().catch(() => {}),
    mcpClient.disconnectAll().catch(() => {}),
  ]).finally(() => {
    app.quit();
  });
});

app.on('activate', () => {
  if (windowState.getAllWindows().length === 0) {
    createWindow(null);
  }
});

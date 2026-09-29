/**
 * 地址栏壳页面 preload（与 AI 页面 preload 分离）
 * 暴露 window.shellAPI：导航控制 + 地址变化订阅。不能有顶层 await（P3a 教训）。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron');

const shellAPI = {
  // 运行平台（壳页面据此决定 mac 红绿灯留白 / win32 自绘窗口控制按钮）
  platform: process.platform,
  navigate: (url: string) => ipcRenderer.invoke('shell-navigate', { url }),
  back: () => ipcRenderer.invoke('shell-back'),
  forward: () => ipcRenderer.invoke('shell-forward'),
  reload: () => ipcRenderer.invoke('shell-reload'),
  home: () => ipcRenderer.invoke('shell-home'),
  setPanelOpen: (panelId: string | null) => ipcRenderer.invoke('shell-panel-state', { panelId }),
  // 导航条浮层开关：主进程据此临时下移/恢复 view（WebContentsView 原生层级高于壳 DOM）
  setTopbarVisible: (visible: boolean) => ipcRenderer.invoke('shell-topbar-visible', { visible }),
  // 无边框窗口自绘控制按钮（仅 win32 渲染；macOS 用系统红绿灯）
  windowMinimize: () => ipcRenderer.invoke('shell-window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('shell-window-maximize'),
  windowClose: () => ipcRenderer.invoke('shell-window-close'),
  // 视图缩放（标题栏按钮 / Ctrl+Cmd +/-/0 共用）：'in' | 'out' | 'reset'
  zoom: (action: string) => ipcRenderer.invoke('shell-zoom', { action }),
  getZoom: () => ipcRenderer.invoke('shell-zoom-get'),
  onZoomUpdated: (cb: (data: any) => void) => {
    ipcRenderer.on('shell-zoom-updated', (_e: any, data: any) => cb(data));
  },
  // 弹出缩放 mini 菜单（原生子窗口，层级高于 AI 页面 view）；rect = 按钮相对视口位置
  openZoomMenu: (rect: any) => ipcRenderer.invoke('shell-zoom-menu-open', { rect }),
  onUrlUpdated: (cb: (data: any) => void) => {
    ipcRenderer.on('shell-url-updated', (_e: any, data: any) => cb(data));
  },
  onTokenUpdated: (cb: (data: any) => void) => {
    ipcRenderer.on('shell-token-updated', (_e: any, data: any) => cb(data));
  },
  onTotalUpdated: (cb: (data: any) => void) => {
    ipcRenderer.on('shell-total-updated', (_e: any, data: any) => cb(data));
  },
  getSystemTotal: () => ipcRenderer.invoke('get-system-total'),
  // ===== 会话面板（通道 handler 用 event.sender 反查窗口，shell webContents 可被命中）=====
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  navigateSession: (sessionId: string) => ipcRenderer.invoke('navigate-session', { sessionId }),
  // ===== 窗口面板（profile 管理通道均不依赖 sender，直接可用）=====
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  listProviders: () => ipcRenderer.invoke('list-providers'),
  openProfileWindow: (profileId: string) => ipcRenderer.invoke('open-profile-window', { profileId }),
  setProfileAutoOpen: (profileId: string, autoOpen: boolean) =>
    ipcRenderer.invoke('set-profile-auto-open', { profileId, autoOpen }),
  deleteProfileWindow: (profileId: string) => ipcRenderer.invoke('delete-profile', { profileId }),
  createProfileWindow: () => ipcRenderer.invoke('create-profile-window'),
  // ===== MCP 面板（handler 用 event.sender 反查窗口取 projectDir，shell webContents 可被命中）=====
  listMcpServers: (opts?: any) => ipcRenderer.invoke('list-mcp-servers', opts || {}),
  upsertMcpServer: (server: any) => ipcRenderer.invoke('upsert-mcp-server', { server }),
  removeMcpServer: (name: string) => ipcRenderer.invoke('remove-mcp-server', { name }),
  enableMcpServer: (name: string) => ipcRenderer.invoke('enable-mcp-server', { name }),
  disableMcpServer: (name: string) => ipcRenderer.invoke('disable-mcp-server', { name }),
  getMcpTools: () => ipcRenderer.invoke('get-mcp-tools'),
  // ===== 设置面板（主进程 settings.json 存储；settings-changed 广播由主进程发向 AI 页面 view）=====
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSettings: (patch: any) => ipcRenderer.invoke('settings-set', { patch }),
  resetSettings: () => ipcRenderer.invoke('settings-reset'),
  // 「刷新技能与代理」（handler 用 event.sender 反查窗口取 projectDir，shell webContents 可被命中）
  refreshSkills: () => ipcRenderer.invoke('refresh-skills'),
  // 壳页面 → 主进程 → AI 页面 view → bridge preload 的 sendToChat
  sendToChat: (msg: string, tag?: string, delayMs?: number) =>
    ipcRenderer.invoke('shell-send-to-chat', { msg, tag, delayMs }),
  // ===== 任务面板（工具活动历史存主进程内存，按窗口隔离）=====
  // 打开面板时拉全量（增量转发发生在面板打开前的部分靠这个补全）
  getToolHistory: () => ipcRenderer.invoke('shell-get-tool-history'),
  clearToolHistory: () => ipcRenderer.invoke('shell-clear-tool-history'),
  // AI 页面 executor 上报的增量条目（同 id 从 running 更新为 done）
  onToolActivity: (cb: (entry: any) => void) => {
    ipcRenderer.on('shell-tool-activity', (_e: any, entry: any) => cb(entry));
  },
  // ===== 项目面板 =====
  // init-project / updateProjectDir 的 handler 用 event.sender 反查窗口，shell webContents 可被命中
  initProject: () => ipcRenderer.invoke('init-project', {}),
  updateProjectDir: () => ipcRenderer.invoke('init-project', { skipPrompt: true }),
  getProjectDir: () => ipcRenderer.invoke('get-project-dir'),
  // 压缩上下文：relay 到 AI 页面执行 runCompaction（清 IDB + 刷新必须在页面侧做）
  compact: () => ipcRenderer.invoke('shell-compact'),
  // 主进程转发的目录更新（AI 页面 project-dir-updated 的壳侧副本）
  onProjectDirUpdated: (cb: (dirPath: string | null) => void) => {
    ipcRenderer.on('shell-project-dir-updated', (_e: any, dirPath: any) => cb(dirPath || null));
  },
  // 壳页面 did-finish-load 后主进程回放面板状态（修复壳重载后面板状态脱钩）
  onPanelRestore: (cb: (data: any) => void) => {
    ipcRenderer.on('shell-panel-restore', (_e: any, data: any) => cb(data));
  },
  // 快捷键 relay：AI 页面聚焦时 Ctrl+Shift+C / Esc / Ctrl+L 由主进程 before-input-event 转发到壳
  onTogglePanel: (cb: () => void) => {
    ipcRenderer.on('shell-toggle-panel', () => cb());
  },
  onClosePanel: (cb: () => void) => {
    ipcRenderer.on('shell-close-panel', () => cb());
  },
  // Ctrl+L relay：唤出导航条并聚焦 URL 输入框
  onFocusUrl: (cb: () => void) => {
    ipcRenderer.on('shell-focus-url', () => cb());
  },
};

try {
  contextBridge.exposeInMainWorld('shellAPI', shellAPI);
} catch (err) {
  console.error('[Cuckoo Shell] contextBridge 失败:', err);
}
(window as any).shellAPI = shellAPI;

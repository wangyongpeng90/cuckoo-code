/**
 * 地址栏壳页面 preload（与 AI 页面 preload 分离）
 * 暴露 window.shellAPI：导航控制 + 地址变化订阅。不能有顶层 await（P3a 教训）。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron');

const shellAPI = {
  navigate: (url: string) => ipcRenderer.invoke('shell-navigate', { url }),
  back: () => ipcRenderer.invoke('shell-back'),
  forward: () => ipcRenderer.invoke('shell-forward'),
  reload: () => ipcRenderer.invoke('shell-reload'),
  home: () => ipcRenderer.invoke('shell-home'),
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
  toggleHarness: () => ipcRenderer.invoke('harness-toggle'),
  getProjectDir: () => ipcRenderer.invoke('get-project-dir'),
  // 点击"项目目录" → 弹目录选择框 + 重新初始化（复用 init-project 通道）
  initProject: () => ipcRenderer.invoke('init-project', {}),
  onProjectDir: (cb: (dir: string | null) => void) => {
    ipcRenderer.on('shell-project-dir', (_e: any, dir: any) => cb(dir));
  },
  toggleSidebar: (width: number) => ipcRenderer.invoke('shell-toggle-sidebar', { width }),
  // ========== 窗口管理 ==========
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  listProviders: () => ipcRenderer.invoke('list-providers'),
  createProfileWindow: (providerId?: string) => ipcRenderer.invoke('create-profile-window', { providerId }),
  openProfileWindow: (profileId: string) => ipcRenderer.invoke('open-profile-window', { profileId }),
  deleteProfileWindow: (profileId: string) => ipcRenderer.invoke('delete-profile', { profileId }),
  setProfileAutoOpen: (profileId: string, autoOpen: boolean) => ipcRenderer.invoke('set-profile-auto-open', { profileId, autoOpen }),
  // ========== 快捷提示词 ==========
  listSnippets: () => ipcRenderer.invoke('list-snippets'),
  saveSnippets: (snippets: any) => ipcRenderer.invoke('save-snippets', { snippets }),
  triggerSnippet: (content: string, autoSend: boolean) => ipcRenderer.invoke('trigger-snippet', { content, autoSend }),
  onSnippetsChanged: (cb: () => void) => {
    ipcRenderer.on('shell-snippets-changed', () => cb());
  },
  onPlatformMode: (cb: (data: any) => void) => {
    ipcRenderer.on('shell-platform-mode', (_e: any, data: any) => cb(data));
  },
  // ========== 技能 ==========
  listSkills: () => ipcRenderer.invoke('list-skills'),
  listAppSkills: () => ipcRenderer.invoke('list-app-skills'),
  upsertSkill: (skill: any) => ipcRenderer.invoke('upsert-skill', { skill }),
  removeSkill: (id: any) => ipcRenderer.invoke('remove-skill', { id }),
  setSkillEnabled: (id: any, enabled: any) => ipcRenderer.invoke('set-skill-enabled', { id, enabled }),
  searchSkills: (keyword: any, page: any, pageSize: any) => ipcRenderer.invoke('search-skills', { keyword, page, pageSize }),
  getSkillDetail: (slug: any, namespace: any) => ipcRenderer.invoke('get-skill-detail', { slug, namespace }),
  installSkill: (slug: any, namespace: any) => ipcRenderer.invoke('install-skill', { slug, namespace }),
  // ========== MCP ==========
  listMcpServers: () => ipcRenderer.invoke('list-mcp-servers', {}),
  enableMcpServer: (name: string) => ipcRenderer.invoke('enable-mcp-server', { name }),
  disableMcpServer: (name: string) => ipcRenderer.invoke('disable-mcp-server', { name }),
  appendSnippet: (text: string) => ipcRenderer.invoke('append-to-input', { text }),
  // ========== 关于 ==========
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  getAssetUrl: (rel: string) => ipcRenderer.invoke('get-asset-url', { rel }),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', { url }),
  openFeishuSetup: () => ipcRenderer.invoke('open-feishu-setup'),
  // ========== 飞书同步 ==========
  getFeishuConfig: () => ipcRenderer.invoke('feishu-get-config'),
  saveFeishuConfig: (data: any) => ipcRenderer.invoke('feishu-save-config', { data }),
  reconnectFeishu: () => ipcRenderer.invoke('feishu-reconnect'),
  disconnectFeishu: () => ipcRenderer.invoke('feishu-disconnect'),
  listFeishuChats: () => ipcRenderer.invoke('feishu-list-chats'),
  getFeishuBinding: () => ipcRenderer.invoke('feishu-get-binding'),
  bindFeishuChat: (chatId: string, chatName: string) => ipcRenderer.invoke('feishu-bind-chat', { chatId, chatName }),
  // ========== 自动压缩 ==========
  getAutoCompact: () => ipcRenderer.invoke('get-autocompact'),
  saveAutoCompact: (data: any) => ipcRenderer.invoke('save-autocompact', { data }),
  triggerCompact: () => ipcRenderer.invoke('trigger-compact'),
  // ========== 设置 ==========
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data: any) => ipcRenderer.invoke('save-settings', { data }),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
};

try {
  contextBridge.exposeInMainWorld('shellAPI', shellAPI);
} catch (err) {
  console.error('[Cuckoo Shell] contextBridge 失败:', err);
}
(window as any).shellAPI = shellAPI;

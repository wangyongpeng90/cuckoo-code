/**
 * 暴露给渲染进程的 API（contextBridge + window 兜底）
 * 由原 preload.js 拆分而来，行为保持不变。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron');

// ========== 暴露给渲染进程的 API ==========
// 尝试 contextBridge，如果失败则直接挂载到 window（作为 fallback）
let electronAPI: any = {
  executeCommand: (command: any, id: any) => {
    return ipcRenderer.invoke('execute-command', { command, id });
  },
  initProject: (projectDir: any, isCompaction: any) => {
    return ipcRenderer.invoke('init-project', {
      skipPrompt: false,
      projectDir: projectDir || null,
      isCompaction: !!isCompaction,
    });
  },
  updateProjectDir: () => {
    return ipcRenderer.invoke('init-project', { skipPrompt: true });
  },
  executeTool: (toolName: any, params: any, callId: any) => {
    return ipcRenderer.invoke('execute-tool', { toolName, params, callId });
  },
  executeJs: (code: any, callId: any) => {
    // 附件上传间隔（毫秒），随 JS 执行一并传给主进程的 attachFile 工具
    let attachDelayMin, attachDelayMax;
    try {
      const mn = parseInt(localStorage.getItem('cuckoo-attach-delay-min') as string, 10);
      const mx = parseInt(localStorage.getItem('cuckoo-attach-delay-max') as string, 10);
      if (Number.isFinite(mn)) attachDelayMin = mn;
      if (Number.isFinite(mx)) attachDelayMax = mx;
    } catch (_) {}
    return ipcRenderer.invoke('execute-js', { code, callId, attachDelayMin, attachDelayMax });
  },
  sendEnterToChat: () => {
    return ipcRenderer.invoke('chat-send-enter');
  },
  simulateMouse: (action: any, x: any, y: any) => {
    return ipcRenderer.invoke('simulate-mouse', { action, x, y });
  },
  listSessions: () => {
    return ipcRenderer.invoke('list-sessions');
  },
  navigateSession: (sessionId: any) => {
    return ipcRenderer.invoke('navigate-session', { sessionId });
  },
  createProfileWindow: () => {
    return ipcRenderer.invoke('create-profile-window');
  },
  listProfiles: () => {
    return ipcRenderer.invoke('list-profiles');
  },
  openProfileWindow: (profileId: any) => {
    return ipcRenderer.invoke('open-profile-window', { profileId });
  },
  setProfileAutoOpen: (profileId: any, autoOpen: any) => {
    return ipcRenderer.invoke('set-profile-auto-open', { profileId, autoOpen });
  },
  deleteProfileWindow: (profileId: any) => {
    return ipcRenderer.invoke('delete-profile', { profileId });
  },
  updateWindowName: (displayName: any) => {
    return ipcRenderer.invoke('update-window-name', { displayName });
  },
  showAiNotification: () => {
    return ipcRenderer.invoke('show-ai-notification');
  },
  updateTokenUsage: (context: any, cumulative: any, windowCumulative: any, todayCumulative: any) => {
    return ipcRenderer.invoke('update-token-usage', { context, cumulative, windowCumulative, todayCumulative });
  },
  // 性能探针上报（开发版写日志）
  reportPerf: (tag: any, data: any) => {
    return ipcRenderer.invoke('perf-report', { tag, data });
  },
  // ========== 技能相关 API ==========
  refreshSkills: () => {
    return ipcRenderer.invoke('refresh-skills');
  },
  // ========== MCP 相关 API ==========
  listMcpServers: () => {
    return ipcRenderer.invoke('list-mcp-servers');
  },
  upsertMcpServer: (server: any) => {
    return ipcRenderer.invoke('upsert-mcp-server', { server });
  },
  removeMcpServer: (name: any) => {
    return ipcRenderer.invoke('remove-mcp-server', { name });
  },
  enableMcpServer: (name: any) => {
    return ipcRenderer.invoke('enable-mcp-server', { name });
  },
  disableMcpServer: (name: any) => {
    return ipcRenderer.invoke('disable-mcp-server', { name });
  },
  getMcpTools: () => {
    return ipcRenderer.invoke('get-mcp-tools');
  },
  // ========== 平台相关 API ==========
  listProviders: () => {
    return ipcRenderer.invoke('list-providers');
  },
  selectPlatform: (providerId: any) => {
    return ipcRenderer.invoke('select-platform', { providerId });
  },
  createProfileWindowWithProvider: (providerId: any) => {
    return ipcRenderer.invoke('create-profile-window', { providerId });
  },
  importProvider: () => {
    return ipcRenderer.invoke('import-provider');
  },
  removeProvider: (filePath: any, providerId: any) => {
    return ipcRenderer.invoke('remove-provider', { path: filePath, providerId });
  },
  replaceProvider: (providerId: any) => {
    return ipcRenderer.invoke('replace-provider', { providerId });
  },
};

try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} catch (err) {
  console.error('[Cuckoo Code] contextBridge.exposeInMainWorld 失败:', err);
}

// 无论 contextBridge 是否成功，都直接挂载到 window 作为备选
(window as any).electronAPI = electronAPI;

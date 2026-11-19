/**
 * [261109-8ms69z-cuko-api] Cuko 独立窗口 Preload 脚本
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cukoAPI', {
  getConfig: () => ipcRenderer.invoke('cuko:get-config'),
  saveConfig: (config: Record<string, string>) => ipcRenderer.invoke('cuko:save-config', config),
  
  listProviders: () => ipcRenderer.invoke('cuko:list-providers'),
  saveProvider: (provider: any) => ipcRenderer.invoke('cuko:save-provider', provider),
  deleteProvider: (id: string) => ipcRenderer.invoke('cuko:delete-provider', id),
  getActive: () => ipcRenderer.invoke('cuko:get-active'),
  setActive: (providerId: string, modelId: string) => ipcRenderer.invoke('cuko:set-active', providerId, modelId),
  
  listSessions: () => ipcRenderer.invoke('cuko:list-sessions'),
  getSystemPrompt: (sessionId: string) => ipcRenderer.invoke('cuko:get-system-prompt', sessionId),
  createSession: (sessionId: string, providerId?: string, modelId?: string, projectDir?: string) => ipcRenderer.invoke('cuko:create-session', sessionId, providerId, modelId, projectDir),
  renameSession: (sessionId: string, title: string) => ipcRenderer.invoke('cuko:rename-session', sessionId, title),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('cuko:delete-session', sessionId),
  listWorkspaces: () => ipcRenderer.invoke('cuko:list-workspaces'),
  addWorkspace: (path: string, name: string) => ipcRenderer.invoke('cuko:add-workspace', path, name),
  renameWorkspace: (path: string, name: string) => ipcRenderer.invoke('cuko:rename-workspace', path, name),
  openWorkspaceFolder: (path: string) => ipcRenderer.invoke('cuko:open-workspace-folder', path),
  getActiveWorkspace: () => ipcRenderer.invoke('cuko:get-active-workspace'),
  setActiveWorkspace: (path: string) => ipcRenderer.invoke('cuko:set-active-workspace', path),
  selectDirectory: () => ipcRenderer.invoke('cuko:select-directory'),
  buildSystemPrompt: (projectDir: string) => ipcRenderer.invoke('cuko:build-system-prompt', projectDir),
  executeJs: (code: string, projectDir: string) => ipcRenderer.invoke('cuko:execute-js', code, projectDir),
  pickResultPhrase: (n: number) => ipcRenderer.invoke('cuko:pick-result-phrase', n),
  updateProviderId: (sessionId: string, providerId: string) => ipcRenderer.invoke('cuko:update-provider-id', sessionId, providerId),
  updateSessionModel: (sessionId: string, providerId: string, modelId: string) => ipcRenderer.invoke('cuko:update-session-model', sessionId, providerId, modelId),
  updateSessionProject: (sessionId: string, projectDir: string) => ipcRenderer.invoke('cuko:update-session-project', sessionId, projectDir),
  archiveSession: (sessionId: string) => ipcRenderer.invoke('cuko:archive-session', sessionId),
  unarchiveSession: (sessionId: string) => ipcRenderer.invoke('cuko:unarchive-session', sessionId),
  archiveWorkspace: (path: string) => ipcRenderer.invoke('cuko:archive-workspace', path),
  unarchiveWorkspace: (path: string) => ipcRenderer.invoke('cuko:unarchive-workspace', path),
  
  getMessages: (sessionId: string) => ipcRenderer.invoke('cuko:get-messages', sessionId),
  saveMessage: (msg: any) => ipcRenderer.invoke('cuko:save-message', msg),
  saveAttachments: (sessionId: string, messageId: string, files: any[]) => ipcRenderer.invoke('cuko:save-attachments', sessionId, messageId, files),
  readAttachment: (relPath: string) => ipcRenderer.invoke('cuko:read-attachment', relPath),

  // ====== 后台运行（主进程跑，窗口关掉也继续） ======
  startRun: (params: any) => ipcRenderer.invoke('cuko:start-run', params),
  switchModel: (params: any) => ipcRenderer.invoke('cuko:switch-model', params),
  cancelRun: (sessionId: string) => ipcRenderer.invoke('cuko:cancel-run', sessionId),
  getRuns: () => ipcRenderer.invoke('cuko:get-runs'),
  subscribeRuns: () => ipcRenderer.invoke('cuko:subscribe-runs'),
  onRunEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('cuko:run-event', (_e: any, ev: any) => cb(ev));
  },
});

const shellAPI = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data: any) => ipcRenderer.invoke('save-settings', { data }),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  getPromptTemplate: (providerId: string) => ipcRenderer.invoke('get-prompt-template', { providerId }),
  saveSharedSettings: (data: any) => ipcRenderer.invoke('save-shared-settings', { data }),
  resetSharedSettings: (keys: string[]) => ipcRenderer.invoke('reset-shared-settings', { keys }),
  getLogInfo: () => ipcRenderer.invoke('get-log-info'),
  themeGet: () => ipcRenderer.invoke('theme-get'),
  themeSubscribe: () => ipcRenderer.invoke('theme-subscribe'),
  onThemeChanged: (cb: (snapshot: any) => void) => {
    ipcRenderer.on('theme-changed', (_e: any, snap: any) => cb(snap));
  },
  themeSet: (id: string) => ipcRenderer.invoke('theme-set', { id }),
  listPluginSlots: () => ipcRenderer.invoke('plugin-slot-list'),
  onPluginSlotRegister: (cb: (m: any) => void) => { ipcRenderer.on('shell-slot-register', (_e: any, m: any) => cb(m)); },
  onPluginSlotUnregister: (cb: (m: any) => void) => { ipcRenderer.on('shell-slot-unregister', (_e: any, m: any) => cb(m)); },
  setAiViewVisible: (visible: boolean) => ipcRenderer.invoke('shell-set-ai-view-visible', { visible }),
};

contextBridge.exposeInMainWorld('shellAPI', shellAPI);

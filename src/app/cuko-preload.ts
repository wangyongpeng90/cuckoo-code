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
  marketList: (topic: string) => ipcRenderer.invoke('cuko:market-list', topic),
  saveProvider: (provider: any) => ipcRenderer.invoke('cuko:save-provider', provider),
  deleteProvider: (id: string) => ipcRenderer.invoke('cuko:delete-provider', id),
  refreshModels: () => ipcRenderer.invoke('cuko:refresh-models'),
  // [261123-q4h7tn-cuko-openai] 按表单地址 / 密钥获取模型（返回合并后的列表，不写库）
  // 未填 apiKey 时会用库里已存的（不把明文回显到界面）
  fetchModels: (params: any) => ipcRenderer.invoke('cuko:fetch-models', params),
  // [261123-q4h7tn-cuko-openai] 系统加密是否可用（设置页据此提示能否安全保存密钥）
  getEncryptionStatus: () => ipcRenderer.invoke('cuko:get-encryption-status'),
  // [261123-q4h7tn-cuko-openai] 把已有的明文密钥迁移成密文（幂等）
  migrateSecrets: () => ipcRenderer.invoke('cuko:migrate-secrets'),
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
  // [261123-q4h7tn-cuko-openai] 保存会话的推理等级
  updateSessionEffort: (sessionId: string, effort: string | null) => ipcRenderer.invoke('cuko:update-session-effort', sessionId, effort),
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
  continueAfterSwitch: (params: any) => ipcRenderer.invoke('cuko:continue-after-switch', params),
  getRequestLogs: () => ipcRenderer.invoke('cuko:get-request-logs'),
  getRequestLogRaw: (id: string) => ipcRenderer.invoke('cuko:get-request-log-raw', id),
  clearRequestLogs: () => ipcRenderer.invoke('cuko:clear-request-logs'),
  cancelRun: (sessionId: string) => ipcRenderer.invoke('cuko:cancel-run', sessionId),
  getRuns: () => ipcRenderer.invoke('cuko:get-runs'),
  subscribeRuns: () => ipcRenderer.invoke('cuko:subscribe-runs'),
  onRunEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('cuko:run-event', (_e: any, ev: any) => cb(ev));
  },

  // ====== [261126-q7mxk2-cuko-message-queue] 消息队列（变化走 onRunEvent 的 queue-update） ======
  queueGet: (sessionId: string) => ipcRenderer.invoke('cuko:queue-get', sessionId),
  queueEnqueue: (sessionId: string, text: string, lane?: string) => ipcRenderer.invoke('cuko:queue-enqueue', sessionId, text, lane),
  queueSteer: (sessionId: string, text: string) => ipcRenderer.invoke('cuko:queue-steer', sessionId, text),
  queueMove: (sessionId: string, itemId: string, placement: any) => ipcRenderer.invoke('cuko:queue-move', sessionId, itemId, placement),
  queueEdit: (sessionId: string, itemId: string, text: string) => ipcRenderer.invoke('cuko:queue-edit', sessionId, itemId, text),
  queueRemove: (sessionId: string, itemId: string) => ipcRenderer.invoke('cuko:queue-remove', sessionId, itemId),
  queueRunNow: (sessionId: string, itemId: string) => ipcRenderer.invoke('cuko:queue-run-now', sessionId, itemId),
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
  // Cuko 窗口里也有设置弹窗（市场卡片要跳 GitHub），必须和壳窗口一样暴露
  openExternal: (url: string) => ipcRenderer.invoke('open-external', { url }),
};

contextBridge.exposeInMainWorld('shellAPI', shellAPI);

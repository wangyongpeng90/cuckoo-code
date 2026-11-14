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
  createSession: (sessionId: string, providerId?: string, modelId?: string) => ipcRenderer.invoke('cuko:create-session', sessionId, providerId, modelId),
  renameSession: (sessionId: string, title: string) => ipcRenderer.invoke('cuko:rename-session', sessionId, title),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('cuko:delete-session', sessionId),
  updateProviderId: (sessionId: string, providerId: string) => ipcRenderer.invoke('cuko:update-provider-id', sessionId, providerId),
  updateSessionModel: (sessionId: string, providerId: string, modelId: string) => ipcRenderer.invoke('cuko:update-session-model', sessionId, providerId, modelId),
  
  getMessages: (sessionId: string) => ipcRenderer.invoke('cuko:get-messages', sessionId),
  saveMessage: (msg: any) => ipcRenderer.invoke('cuko:save-message', msg),
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
  themeSet: (id: string) => ipcRenderer.invoke('theme-set', { id }),
  listPluginSlots: () => ipcRenderer.invoke('plugin-slot-list'),
  onPluginSlotRegister: (cb: (m: any) => void) => { ipcRenderer.on('shell-slot-register', (_e: any, m: any) => cb(m)); },
  onPluginSlotUnregister: (cb: (m: any) => void) => { ipcRenderer.on('shell-slot-unregister', (_e: any, m: any) => cb(m)); },
  setAiViewVisible: (visible: boolean) => ipcRenderer.invoke('shell-set-ai-view-visible', { visible }),
};

contextBridge.exposeInMainWorld('shellAPI', shellAPI);

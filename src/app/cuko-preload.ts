import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cukoAPI', {
  // 预留给未来与主进程通信，比如读取/保存 Endpoint 配置
  getConfig: () => ipcRenderer.invoke('cuko:get-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('cuko:save-config', config),
});

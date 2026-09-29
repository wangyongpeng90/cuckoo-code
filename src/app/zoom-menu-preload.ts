/**
 * 缩放 mini 菜单窗 preload（与壳页面 preload 分离）
 * 暴露 window.zoomMenuAPI：应用缩放 + 接收倍率推送。
 * 菜单窗自身很短命：点击任意项后主进程应用缩放并关闭窗口。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron');

const zoomMenuAPI = {
  /** 运行平台（快捷键提示：darwin 显示 ⌘，其他显示 Ctrl） */
  platform: process.platform,
  /** 应用缩放（'in' | 'out' | 'reset'），+/- 保持窗口打开支持连续缩放 */
  apply: (action: string) => ipcRenderer.invoke('zoom-menu-action', { action }),
  /** 打开时回传当前倍率（主进程 did-finish-load 后推送） */
  onInit: (cb: (data: any) => void) => {
    ipcRenderer.on('zoom-menu-init', (_e: any, data: any) => cb(data));
  },
  /** 缩放期间倍率变化（快捷键/菜单项触发后实时刷新显示） */
  onZoom: (cb: (data: any) => void) => {
    ipcRenderer.on('zoom-menu-zoom', (_e: any, data: any) => cb(data));
  },
};

try {
  contextBridge.exposeInMainWorld('zoomMenuAPI', zoomMenuAPI);
} catch (err) {
  console.error('[Cuckoo ZoomMenu] contextBridge 失败:', err);
}
(window as any).zoomMenuAPI = zoomMenuAPI;
/**
 * 插件覆盖层 preload
 * 承载插件 UI（如桌宠），暴露 window.cuckooOverlay：宿主资源 + 事件桥。
 * 不能有顶层 await。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron');

const cuckooOverlay = {
  /** 读插件资源（base64），宿主主进程读文件，不经过任何页面网络 */
  readAsset: (pluginId: string, relPath: string) => ipcRenderer.invoke('plugin-read-asset', { pluginId, relPath }),
  /** 覆盖层就绪上报 */
  ready: (pluginId: string) => ipcRenderer.send('plugin-overlay-ready', { pluginId }),
  /** 订阅宿主事件（插件事件流） */
  onEvent: (cb: (payload: any) => void) => {
    ipcRenderer.on('plugin-overlay-event', (_e: any, payload: any) => cb(payload));
  },
  /** 向宿主发消息 */
  send: (channel: string, data: any) => ipcRenderer.send('plugin-overlay-msg', { channel, data }),
  /** 宿主 → 覆盖层 */
  onMessage: (cb: (payload: any) => void) => {
    ipcRenderer.on('plugin-overlay-msg', (_e: any, payload: any) => cb(payload));
  },
  /** 调试日志 */
  debugLog: (msg: string) => ipcRenderer.send('plugin-debug-log', { msg }),
  /** 上报鼠标是否在"可交互区域"（主进程据此切鼠标穿透） */
  setMouseHit: (hit: boolean) => ipcRenderer.send('plugin-overlay-mouse', { hit }),
};

// 定期上报"桌宠可交互元素的矩形"（主进程据此判断鼠标是否在桌宠上，切鼠标穿透）
// 不依赖 mousemove（穿透时 overlay 收不到鼠标事件）
setInterval(() => {
  try {
    // 所有带 dshp 前缀的可见元素（桌宠 UI 的根、按钮、tab、面板…）
    const els = document.querySelectorAll('[class*="dshp"]');
    const rects = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
    }
    cuckooOverlay.send('overlay-hit-rects', rects);
  } catch (_) {}
}, 120);

try {
  contextBridge.exposeInMainWorld('cuckooOverlay', cuckooOverlay);
} catch (e) {
  (window as any).cuckooOverlay = cuckooOverlay;
}

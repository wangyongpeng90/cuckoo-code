/**
 * Cuckoo 插件系统 - UI 扩展运行时
 *
 * 加载插件的 ui/*.js，把 UI 扩展注入页面。
 *
 * UI 扩展契约（DSH 风格）：
 *   export const name = 'my-ui'
 *   export const inject = ['agents']
 *   export function apply(ctx, config) { ... }
 *
 * UI 上下文 ctx 在普通 ctx 基础上，额外提供：
 *   ctx.ui.mount(el)     - 把 DOM 挂到页面
 *   ctx.ui.root()        - 取根容器
 *   ctx.ui.css(text)     - 注入样式
 *   ctx.ui.onResize(cb)  - 监听窗口尺寸
 *
 * 这样桌宠这类 UI 插件就能：用 ctx.on(...) 感知 agent 状态 + 用 ctx.ui.mount 画界面。
 */
import { loadPluginSource, safeLoad } from './loader.js';
import { serviceRegistry } from './service-registry.js';
import type { LoadedPlugin } from './loader.js';
import type { HostCapabilities } from './context.js';
import { registerContext, unregisterContext, bindCuckooEvents } from './compat/bridge.js';
import type { CuckooEventSource } from './compat/bridge.js';

/** UI 扩展的根容器 id 前缀 */
const UI_ROOT_PREFIX = 'cuckoo-plugin-ui-';

/** 已加载的 UI 插件 */
const loaded: LoadedPlugin[] = [];
let unbindEvents: (() => void) | null = null;

/** 待加载的 UI 插件 */
export interface PendingUiPlugin {
  name: string;
  source: string;
}

/** UI 能力对象 */
interface UiFacade {
  mount(el: any): void;
  root(): any;
  css(text: string): void;
  onResize(cb: (w: number, h: number) => void): () => void;
  /** 注入内联脚本（等价于 DSH 的 script 行） */
  injectScript(text: string): void;
  /** 注入 <script src>（等价于 DSH 的 script-src 行） */
  injectScriptSrc(src: string): void;
  /** 控制 AI 视图（DS 页面）显隐（纯 Electron 层，不碰页面） */
  setWebViewVisible?(visible: boolean): Promise<any>;
  /** 设主窗口材质（Win11 亚克力/Mica） */
  setWindowMaterial?(material: string): Promise<any>;
  /** 通用槽位注册（对标 DSH slots） */
  slot?: { register(spec: any): () => void };

  /** 覆盖层（Cuckoo 自己的视图，推荐 UI 插件使用） */
  overlay?: {
    init(): Promise<any>;
    eval(code: string): Promise<any>;
    html(html: string): Promise<any>;
  };
  /** Cuckoo 界面挂载（侧边栏/状态栏/工具栏） */
  shell?: {
    addSidebarPanel(spec: any): Promise<any>;
    addStatusItem(spec: any): Promise<any>;
    addToolbarButton(spec: any): Promise<any>;
    addStyle(css: string): () => void;
  };
  /** 注入主世界（谨慎，会污染 AI 页面） */
  injectMainWorld?(code: string): any;
}

/** 插件资源访问（等价于 DSH webServer 静态资源，Electron 用 IPC 实现） */
interface AssetsFacade {
  /** 读插件目录下的文件 → Uint8Array */
  read(relPath: string): Promise<Uint8Array>;
  /** 取 blob URL（缓存），适合 <img src>/Live2D 加载 */
  url(relPath: string): Promise<string>;
}

/** 给某个 ctx 扩展 UI 能力 */
function attachUi(ctx: any, pluginName: string): void {
  const rootId = UI_ROOT_PREFIX + pluginName;
  let rootEl: any = null;

  const ensureRoot = (): any => {
    if (rootEl && rootEl.isConnected) return rootEl;
    rootEl = document.getElementById(rootId);
    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.id = rootId;
      rootEl.style.cssText = 'position:fixed;z-index:2147483000;pointer-events:none;';
      // 子元素默认可交互（桌宠需要），由插件自行覆盖
      document.body.appendChild(rootEl);
    }
    return rootEl;
  };

  const ui: UiFacade = {
    mount(el: any) {
      if (!el) return;
      const root = ensureRoot();
      el.style.pointerEvents = 'auto';
      root.appendChild(el);
    },
    root() {
      return ensureRoot();
    },
    css(text: string) {
      if (typeof text !== 'string' || !text) return;
      const style = document.createElement('style');
      style.setAttribute('data-plugin', pluginName);
      style.textContent = text;
      document.head.appendChild(style);
    },
    onResize(cb: (w: number, h: number) => void) {
      if (typeof cb !== 'function') return () => {};
      const handler = () => cb(window.innerWidth, window.innerHeight);
      window.addEventListener('resize', handler);
      return () => window.removeEventListener('resize', handler);
    },
    injectScript(text: string) {
      if (typeof text !== 'string' || !text) return;
      const s = document.createElement('script');
      s.setAttribute('data-plugin', pluginName);
      s.textContent = text;
      document.head.appendChild(s);
    },
    injectScriptSrc(src: string) {
      if (typeof src !== 'string' || !src) return;
      const s = document.createElement('script');
      s.setAttribute('data-plugin', pluginName);
      s.src = src;
      document.head.appendChild(s);
    },
    /** 控制 AI 视图（DS 页面）显隐（纯 Electron 层，不碰页面） */
    setWebViewVisible(visible: boolean) {
      const api = (window as any).electronAPI;
      if (api && typeof api.setWebViewVisible === 'function') return api.setWebViewVisible(visible);
      return Promise.resolve({ success: false, error: 'setWebViewVisible 不可用' });
    },
    /**
     * 通用槽位注册（对标 DSH slots）：往具名槽位加内容，按 order 排序。
     * @param spec { slot, id, order?, ...内容 }（slot 如 'activitybar'/'toolbar'/'statusbar'/'sidebar.panel'）
     * @returns disposer（注销）
     */
    slot: {
      register: (spec: any) => {
        const api = (window as any).electronAPI;
        const s = spec || {};
        if (api && typeof api.slotRegister === 'function') {
          api.slotRegister({ pluginId: pluginName, slot: s.slot, id: s.id, order: s.order, spec: s }).catch(() => {});
          return () => { try { api.slotUnregister({ pluginId: pluginName, slot: s.slot, id: s.id }).catch(() => {}); } catch (_) {} };
        }
        return () => {};
      },
    },
    /** 设主窗口材质（Win11 亚克力/Mica；纯 Electron 层）。material: 'acrylic'|'mica'|'tabbed'|'none' */
    setWindowMaterial(material: string) {
      const api = (window as any).electronAPI;
      if (api && typeof api.setWindowMaterial === 'function') return api.setWindowMaterial(material);
      return Promise.resolve({ success: false, error: 'setWindowMaterial 不可用' });
    },
  };

  // ===== 插件资源访问（ctx.assets）=====
  const blobUrls: string[] = [];
  const assets: AssetsFacade = {
    async read(relPath: string): Promise<Uint8Array> {
      const api = (window as any).electronAPI;
      if (!api || typeof api.readPluginAsset !== 'function') {
        throw new Error('readPluginAsset 不可用');
      }
      const res = await api.readPluginAsset(pluginName, relPath);
      if (!res || !res.success) throw new Error((res && res.error) || '读取资源失败');
      // base64 → Uint8Array
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    },
    async url(relPath: string): Promise<string> {
      const bytes = await assets.read(relPath);
      // 用底层 ArrayBuffer 构造，避免 Uint8Array 泛型与 BlobPart 的兼容问题
      const blob = new Blob([bytes.buffer as ArrayBuffer]);
      const u = URL.createObjectURL(blob);
      blobUrls.push(u);
      return u;
    },
  };

  // 注入主世界（AI 页面主世界，contextIsolation 下 preload 与主世界隔离）
  // 覆盖层（宿主层 UI，推荐插件 UI 使用）
  (ui as any).overlay = {
    init: () => {
      const api = (window as any).electronAPI;
      if (api && typeof api.overlayInit === 'function') return api.overlayInit();
      return Promise.resolve({ success: false, error: 'overlayInit 不可用' });
    },
    eval: (code: string) => {
      const api = (window as any).electronAPI;
      if (api && typeof api.overlayEval === 'function') return api.overlayEval(code);
      return Promise.resolve({ success: false, error: 'overlayEval 不可用' });
    },
    html: (html: string) => {
      const api = (window as any).electronAPI;
      if (api && typeof api.overlayHtml === 'function') return api.overlayHtml(html);
      return Promise.resolve({ success: false, error: 'overlayHtml 不可用' });
    },
  };

  // Cuckoo 界面挂载（侧边栏/状态栏/工具栏）
  (ui as any).shell = {
    addSidebarPanel: (spec: any) => {
      const api = (window as any).electronAPI;
      if (api && typeof api.shellMount === 'function') return api.shellMount(pluginName, 'sidebar', spec && spec.id, spec);
      return Promise.resolve({ success: false, error: 'shellMount 不可用' });
    },
    addStatusItem: (spec: any) => {
      const api = (window as any).electronAPI;
      if (api && typeof api.shellMount === 'function') return api.shellMount(pluginName, 'statusbar', spec && spec.id, spec);
      return Promise.resolve({ success: false, error: 'shellMount 不可用' });
    },
    addToolbarButton: (spec: any) => {
      const api = (window as any).electronAPI;
      if (api && typeof api.shellMount === 'function') return api.shellMount(pluginName, 'toolbar', spec && spec.id, spec);
      return Promise.resolve({ success: false, error: 'shellMount 不可用' });
    },
    /**
     * 往 Cuckoo 壳页面注入任意 CSS（壁纸/字体/布局）。
     * 对标 DSH 的 styles.insert(css)。只作用于 Cuckoo 自己的界面，不碰 AI 页面。
     * @returns disposer（移除本插件注入的 CSS）
     */
    addStyle: (css: string) => {
      const api = (window as any).electronAPI;
      if (api && typeof api.shellStyleAdd === 'function') {
        api.shellStyleAdd(pluginName, css).catch(() => {});
        return () => {
          try { if (api.shellStyleRemove) api.shellStyleRemove(pluginName).catch(() => {}); } catch (_) {}
        };
      }
      return () => {};
    },
  };

  (ui as any).injectMainWorld = (code: string) => {
    const api = (window as any).electronAPI;
    const log = (m: string) => { try { if (api && api.pluginDebugLog) api.pluginDebugLog(m); } catch (_) {} };
    try {
      if (api && typeof api.injectMainWorld === 'function') {
        // 用主进程 webContents.executeJavaScript（明确主世界）
        return api.injectMainWorld(code).then(
          (res: any) => log('[plugin] injectMainWorld ' + (res && res.success ? '成功' : '失败: ' + (res && res.error))),
          (err: any) => log('[plugin] injectMainWorld 失败: ' + (err && err.message ? err.message : err)),
        );
      }
      // 兜底：webFrame
      const { webFrame } = require('electron');
      return webFrame.executeJavaScript(code);
    } catch (e: any) {
      log('[plugin] injectMainWorld 异常: ' + (e && e.message ? e.message : e));
    }
  };

  ctx.ui = ui;
  ctx.assets = assets;
  // 记录清理器：卸载时移除根容器
  const disposers: Array<() => void> = (ctx as any).__disposers || [];
  disposers.push(() => {
    try {
      const el = document.getElementById(rootId);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (_) { /* ignore */ }
    // 释放 blob URL
    for (const u of blobUrls) {
      try { URL.revokeObjectURL(u); } catch (_) {}
    }
    blobUrls.length = 0;
  });
}

/**
 * 加载一组 UI 扩展
 */
export function loadUiPlugins(plugins: PendingUiPlugin[], host: HostCapabilities, eventSource?: CuckooEventSource): { loaded: string[]; failed: Array<{ name: string; error: string }> } {
  const okNames: string[] = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const p of plugins) {
    const result = safeLoad(() => loadPluginSource(p.source, host, p.name, undefined, serviceRegistry));
    if (result.ok && result.plugin) {
      attachUi(result.plugin.ctx, result.plugin.name);
      loaded.push(result.plugin);
      registerContext(result.plugin.ctx);
      okNames.push(result.plugin.name);
    } else {
      failures.push({ name: p.name, error: result.error || '未知错误' });
      console.error('[plugin] 加载 UI 插件失败 (' + p.name + '):', result.error);
    }
  }

  if (eventSource && !unbindEvents) {
    unbindEvents = bindCuckooEvents(eventSource);
  }

  return { loaded: okNames, failed: failures };
}

/** 卸载所有已加载的 UI 插件 */
export function unloadAllUiPlugins(): void {
  for (const p of loaded) {
    try {
      unregisterContext(p.ctx);
      p.dispose();
    } catch (err) {
      console.error('[plugin] 卸载 UI 插件失败 (' + p.name + '):', err);
    }
  }
  loaded.length = 0;
  if (unbindEvents) {
    unbindEvents();
    unbindEvents = null;
  }
}

export { safeLoad, attachUi };

import { createRequire } from 'node:module';
import { buildChromeUserAgent } from '../../infra/user-agent.js';
const require = createRequire(import.meta.url);
const { BrowserWindow } = require('electron');

interface OpenWindowOptions {
  width?: number;
  height?: number;
  [key: string]: any;
}

/**
 * UA + 客户端提示下发器（由 app 层注入）。
 * tools 层不能依赖 app 层（依赖铁律），而 CDP override 需要 Electron debugger，
 * 所以用注入的方式把 app 层的 applyChromeUserAgent 传进来 —— 与 injectSettingReader 同套路。
 */
let uaApplier: ((wc: any) => void | Promise<void>) | null = null;
function injectUaApplier(fn: (wc: any) => void | Promise<void>): void {
  uaApplier = fn;
}

class BrowserWindowManager {
  windows: Map<string, any>;
  nextAutoId: number;

  constructor() {
    this.windows = new Map();
    this.nextAutoId = 1;
  }

  openWindow(customId: string | null, url: string, options: OpenWindowOptions = {}): string {
    let id: string;
    if (customId) {
      if (this.windows.has(customId)) {
        throw new Error(`窗口 ID "${customId}" 已存在，请换一个 ID 或复用现有窗口`);
      }
      id = customId;
    } else {
      do {
        id = `win-${this.nextAutoId++}`;
      } while (this.windows.has(id));
    }

    const win = new BrowserWindow({
      width: options.width || 1200,
      height: options.height || 800,
      ...options
    });

    // 设置与主窗口一致的普通 Chrome UA（动态取真实内核版本），避免暴露 Electron 标识
    win.webContents.setUserAgent(buildChromeUserAgent());
    // 再补客户端提示（sec-ch-ua 等）：这一步只有 CDP 能真正生效，app 层注入后才有
    if (uaApplier) {
      try { void uaApplier(win.webContents); } catch (_) { /* ignore */ }
    }

    if (url) win.loadURL(url);
    this.windows.set(id, win);
    win.on('closed', () => this.windows.delete(id));
    return id;
  }

  async injectJS(id: string, jsCode: string): Promise<any> {
    const win = this.windows.get(id);
    if (!win) throw new Error(`窗口 ID "${id}" 不存在`);

    // 语法探测：优先按"单个表达式"解析，失败则按"函数体（多条语句）"解析
    // 这样既支持 `1+2`、`(() => {...})()` 这类表达式，也支持
    // `return x`、`const a=1; return a`、`if (...) return x`、顶层 await 等多语句代码
    let mode: 'expression' | 'body'; // 'expression' | 'body'
    try {
      // eslint-disable-next-line no-new-func
      new Function('return (' + jsCode + '\n)');
      mode = 'expression';
    } catch (e) {
      try {
        // eslint-disable-next-line no-new-func
        new Function('return (async () => {\n' + jsCode + '\n})');
        mode = 'body';
      } catch (e2: any) {
        throw new Error(`JS 语法错误: ${e2.message}`);
      }
    }

    const wrapped =
      mode === 'expression'
        ? `(async () => {
  try {
    const __result = await (${jsCode});
    return { ok: true, value: __result };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
})()`
        : `(async () => {
  try {
    const __result = await (async () => {
${jsCode}
    })();
    return { ok: true, value: __result };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
})()`;

    const result = await win.webContents.executeJavaScript(wrapped, true);
    if (result && result.ok === false) {
      throw new Error(result.error);
    }
    return result ? result.value : undefined;
  }

  getWindow(id: string): any {
    const win = this.windows.get(id);
    if (!win) throw new Error(`窗口 ID "${id}" 不存在`);
    return win;
  }

  getAllWindowIds(): string[] {
    return Array.from(this.windows.keys());
  }

  closeWindow(id: string): void {
    const win = this.getWindow(id);
    win.close();
    this.windows.delete(id);
  }
}

const windowManager = new BrowserWindowManager();
export { windowManager, injectUaApplier };

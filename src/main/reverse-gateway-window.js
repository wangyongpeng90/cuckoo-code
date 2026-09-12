/**
 * 反向网关专用隐藏窗口
 *
 * 设计目标：API 调用与用户可见的 ChatGPT 工作窗完全隔离——
 * - 不注入 Cuckoo preload：无覆盖层、无拦截观察器（零通知、零工具解析）
 * - 复用 ChatGPT 平台窗口的 session（同 partition）→ 共享登录态，无需重复登录
 * - show:false + skipTaskbar → 用户不可见
 *
 * 窗口生命周期：懒创建、复用、销毁后自动重建；closeAll 随应用退出调用。
 * 依赖全部注入（windowState / BrowserWindow 工厂），可在 Node 单测离线验证。
 */
const CHATGPT_URL = 'https://chatgpt.com/';
const LOAD_TIMEOUT_MS = 60000;
const POLL_MS = 500;

/**
 * @param {object} deps
 * @param {function(object):object} deps.createBrowserWindow 工厂（主进程传 Electron BrowserWindow 构造器，测试传 fake）
 * @param {function():Array<{providerId:string, win:object}>} deps.listChatgptContexts 返回 chatgpt 平台窗口上下文
 * @param {object} [opts] loadTimeoutMs / pollMs
 */
function createReverseGatewayWindow(deps, opts = {}) {
  if (typeof deps.createBrowserWindow !== 'function') throw new Error('需要 createBrowserWindow');
  if (typeof deps.listChatgptContexts !== 'function') throw new Error('需要 listChatgptContexts');
  const userAgent = deps.userAgent || null; // 应与主窗口 UA 完全一致（cf_clearance 与 UA 绑定）
  const loadTimeoutMs = opts.loadTimeoutMs || LOAD_TIMEOUT_MS;
  const pollMs = opts.pollMs || POLL_MS;

  let hidden = null; // { win }

  function resolveSession() {
    for (const ctx of deps.listChatgptContexts()) {
      const win = ctx && ctx.win;
      if (win && !win.isDestroyed() && typeof win.webContents !== 'undefined') {
        return win.webContents.session;
      }
    }
    return null;
  }

  function isUsable(win) {
    try {
      return !win.isDestroyed() && /chatgpt\.com/.test(win.webContents.getURL() || '');
    } catch (_) { return false; }
  }

  async function createHidden(session) {
    const win = deps.createBrowserWindow({
      width: 1200, height: 900,
      show: false, skipTaskbar: true,
      webPreferences: {
        session,                 // 共享 ChatGPT 登录态
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        // 注意：刻意不设置 preload —— 反向网关页不应有覆盖层/观察器/工具管线
      },
    });
    // UA 必须与主窗口完全一致：cf_clearance 等 Cloudflare 凭据与 UA 绑定，
    // UA 不一致会导致共享 cookie 失效并触发质询
    if (userAgent && typeof win.webContents.setUserAgent === 'function') {
      win.webContents.setUserAgent(userAgent);
    }
    await win.loadURL(CHATGPT_URL);
    return win;
  }

  async function waitUsable(win) {
    const t0 = Date.now();
    while (Date.now() - t0 < loadTimeoutMs) {
      if (win.isDestroyed()) return false;
      try {
        const url = win.webContents.getURL() || '';
        if (/chatgpt\.com/.test(url)) return true;
        // 被重定向到登录/验证流程 → 未登录
        if (/auth\.openai\.com/.test(url)) return false;
      } catch (_) { return false; }
      await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
  }

  return {
    /**
     * 取隐藏窗口的 webContents（懒创建/复用）。
     * @returns {Promise<object|null>} webContents；无 ChatGPT 平台窗口时返回 null
     * @throws {Error} 页面加载失败或未登录时
     */
    async getWebContents() {
      if (hidden && isUsable(hidden.win)) return hidden.win.webContents;
      if (hidden && !hidden.win.isDestroyed()) { try { hidden.win.destroy(); } catch (_) {} }
      hidden = null;

      const session = resolveSession();
      if (!session) return null;

      const win = await createHidden(session);
      hidden = { win };

      const ok = await waitUsable(win);
      if (!ok) {
        try { win.destroy(); } catch (_) {}
        hidden = null;
        throw new Error('ChatGPT 页面加载失败或未登录（反向网关窗口），请先在 ChatGPT 平台完成登录');
      }
      return win.webContents;
    },

    /** 应用退出时调用：关闭隐藏窗口 */
    closeAll() {
      if (hidden && hidden.win && !hidden.win.isDestroyed()) {
        try { hidden.win.destroy(); } catch (_) {}
      }
      hidden = null;
    },

    /** 测试/诊断：当前隐藏窗口是否存在 */
    get hasWindow() {
      return !!(hidden && hidden.win && !hidden.win.isDestroyed());
    },
  };
}

module.exports = { createReverseGatewayWindow, CHATGPT_URL };

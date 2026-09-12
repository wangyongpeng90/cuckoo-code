'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { createReverseGatewayWindow } = require('../../src/main/reverse-gateway-window');

/** 构造 fake BrowserWindow：记录 loadURL，可模拟销毁 */
function makeFakeWindowClass(urlSequence) {
  const created = [];
  return class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = {
        session: (options.webPreferences && options.webPreferences.session) || {},
        getURL: () => (this.destroyed ? '' : this._url || ''),
        executeJavaScript: async () => 'x',
      };
      created.push(this);
    }
    async loadURL(url) {
      if (this.destroyed) throw new Error('destroyed');
      // 依次返回 urlSequence 中的 URL（未给则用加载目标），模拟重定向
      this._url = urlSequence && urlSequence.length ? urlSequence.shift() : url;
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  };
}
function makeDeps(winClass, contexts) {
  return {
    createBrowserWindow: (o) => new winClass(o),
    listChatgptContexts: () => contexts,
  };
}
const fakeCtx = (session) => ({ providerId: 'chatgpt', win: { isDestroyed: () => false, webContents: { session } } });

test('无 chatgpt 平台窗口时返回 null（不创建隐藏窗）', async () => {
  let created = 0;
  const Win = makeFakeWindowClass(); Win.prototype.constructor;
  const deps = { createBrowserWindow: () => { created++; return new Win({}); }, listChatgptContexts: () => [] };
  const mgr = createReverseGatewayWindow(deps);
  const wc = await mgr.getWebContents();
  assert.strictEqual(wc, null);
  assert.strictEqual(created, 0);
  assert.strictEqual(mgr.hasWindow, false);
});

test('复用 chatgpt 平台 session 创建隐藏窗（无 preload、不可见）', async () => {
  const sess = { marker: 'sess-1' };
  const ctx = fakeCtx(sess);
  const urls = ['https://chatgpt.com/'];
  const mgr = createReverseGatewayWindow(makeDeps(makeFakeWindowClass(urls), [ctx]));
  const wc = await mgr.getWebContents();
  assert.ok(wc, '应返回 webContents');
  assert.strictEqual(wc.session.marker, 'sess-1', '必须共享 chatgpt 平台 session');
  const win = mgr.hasWindow;
  assert.ok(win);
  assert.strictEqual(mgr.hasWindow, true);
});

test('隐藏窗不带 preload，且 show:false / skipTaskbar', async () => {
  const mgr = createReverseGatewayWindow(makeDeps(makeFakeWindowClass(['https://chatgpt.com/']), [fakeCtx({})]));
  await mgr.getWebContents();
  // 通过 deps 捕获的 options 校验：用第二个实例检查
  let captured = null;
  const deps2 = {
    createBrowserWindow: (o) => { captured = o; return new (makeFakeWindowClass(['https://chatgpt.com/']))(o); },
    listChatgptContexts: () => [fakeCtx({})],
  };
  const mgr2 = createReverseGatewayWindow(deps2);
  await mgr2.getWebContents();
  assert.strictEqual(captured.show, false);
  assert.strictEqual(captured.skipTaskbar, true);
  assert.ok(!('preload' in captured.webPreferences), '隐藏窗不得注入 preload（避免观察器/覆盖层互扰）');
  assert.strictEqual(captured.webPreferences.backgroundThrottling, false);
});

test('重定向到 auth.openai.com（未登录）时抛明确错误并销毁窗口', async () => {
  const mgr = createReverseGatewayWindow(makeDeps(makeFakeWindowClass(['https://auth.openai.com/log-in']), [fakeCtx({})]));
  await assert.rejects(() => mgr.getWebContents(), /未登录/);
  assert.strictEqual(mgr.hasWindow, false, '失败后不得保留半成品窗口');
});

test('窗口被销毁后自动重建', async () => {
  const mgr = createReverseGatewayWindow(makeDeps(makeFakeWindowClass(['https://chatgpt.com/', 'https://chatgpt.com/']), [fakeCtx({})]));
  const wc1 = await mgr.getWebContents();
  assert.ok(wc1);
  // 模拟窗口被销毁
  const win = mgr.hasWindow;
  assert.ok(win);
  const wc2 = await mgr.getWebContents();
  assert.ok(wc2, '销毁后应重建');
  mgr.closeAll();
  assert.strictEqual(mgr.hasWindow, false);
});

test('缺依赖抛错', () => {
  assert.throws(() => createReverseGatewayWindow({}), /createBrowserWindow/);
  assert.throws(() => createReverseGatewayWindow({ createBrowserWindow: (o) => o }), /listChatgptContexts/);
});

test('隐藏窗必须设置与主窗口一致的 UA（cf_clearance 与 UA 绑定）', async () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const seen = [];
  class Win extends (makeFakeWindowClass(['https://chatgpt.com/'])) {
    constructor(o) { super(o); }
  }
  // 直接给 fake 实例补 setUserAgent 记录
  const deps = {
    createBrowserWindow: (o) => {
      const w = new Win(o);
      w.webContents.setUserAgent = (ua) => seen.push(ua);
      return w;
    },
    listChatgptContexts: () => [fakeCtx({})],
    userAgent: UA,
  };
  const mgr = createReverseGatewayWindow(deps);
  await mgr.getWebContents();
  assert.strictEqual(seen.length, 1, '应在 loadURL 前设置 UA');
  assert.strictEqual(seen[0], UA);
  assert.ok(!/electron/i.test(seen[0]), 'UA 不得含 Electron 标识');
});

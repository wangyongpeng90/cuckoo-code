// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/shell.html + shell.js 骨架测试（无边框改版）。
 * 覆盖：常驻标题栏（标题/按钮/win 控制）、图标栏渲染、面板展开/收起状态切换、
 * token 徽章更新、导航条滑出机制。
 * 标记 HTML 直接读自 src/ui/shell.html，避免测试与实现脱节。
 */
import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupDom } from '../helpers/dom';
import { initShell, formatTokenCount } from '../../src/ui/shell.js';

const SHELL_HTML = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/ui/shell.html'
);

function readShellBody() {
  const html = fs.readFileSync(SHELL_HTML, 'utf-8');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  assert.ok(m, 'shell.html 缺少 <body>');
  return m[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

function makeApi() {
  const calls = [];
  const handlers = {};
  const api = {
    calls,
    handlers,
    navigate: (url) => { calls.push(['navigate', url]); },
    back: () => {},
    forward: () => {},
    reload: () => {},
    home: () => { calls.push(['home']); },
    setPanelOpen: (panelId) => { calls.push(['setPanelOpen', panelId]); },
    setTopbarVisible: (visible) => { calls.push(['setTopbarVisible', visible]); },
    windowMinimize: () => { calls.push(['windowMinimize']); },
    windowMaximize: () => { calls.push(['windowMaximize']); },
    windowClose: () => { calls.push(['windowClose']); },
    zoom: (action) => { calls.push(['zoom', action]); },
    getZoom: () => Promise.resolve({ success: true, zoomFactor: 1 }),
    openZoomMenu: (rect) => { calls.push(['openZoomMenu', rect]); },
    onUrlUpdated: (cb) => { handlers.url = cb; },
    onTokenUpdated: (cb) => { handlers.token = cb; },
    onZoomUpdated: (cb) => { handlers.zoom = cb; },
    onTogglePanel: (cb) => { handlers.togglePanel = cb; },
    onClosePanel: (cb) => { handlers.closePanel = cb; },
    onFocusUrl: (cb) => { handlers.focusUrl = cb; },
    onPanelRestore: (cb) => { handlers.panelRestore = cb; },
  };
  return api;
}

let ctx;
let api;

beforeEach(() => {
  document.body.className = '';
  ctx = setupDom(readShellBody());
  api = makeApi();
  initShell(api, document);
});

afterEach(() => {
  ctx.cleanup();
  document.body.className = '';
});

describe('常驻标题栏', () => {
  it('标题栏存在：标题（默认 Cuckoo Code）+ 导航/刷新/主页按钮 + token 徽章，均带 SVG', () => {
    assert.strictEqual(document.getElementById('titlebar') !== null, true);
    assert.strictEqual(document.getElementById('titlebar-title').textContent, 'Cuckoo Code');
    for (const id of ['btn-nav-toggle', 'btn-reload', 'btn-home', 'token-badge']) {
      const el = document.getElementById(id);
      assert.strictEqual(el !== null, true, id);
      assert.strictEqual(el.querySelector('svg') !== null, true, id);
      assert.strictEqual(typeof el.title === 'string' && el.title.length > 0, true, id);
    }
  });

  it('旧顶栏与热区已移除', () => {
    assert.strictEqual(document.getElementById('topbar') === null, true);
    assert.strictEqual(document.getElementById('topbar-hotzone') === null, true);
  });

  it('onUrlUpdated 更新标题：provider 名 + hostname', () => {
    api.handlers.url({ url: 'https://chat.deepseek.com/a/b', canGoBack: false, canGoForward: false, providerName: 'DeepSeek' });
    assert.strictEqual(document.getElementById('titlebar-title').textContent, 'DeepSeek · chat.deepseek.com');
  });

  it('provider 名缺失时用 hostname；URL 无 hostname（file://）时只用 provider 名', () => {
    api.handlers.url({ url: 'https://kimi.com/', canGoBack: false, canGoForward: false });
    assert.strictEqual(document.getElementById('titlebar-title').textContent, 'kimi.com');
    api.handlers.url({ url: 'file:///app/ui/platform-select.html', canGoBack: false, canGoForward: false, providerName: '' });
    assert.strictEqual(document.getElementById('titlebar-title').textContent, 'Cuckoo Code');
    api.handlers.url({ url: 'file:///app/ui/platform-select.html', canGoBack: false, canGoForward: false, providerName: 'Kimi' });
    assert.strictEqual(document.getElementById('titlebar-title').textContent, 'Kimi');
  });

  it('api.platform 写入 body 平台类', () => {
    ctx.cleanup();
    document.body.className = '';
    ctx = setupDom(readShellBody());
    const macApi = makeApi();
    macApi.platform = 'darwin';
    initShell(macApi, document);
    assert.strictEqual(document.body.classList.contains('platform-darwin'), true);
  });

  it('win 控制按钮：非 win32（默认/macOS）不渲染', () => {
    assert.strictEqual(document.getElementById('win-controls').hidden, true);
  });

  it('win 控制按钮：win32 渲染并接线 min/max/close', () => {
    ctx.cleanup();
    document.body.className = '';
    ctx = setupDom(readShellBody());
    const winApi = makeApi();
    winApi.platform = 'win32';
    initShell(winApi, document);

    assert.strictEqual(document.body.classList.contains('platform-win32'), true);
    assert.strictEqual(document.getElementById('win-controls').hidden, false);
    document.getElementById('btn-win-min').click();
    document.getElementById('btn-win-max').click();
    document.getElementById('btn-win-close').click();
    assert.deepStrictEqual(winApi.calls, [['windowMinimize'], ['windowMaximize'], ['windowClose']]);
  });

  it('标题栏按钮动作：刷新/主页接到 api', () => {
    document.getElementById('btn-reload').click();
    document.getElementById('btn-home').click();
    assert.deepStrictEqual(api.calls, [['home']]);
  });
});

describe('图标栏', () => {
  it('渲染 5 个主图标 + 底部 2 个固定图标，均带 title 与 SVG', () => {
    const main = document.querySelectorAll('.rail-main .rail-btn');
    const bottom = document.querySelectorAll('.rail-bottom .rail-btn');
    assert.strictEqual(main.length, 5);
    assert.strictEqual(bottom.length, 2);

    // 首位是 home 导航按钮（id 标识，不是面板）；其余 4 个为面板按钮
    assert.strictEqual(main[0].id, 'rail-btn-home');
    const ids = Array.from(main).slice(1).map((b) => b.dataset.panel);
    assert.deepStrictEqual(ids, ['chat', 'window', 'mcp', 'task']);
    const bottomIds = Array.from(bottom).map((b) => b.dataset.panel);
    assert.deepStrictEqual(bottomIds, ['settings', 'project']);

    const all = document.querySelectorAll('.rail-btn');
    for (const btn of all) {
      assert.strictEqual(typeof btn.title, 'string');
      assert.strictEqual(btn.title.length > 0, true);
      assert.strictEqual(btn.querySelector('svg') !== null, true);
    }
  });

  it('图标 title 依次为 平台主页/会话/窗口/MCP/任务/设置/项目', () => {
    const titles = Array.from(document.querySelectorAll('.rail-btn')).map((b) => b.title);
    assert.deepStrictEqual(titles, ['平台主页', '会话', '窗口', 'MCP', '任务', '设置', '项目']);
  });

  it('点击 home 图标：调用 api.home() 导航，不展开面板、不高亮、无对应面板容器', () => {
    document.getElementById('rail-btn-home').click();

    assert.deepStrictEqual(api.calls, [['home']]);
    assert.strictEqual(document.getElementById('side-panel').hidden, true);
    assert.strictEqual(document.querySelectorAll('.rail-btn.active').length, 0);
    assert.strictEqual(document.querySelector('.panel-content[data-panel-content="home"]') === null, true);
  });
});

describe('面板切换状态机', () => {
  it('初始面板隐藏，无激活图标', () => {
    const panel = document.getElementById('side-panel');
    assert.strictEqual(panel.hidden, true);
    assert.strictEqual(document.querySelectorAll('.rail-btn.active').length, 0);
  });

  it('点击图标：调用 setPanelOpen(panelId)，面板展开并显示面板名，图标高亮', () => {
    const chatBtn = document.querySelector('.rail-btn[data-panel="chat"]');
    chatBtn.click();

    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat']]);
    assert.strictEqual(document.getElementById('side-panel').hidden, false);
    assert.strictEqual(document.getElementById('panel-title').textContent, '会话');
    assert.strictEqual(chatBtn.classList.contains('active'), true);
  });

  it('点击另一图标：直接切换面板，不移除展开状态', () => {
    document.querySelector('.rail-btn[data-panel="chat"]').click();
    document.querySelector('.rail-btn[data-panel="mcp"]').click();

    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat'], ['setPanelOpen', 'mcp']]);
    assert.strictEqual(document.getElementById('side-panel').hidden, false);
    assert.strictEqual(document.getElementById('panel-title').textContent, 'MCP');
    assert.strictEqual(document.querySelector('.rail-btn[data-panel="chat"]').classList.contains('active'), false);
    assert.strictEqual(document.querySelector('.rail-btn[data-panel="mcp"]').classList.contains('active'), true);
  });

  it('再次点击激活图标：收起面板，setPanelOpen(null)', () => {
    const chatBtn = document.querySelector('.rail-btn[data-panel="chat"]');
    chatBtn.click();
    chatBtn.click();

    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat'], ['setPanelOpen', null]]);
    assert.strictEqual(document.getElementById('side-panel').hidden, true);
    assert.strictEqual(document.querySelectorAll('.rail-btn.active').length, 0);
  });

  it('面板标题栏的收起按钮：收起面板，setPanelOpen(null)', () => {
    document.querySelector('.rail-btn[data-panel="task"]').click();
    document.getElementById('panel-close').click();

    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'task'], ['setPanelOpen', null]]);
    assert.strictEqual(document.getElementById('side-panel').hidden, true);
  });

  it('面板标题栏包含面板名与收起按钮', () => {
    document.querySelector('.rail-btn[data-panel="settings"]').click();
    const header = document.querySelector('#side-panel .panel-header');
    assert.strictEqual(header !== null, true);
    assert.strictEqual(document.getElementById('panel-title').textContent, '设置');
    assert.strictEqual(typeof document.getElementById('panel-close').title, 'string');
  });
});

describe('token 徽章', () => {
  it('初始为 0，带 title', () => {
    const badge = document.getElementById('token-badge');
    assert.strictEqual(badge !== null, true);
    assert.strictEqual(document.getElementById('token-value').textContent, '0');
    assert.strictEqual(badge.title.length > 0, true);
  });

  it('onTokenUpdated 用 context 字段更新徽章文本', () => {
    api.handlers.token({ context: 56100, cumulative: 123456 });
    assert.strictEqual(document.getElementById('token-value').textContent, '5.61万');
  });

  it('徽章含 SVG 图标而非 emoji', () => {
    const badge = document.getElementById('token-badge');
    assert.strictEqual(badge.querySelector('svg') !== null, true);
  });
});

describe('快捷键（原 overlay Ctrl+Shift+C / Esc 迁入 shell）', () => {
  function pressShortcut(opts) {
    document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true }, opts)));
  }

  it('Ctrl+Shift+C：面板关闭时展开默认面板（会话）', () => {
    pressShortcut({ key: 'C', ctrlKey: true, shiftKey: true });
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat']]);
    assert.strictEqual(document.getElementById('side-panel').hidden, false);
    assert.strictEqual(document.getElementById('panel-title').textContent, '会话');
  });

  it('Ctrl+Shift+C：面板打开时收起', () => {
    document.querySelector('.rail-btn[data-panel="mcp"]').click();
    pressShortcut({ key: 'C', ctrlKey: true, shiftKey: true });
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'mcp'], ['setPanelOpen', null]]);
    assert.strictEqual(document.getElementById('side-panel').hidden, true);
  });

  it('Ctrl+Shift+C 重新展开时回到上次打开的面板', () => {
    document.querySelector('.rail-btn[data-panel="mcp"]').click();
    pressShortcut({ key: 'C', ctrlKey: true, shiftKey: true });
    pressShortcut({ key: 'C', ctrlKey: true, shiftKey: true });
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'mcp'], ['setPanelOpen', null], ['setPanelOpen', 'mcp']]);
    assert.strictEqual(document.getElementById('panel-title').textContent, 'MCP');
  });

  it('Esc：面板打开时收起', () => {
    document.querySelector('.rail-btn[data-panel="chat"]').click();
    pressShortcut({ key: 'Escape' });
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat'], ['setPanelOpen', null]]);
  });

  it('Esc：面板已关闭时不产生调用', () => {
    pressShortcut({ key: 'Escape' });
    assert.deepStrictEqual(api.calls, []);
  });

  it('Esc：焦点在输入框时不收起面板（地址栏自己的 Esc 归它管）', () => {
    document.querySelector('.rail-btn[data-panel="chat"]').click();
    const input = document.getElementById('url-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat']]);
    assert.strictEqual(document.getElementById('side-panel').hidden, false);
  });

  it('主进程 relay：onTogglePanel / onClosePanel 复用同一面板状态机', () => {
    api.handlers.togglePanel();
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat']]);
    api.handlers.closePanel();
    assert.deepStrictEqual(api.calls, [['setPanelOpen', 'chat'], ['setPanelOpen', null]]);
  });
});

describe('视图缩放', () => {
  it('缩放按钮存在：放大镜 SVG + 初始 100% 倍率；内嵌菜单已移除（改原生子窗口）', () => {
    const btn = document.getElementById('btn-zoom');
    assert.strictEqual(btn !== null, true);
    assert.strictEqual(btn.querySelector('svg') !== null, true);
    assert.strictEqual(typeof btn.title === 'string' && btn.title.length > 0, true);
    assert.strictEqual(document.getElementById('zoom-value').textContent, '100%');
    assert.strictEqual(document.getElementById('zoom-menu') === null, true);
  });

  it('点击缩放按钮：把按钮位置交给主进程弹出 mini 菜单（openZoomMenu）', () => {
    document.getElementById('btn-zoom').click();
    assert.strictEqual(api.calls.length, 1);
    assert.strictEqual(api.calls[0][0], 'openZoomMenu');
    const rect = api.calls[0][1];
    assert.strictEqual(rect !== null && typeof rect === 'object', true);
    for (const k of ['left', 'top', 'right', 'bottom']) {
      assert.strictEqual(typeof rect[k] === 'number', true, k);
    }
  });

  it('onZoomUpdated：同步更新倍率显示（1.3 → 130%，回到 1 → 100%）', () => {
    api.handlers.zoom({ zoomFactor: 1.3 });
    assert.strictEqual(document.getElementById('zoom-value').textContent, '130%');
    api.handlers.zoom({ zoomFactor: 1 });
    assert.strictEqual(document.getElementById('zoom-value').textContent, '100%');
  });

  it('Ctrl/Cmd +/-/0（壳聚焦）：调用 api.zoom 并 preventDefault', () => {
    function press(opts) {
      return new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts));
    }
    const e1 = press({ key: '=', ctrlKey: true });
    document.dispatchEvent(e1);
    assert.strictEqual(e1.defaultPrevented, true);
    assert.deepStrictEqual(api.calls, [['zoom', 'in']]);

    const e2 = press({ key: '-', metaKey: true });
    document.dispatchEvent(e2);
    assert.strictEqual(e2.defaultPrevented, true);
    assert.deepStrictEqual(api.calls, [['zoom', 'in'], ['zoom', 'out']]);

    const e3 = press({ key: '0', ctrlKey: true });
    document.dispatchEvent(e3);
    assert.strictEqual(e3.defaultPrevented, true);
    assert.deepStrictEqual(api.calls, [['zoom', 'in'], ['zoom', 'out'], ['zoom', 'reset']]);
  });
});

describe('导航条滑出（P2 机制复用，无 hover 热区）', () => {
  const navbar = () => document.getElementById('navbar');
  const navToggle = () => document.getElementById('btn-nav-toggle');
  const urlInput = () => document.getElementById('url-input');

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('初始隐藏：无 .visible 类，浮层元素存在，热区已移除', () => {
    assert.strictEqual(navbar() !== null, true);
    assert.strictEqual(navbar().classList.contains('visible'), false);
    assert.strictEqual(document.getElementById('topbar-hotzone') === null, true);
    assert.strictEqual(api.calls.length, 0);
  });

  it('导航图标点击：唤出导航条、聚焦 URL 输入框、通知主进程 setTopbarVisible(true)', () => {
    navToggle().click();
    assert.strictEqual(navbar().classList.contains('visible'), true);
    assert.strictEqual(document.activeElement === urlInput(), true);
    assert.deepStrictEqual(api.calls, [['setTopbarVisible', true]]);
  });

  it('导航条可见时再点导航图标：收起并通知主进程', () => {
    navToggle().click();
    navToggle().click();
    assert.strictEqual(navbar().classList.contains('visible'), false);
    assert.deepStrictEqual(api.calls, [['setTopbarVisible', true], ['setTopbarVisible', false]]);
  });

  it('导航条 mouseleave：600ms 内不收起，超时后收起并通知主进程', () => {
    navToggle().click();
    urlInput().blur();
    navbar().dispatchEvent(new MouseEvent('mouseenter'));
    navbar().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(599);
    assert.strictEqual(navbar().classList.contains('visible'), true);
    vi.advanceTimersByTime(1);
    assert.strictEqual(navbar().classList.contains('visible'), false);
    assert.deepStrictEqual(api.calls, [['setTopbarVisible', true], ['setTopbarVisible', false]]);
  });

  it('导航条 mouseenter 取消待执行的收起', () => {
    navToggle().click();
    urlInput().blur();
    navbar().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(300);
    navbar().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(1000);
    assert.strictEqual(navbar().classList.contains('visible'), true);
  });

  it('URL 输入框聚焦期间：即使鼠标离开导航条也不收起', () => {
    navToggle().click();
    navbar().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(2000);
    assert.strictEqual(navbar().classList.contains('visible'), true);
  });

  it('URL 输入框 blur 后重新计时，600ms 收起', () => {
    navToggle().click();
    navbar().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(2000);
    assert.strictEqual(navbar().classList.contains('visible'), true);
    urlInput().blur();
    vi.advanceTimersByTime(600);
    assert.strictEqual(navbar().classList.contains('visible'), false);
  });

  it('Ctrl+L（壳聚焦）：唤出导航条、聚焦 URL 输入框、preventDefault', () => {
    const e = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    assert.strictEqual(e.defaultPrevented, true);
    assert.strictEqual(navbar().classList.contains('visible'), true);
    assert.strictEqual(document.activeElement === urlInput(), true);
  });

  it('Cmd+L（壳聚焦，macOS 惯例）：同样唤出导航条并聚焦 URL 输入框', () => {
    const e = new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    assert.strictEqual(e.defaultPrevented, true);
    assert.strictEqual(navbar().classList.contains('visible'), true);
    assert.strictEqual(document.activeElement === urlInput(), true);
  });

  it('壳重载回放：panelRestore 带 topbarVisible=true 时恢复导航条可见', () => {
    api.handlers.panelRestore({ panelId: null, topbarVisible: true });
    assert.strictEqual(navbar().classList.contains('visible'), true);
    assert.deepStrictEqual(api.calls, [['setTopbarVisible', true]]);
  });

  it('壳重载回放：topbarVisible=false 时导航条保持隐藏、不通知主进程', () => {
    api.handlers.panelRestore({ panelId: null, topbarVisible: false });
    assert.strictEqual(navbar().classList.contains('visible'), false);
    assert.deepStrictEqual(api.calls, []);
  });

  it('主进程 relay：onFocusUrl 唤出导航条并聚焦 URL 输入框', () => {
    api.handlers.focusUrl();
    assert.strictEqual(navbar().classList.contains('visible'), true);
    assert.strictEqual(document.activeElement === urlInput(), true);
    assert.deepStrictEqual(api.calls, [['setTopbarVisible', true]]);
  });

  it('导航条已可见时重复唤出：不重复通知主进程', () => {
    api.handlers.focusUrl();
    api.handlers.focusUrl();
    assert.deepStrictEqual(api.calls, [['setTopbarVisible', true]]);
  });
});

describe('formatTokenCount()', () => {
  it('保留现有格式化逻辑', () => {
    assert.strictEqual(formatTokenCount(0), '0');
    assert.strictEqual(formatTokenCount(56100), '5.61万');
    assert.strictEqual(formatTokenCount(123456789), '1.23亿');
    assert.strictEqual(formatTokenCount(9999), '9999');
    assert.strictEqual(formatTokenCount(NaN), '0');
    assert.strictEqual(formatTokenCount(-5), '0');
  });
});

describe('导航条保留行为', () => {
  it('URL 输入回车触发 navigate（自动补 https://）', () => {
    const input = document.getElementById('url-input');
    input.value = 'example.com';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepStrictEqual(api.calls, [['navigate', 'https://example.com']]);
  });

  it('onUrlUpdated 更新输入框与前进/后退按钮态', () => {
    api.handlers.url({ url: 'https://a.com/', canGoBack: true, canGoForward: false });
    assert.strictEqual(document.getElementById('url-input').value, 'https://a.com/');
    assert.strictEqual(document.getElementById('btn-back').classList.contains('disabled'), false);
    assert.strictEqual(document.getElementById('btn-forward').classList.contains('disabled'), true);
  });

  it('状态栏已删除', () => {
    assert.strictEqual(document.querySelector('.statusbar') === null, true);
  });
});

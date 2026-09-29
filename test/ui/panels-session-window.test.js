// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/panels.js + shell.html 面板内容测试（会话 / 窗口）。
 * 标记 HTML 直接读自 src/ui/shell.html，与 shell-layout.test.js 同一来源。
 * 断言只取原始值，不把已挂载 DOM 节点放进 actual/expected。
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupDom } from '../helpers/dom';
import { initShell } from '../../src/ui/shell.js';
import { initPanels } from '../../src/ui/panels.js';

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

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

function makeApi(overrides) {
  const calls = [];
  const api = {
    calls,
    setPanelOpen: () => {},
    listSessions: async () => ({ success: true, sessions: [] }),
    navigateSession: async (sessionId) => { calls.push(['navigateSession', sessionId]); return { success: true }; },
    listProfiles: async () => ({ success: true, profiles: [] }),
    listProviders: async () => ({ success: true, providers: [] }),
    openProfileWindow: async (profileId) => { calls.push(['openProfileWindow', profileId]); return { success: true, focused: true }; },
    setProfileAutoOpen: async (profileId, autoOpen) => { calls.push(['setProfileAutoOpen', profileId, autoOpen]); return { success: true }; },
    deleteProfileWindow: async (profileId) => { calls.push(['deleteProfileWindow', profileId]); return { success: true }; },
    createProfileWindow: async () => { calls.push(['createProfileWindow']); return { success: true }; },
    ...overrides,
  };
  return api;
}

let ctx;
let api;

beforeEach(() => {
  ctx = setupDom(readShellBody());
  api = makeApi();
  const panels = initPanels(api, document);
  initShell(api, document, { onPanelChange: panels.handlePanelChange });
});

afterEach(() => {
  ctx.cleanup();
});

function clickRail(panelId) {
  document.querySelector('.rail-btn[data-panel="' + panelId + '"]').click();
}

describe('会话面板', () => {
  it('点击「会话」图标：调用 listSessions 并渲染会话项', async () => {
    api.listSessions = async () => ({ success: true, sessions: ['abc123', 'def456'] });
    clickRail('chat');
    await flush();

    const items = document.querySelectorAll('#shell-session-list .session-item');
    assert.strictEqual(items.length, 2);
    const ids = Array.from(items).map((el) => el.dataset.sessionId);
    assert.deepStrictEqual(ids, ['abc123', 'def456']);
    assert.strictEqual(items[0].querySelector('.session-id').textContent, 'abc123');
    // 「跳转」尾巴已删除（#17）：hover 样式由 CSS 承担，不再渲染动作文字
    assert.strictEqual(items[0].querySelector('.session-action'), null);
  });

  it('空会话列表显示「暂无会话」', async () => {
    clickRail('chat');
    await flush();
    const empty = document.querySelector('#shell-session-list .panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, '暂无会话');
  });

  it('listSessions 缺失时显示「API 不可用」', async () => {
    delete api.listSessions;
    clickRail('chat');
    await flush();
    const empty = document.querySelector('#shell-session-list .panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, 'API 不可用');
  });

  it('会话 id 含 HTML 特殊字符时按文本渲染，不产生注入元素', async () => {
    api.listSessions = async () => ({ success: true, sessions: ['<img src=x onerror=alert(1)>'] });
    clickRail('chat');
    await flush();
    const list = document.getElementById('shell-session-list');
    assert.strictEqual(list.querySelector('img') === null, true);
    const idEl = list.querySelector('.session-id');
    assert.strictEqual(idEl.textContent, '<img src=x onerror=alert(1)>');
  });

  it('点击会话项：调用 navigateSession(sessionId)', async () => {
    api.listSessions = async () => ({ success: true, sessions: ['sid-1'] });
    clickRail('chat');
    await flush();

    document.querySelector('#shell-session-list .session-item').click();
    await flush();
    assert.deepStrictEqual(api.calls, [['navigateSession', 'sid-1']]);
  });

  it('navigateSession 失败时 toast 提示导航失败', async () => {
    api.listSessions = async () => ({ success: true, sessions: ['sid-1'] });
    api.navigateSession = async () => ({ success: false, error: '无 URL' });
    clickRail('chat');
    await flush();

    document.querySelector('#shell-session-list .session-item').click();
    await flush();
    const toast = document.getElementById('panel-toast');
    assert.strictEqual(toast.hidden, false);
    assert.strictEqual(toast.textContent.includes('导航失败'), true);
  });
});

describe('窗口面板', () => {
  const profiles = [
    { id: 'p1', name: '主窗口', providerId: 'deepseek', autoOpen: true },
    { id: 'p2', name: '副窗口', providerId: 'zhipu', autoOpen: false },
  ];
  const providers = [
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'zhipu', name: '智谱' },
  ];

  beforeEach(() => {
    api.listProfiles = async () => ({ success: true, profiles });
    api.listProviders = async () => ({ success: true, providers });
  });

  it('点击「窗口」图标：渲染 profile 名 / 平台名 / 默认勾选态', async () => {
    clickRail('window');
    await flush();
    await flush();

    const items = document.querySelectorAll('#shell-window-list .window-item');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].querySelector('.window-name').textContent, '主窗口');
    assert.strictEqual(items[0].querySelector('.window-status').textContent, 'DeepSeek');
    assert.strictEqual(items[0].querySelector('.window-auto input').checked, true);
    assert.strictEqual(items[1].querySelector('.window-auto input').checked, false);
  });

  it('profile 名含 HTML 特殊字符时按文本渲染', async () => {
    api.listProfiles = async () => ({
      success: true,
      profiles: [{ id: 'px', name: '<script>alert(1)</script>', providerId: '', autoOpen: false }],
    });
    clickRail('window');
    await flush();
    await flush();

    const list = document.getElementById('shell-window-list');
    assert.strictEqual(list.querySelector('script') === null, true);
    assert.strictEqual(list.querySelector('.window-name').textContent, '<script>alert(1)</script>');
  });

  it('勾选「默认」：调用 setProfileAutoOpen(profileId, true)', async () => {
    clickRail('window');
    await flush();
    await flush();

    const cb = document.querySelectorAll('#shell-window-list .window-auto input')[1];
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    assert.deepStrictEqual(api.calls, [['setProfileAutoOpen', 'p2', true]]);
  });

  it('setProfileAutoOpen 失败时回滚勾选态', async () => {
    api.setProfileAutoOpen = async () => ({ success: false, error: '窗口不存在' });
    clickRail('window');
    await flush();
    await flush();

    const cb = document.querySelectorAll('#shell-window-list .window-auto input')[1];
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    assert.strictEqual(cb.checked, false);
  });

  it('点击「删除」：调用 deleteProfileWindow 并重新渲染列表', async () => {
    let listCalls = 0;
    api.listProfiles = async () => { listCalls++; return { success: true, profiles }; };
    clickRail('window');
    await flush();
    await flush();
    const before = listCalls;

    document.querySelector('#shell-window-list .window-del').click();
    await flush();
    assert.deepStrictEqual(api.calls, [['deleteProfileWindow', 'p1']]);
    assert.strictEqual(listCalls > before, true);
  });

  it('点击窗口项：调用 openProfileWindow(profileId)', async () => {
    clickRail('window');
    await flush();
    await flush();

    document.querySelectorAll('#shell-window-list .window-item')[1].click();
    await flush();
    assert.deepStrictEqual(api.calls, [['openProfileWindow', 'p2']]);
  });

  it('点击复选框区域不触发打开窗口', async () => {
    clickRail('window');
    await flush();
    await flush();

    const label = document.querySelector('#shell-window-list .window-auto');
    label.click();
    await flush();
    // 点击 label 会切换 checkbox 并触发 setProfileAutoOpen，但不得打开窗口
    assert.strictEqual(api.calls.some((c) => c[0] === 'openProfileWindow'), false);
  });

  it('「新建窗口」按钮：调用 createProfileWindow 并刷新列表', async () => {
    let listCalls = 0;
    api.listProfiles = async () => { listCalls++; return { success: true, profiles }; };
    clickRail('window');
    await flush();
    await flush();
    const before = listCalls;

    document.getElementById('shell-btn-new-window').click();
    await flush();
    assert.deepStrictEqual(api.calls, [['createProfileWindow']]);
    assert.strictEqual(listCalls > before, true);
  });

  it('空 profile 列表显示「暂无窗口」', async () => {
    api.listProfiles = async () => ({ success: true, profiles: [] });
    clickRail('window');
    await flush();

    const empty = document.querySelector('#shell-window-list .panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, '暂无窗口');
  });
});

describe('面板内容切换', () => {
  it('打开面板只显示对应内容容器，切换/收起时正确显隐', async () => {
    const contentOf = (id) => document.querySelector('.panel-content[data-panel-content="' + id + '"]');
    assert.strictEqual(contentOf('chat').hidden, true);

    clickRail('chat');
    await flush();
    assert.strictEqual(contentOf('chat').hidden, false);
    assert.strictEqual(contentOf('window').hidden, true);

    clickRail('mcp');
    await flush();
    assert.strictEqual(contentOf('chat').hidden, true);
    assert.strictEqual(contentOf('mcp').hidden, false);

    // 收起面板：全部隐藏
    document.getElementById('panel-close').click();
    for (const c of document.querySelectorAll('.panel-content')) {
      assert.strictEqual(c.hidden, true);
    }
  });
});

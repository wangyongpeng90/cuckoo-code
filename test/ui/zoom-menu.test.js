// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/zoom-menu.html + zoom-menu.js 测试（原生子窗口 mini 菜单，分段控件形态）。
 * 覆盖：分段控件（- / 倍率 / +）+ 重置行渲染、点击调用 api.apply(action)、
 * onInit/onZoom 更新倍率显示、快捷键 kbd 按平台显示。
 * 标记 HTML 直接读自 src/ui/zoom-menu.html，避免测试与实现脱节。
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupDom } from '../helpers/dom';
import { initZoomMenu } from '../../src/ui/zoom-menu.js';

const MENU_HTML = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/ui/zoom-menu.html'
);

function readMenuBody() {
  const html = fs.readFileSync(MENU_HTML, 'utf-8');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  assert.ok(m, 'zoom-menu.html 缺少 <body>');
  return m[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

function makeApi(platform) {
  const calls = [];
  const handlers = {};
  const api = {
    calls,
    handlers,
    platform: platform || '',
    apply: (action) => { calls.push(['apply', action]); },
    onInit: (cb) => { handlers.init = cb; },
    onZoom: (cb) => { handlers.zoom = cb; },
  };
  return api;
}

let ctx;
let api;

beforeEach(() => {
  ctx = setupDom(readMenuBody());
  api = makeApi();
  initZoomMenu(api, document);
});

afterEach(() => {
  ctx.cleanup();
});

describe('缩放 mini 菜单（分段控件）', () => {
  it('渲染分段控件（− 100% ＋）与重置行，均带 SVG/kbd', () => {
    assert.strictEqual(document.getElementById('zoom-value').textContent, '100%');
    assert.ok(document.querySelector('.zoom-segment'));
    const actions = Array.from(document.querySelectorAll('[data-zoom]')).map((b) => b.dataset.zoom);
    assert.deepStrictEqual(actions, ['out', 'in', 'reset']);
    for (const btn of document.querySelectorAll('[data-zoom]')) {
      assert.strictEqual(btn.querySelector('svg') !== null, true);
    }
    assert.strictEqual(document.getElementById('zoom-reset-kbd') !== null, true);
  });

  it('点击项：调用 api.apply(action)', () => {
    document.querySelector('[data-zoom="in"]').click();
    document.querySelector('[data-zoom="out"]').click();
    document.querySelector('[data-zoom="reset"]').click();
    assert.deepStrictEqual(api.calls, [['apply', 'in'], ['apply', 'out'], ['apply', 'reset']]);
  });

  it('onInit：主进程打开时回传当前倍率（1.3 → 130%）', () => {
    api.handlers.init({ zoomFactor: 1.3 });
    assert.strictEqual(document.getElementById('zoom-value').textContent, '130%');
  });

  it('onZoom：连续缩放时实时刷新倍率（1.1 → 110%）', () => {
    api.handlers.zoom({ zoomFactor: 1.1 });
    assert.strictEqual(document.getElementById('zoom-value').textContent, '110%');
  });

  it('快捷键提示按平台显示：darwin → ⌘0，win32 → Ctrl+0，未知平台保留默认', () => {
    ctx.cleanup();
    ctx = setupDom(readMenuBody());
    const macApi = makeApi('darwin');
    initZoomMenu(macApi, document);
    assert.strictEqual(document.getElementById('zoom-reset-kbd').textContent, '⌘0');

    ctx.cleanup();
    ctx = setupDom(readMenuBody());
    const winApi = makeApi('win32');
    initZoomMenu(winApi, document);
    assert.strictEqual(document.getElementById('zoom-reset-kbd').textContent, 'Ctrl+0');

    ctx.cleanup();
    ctx = setupDom(readMenuBody());
    const bareApi = makeApi('');
    initZoomMenu(bareApi, document);
    assert.strictEqual(document.getElementById('zoom-reset-kbd').textContent, '⌘0'); // HTML 默认
  });

  it('setLabel 保留导出（供测试/复用直接设置）', () => {
    const ret = initZoomMenu(api, document);
    ret.setLabel(2);
    assert.strictEqual(document.getElementById('zoom-value').textContent, '200%');
  });
});

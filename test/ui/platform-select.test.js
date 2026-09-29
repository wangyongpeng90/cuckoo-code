// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/platform-select.js 首页（平台选择页）测试。
 * 覆盖：快速操作区渲染、项目目录显示、initProject / updateProjectDir 调用、
 * 平台卡片列表回归（provider 名走 textContent，不拼 innerHTML）。
 * 标记 HTML 直接读自 src/ui/platform-select.html，与其他 ui 测试同一来源。
 * 断言只取原始值，不把已挂载 DOM 节点放进 actual/expected。
 */
import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupDom } from '../helpers/dom';
import { initPlatformSelect } from '../../src/ui/platform-select.js';

const PAGE_HTML = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/ui/platform-select.html'
);

function readPageBody() {
  const html = fs.readFileSync(PAGE_HTML, 'utf-8');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  assert.ok(m, 'platform-select.html 缺少 <body>');
  return m[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

function makeApi(overrides) {
  const calls = [];
  const api = {
    calls,
    listProviders: async () => {
      calls.push(['listProviders']);
      return {
        success: true,
        providers: [{ id: 'deepseek', name: 'DeepSeek', custom: false, path: null }],
      };
    },
    selectPlatform: async (id) => {
      calls.push(['selectPlatform', id]);
      return { success: true };
    },
    getProjectDir: async () => {
      calls.push(['getProjectDir']);
      return { success: true, projectDir: '/tmp/proj' };
    },
    initProject: async (...args) => {
      calls.push(['initProject', ...args]);
      return { success: true, message: '初始化完成' };
    },
    updateProjectDir: async () => {
      calls.push(['updateProjectDir']);
      return { success: true, message: '项目目录已更新' };
    },
    ...overrides,
  };
  return api;
}

let ctx;
let api;

beforeEach(async () => {
  ctx = setupDom(readPageBody());
  api = makeApi();
  initPlatformSelect(api, document);
  await flush();
  await flush();
  await flush();
});

afterEach(() => {
  ctx.cleanup();
});

function toast() {
  return document.getElementById('ps-toast');
}

function dirText() {
  return document.getElementById('ps-project-dir').textContent;
}

function hintHidden() {
  return document.getElementById('ps-dir-hint').hidden;
}

describe('快速操作区：渲染与项目目录', () => {
  it('渲染初始化（主按钮）与修改目录按钮', () => {
    const initBtn = document.getElementById('ps-btn-init-project');
    const changeBtn = document.getElementById('ps-btn-change-dir');
    assert.strictEqual(initBtn === null, false);
    assert.strictEqual(changeBtn === null, false);
    assert.strictEqual(initBtn.textContent, '初始化项目');
    assert.strictEqual(initBtn.classList.contains('primary'), true);
    assert.strictEqual(changeBtn.textContent, '修改项目目录');
  });

  it('有项目目录时显示路径，引导文案隐藏', async () => {
    await flush();
    assert.strictEqual(api.calls.some((c) => c[0] === 'getProjectDir'), true);
    assert.strictEqual(dirText(), '/tmp/proj');
    assert.strictEqual(hintHidden(), true);
  });

  it('未选择目录时显示「未选择」+ 引导文案', async () => {
    ctx.cleanup();
    ctx = setupDom(readPageBody());
    api = makeApi({
      getProjectDir: async () => ({ success: true, projectDir: null }),
    });
    initPlatformSelect(api, document);
    await flush();
    await flush();
    assert.strictEqual(dirText(), '未选择');
    assert.strictEqual(hintHidden(), false);
  });

  it('getProjectDir 缺失时不报错、保持「未选择」+ 引导文案', async () => {
    ctx.cleanup();
    ctx = setupDom(readPageBody());
    api = makeApi();
    delete api.getProjectDir;
    initPlatformSelect(api, document);
    await flush();
    await flush();
    assert.strictEqual(dirText(), '未选择');
    assert.strictEqual(hintHidden(), false);
  });
});

describe('快速操作区：初始化项目', () => {
  it('点击调用 initProject，期间按钮 busy，成功后恢复并 toast 提示', async () => {
    let resolveInit;
    api.initProject = () => new Promise((r) => { resolveInit = r; });
    const btn = document.getElementById('ps-btn-init-project');
    btn.click();
    await flush();
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn.textContent, '初始化中...');
    resolveInit({ success: true, message: '初始化完成' });
    await flush();
    await flush();
    assert.strictEqual(btn.disabled, false);
    assert.strictEqual(btn.textContent, '初始化项目');
    assert.strictEqual(toast().hidden, false);
    assert.strictEqual(toast().textContent, '初始化完成');
    assert.strictEqual(toast().classList.contains('error'), false);
  });

  it('初始化成功后重新拉取项目目录', async () => {
    document.getElementById('ps-btn-init-project').click();
    await flush();
    await flush();
    await flush();
    const dirCalls = api.calls.filter((c) => c[0] === 'getProjectDir').length;
    assert.strictEqual(dirCalls >= 2, true);
  });

  it('初始化项目传 skipPrompt=true（首页无聊天输入框，不发初始提示）', async () => {
    document.getElementById('ps-btn-init-project').click();
    await flush();
    await flush();
    const call = api.calls.find((c) => c[0] === 'initProject');
    assert.strictEqual(call !== undefined, true);
    assert.strictEqual(call[call.length - 1], true);
  });

  it('初始化失败时 toast 显示 message（error 样式）', async () => {
    api.initProject = async () => ({ success: false, message: '目录不可写' });
    document.getElementById('ps-btn-init-project').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '目录不可写');
    assert.strictEqual(toast().classList.contains('error'), true);
  });

  it('用户取消目录选择：toast 中性样式（非 error）', async () => {
    api.initProject = async () => ({ success: false, canceled: true, message: '用户取消了目录选择' });
    document.getElementById('ps-btn-init-project').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '用户取消了目录选择');
    assert.strictEqual(toast().classList.contains('error'), false);
  });

  it('initProject 缺失时提示 API 不可用', async () => {
    delete api.initProject;
    document.getElementById('ps-btn-init-project').click();
    await flush();
    assert.strictEqual(toast().textContent, 'API 不可用');
    assert.strictEqual(toast().classList.contains('error'), true);
  });
});

describe('快速操作区：修改项目目录', () => {
  it('点击调用 updateProjectDir，成功 toast 提示', async () => {
    document.getElementById('ps-btn-change-dir').click();
    await flush();
    await flush();
    assert.strictEqual(api.calls.some((c) => c[0] === 'updateProjectDir'), true);
    assert.strictEqual(toast().textContent, '项目目录已更新');
    assert.strictEqual(toast().classList.contains('error'), false);
  });

  it('修改目录期间按钮 busy，结束后恢复', async () => {
    let resolveUpdate;
    api.updateProjectDir = () => new Promise((r) => { resolveUpdate = r; });
    const btn = document.getElementById('ps-btn-change-dir');
    btn.click();
    await flush();
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn.textContent, '修改中...');
    resolveUpdate({ success: true, message: '项目目录已更新' });
    await flush();
    await flush();
    assert.strictEqual(btn.disabled, false);
    assert.strictEqual(btn.textContent, '修改项目目录');
  });

  it('修改目录失败时 toast 显示 message（error 样式）', async () => {
    api.updateProjectDir = async () => ({ success: false, message: '目录不可写' });
    document.getElementById('ps-btn-change-dir').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '目录不可写');
    assert.strictEqual(toast().classList.contains('error'), true);
  });

  it('用户取消目录选择：toast 中性样式（非 error）', async () => {
    api.updateProjectDir = async () => ({ success: false, canceled: true, message: '用户取消了目录选择' });
    document.getElementById('ps-btn-change-dir').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '用户取消了目录选择');
    assert.strictEqual(toast().classList.contains('error'), false);
  });
});

describe('平台卡片：删除二次确认', () => {
  async function setupCustomProvider(removeImpl) {
    ctx.cleanup();
    ctx = setupDom(readPageBody());
    api = makeApi({
      listProviders: async () => {
        api.calls.push(['listProviders']);
        return {
          success: true,
          providers: [{ id: 'mine', name: 'Mine', custom: true, path: '/tmp/mine.js' }],
        };
      },
      removeProvider: removeImpl || (async (filePath, providerId) => {
        api.calls.push(['removeProvider', filePath, providerId]);
        return { success: true };
      }),
    });
    initPlatformSelect(api, document);
    await flush();
    await flush();
    await flush();
  }

  it('第一次点击 ×：变「确认删除？」，不调用 removeProvider', async () => {
    await setupCustomProvider();
    const btn = document.querySelector('.platform-delete');
    btn.click();
    await flush();
    assert.strictEqual(btn.textContent, '确认删除？');
    assert.strictEqual(btn.classList.contains('confirming'), true);
    assert.strictEqual(api.calls.some((c) => c[0] === 'removeProvider'), false);
  });

  it('3 秒未确认自动还原为 ×', async () => {
    await setupCustomProvider();
    vi.useFakeTimers();
    try {
      const btn = document.querySelector('.platform-delete');
      btn.click();
      assert.strictEqual(btn.classList.contains('confirming'), true);
      vi.advanceTimersByTime(3000);
      assert.strictEqual(btn.classList.contains('confirming'), false);
      assert.strictEqual(btn.textContent, '×');
    } finally {
      vi.useRealTimers();
    }
  });

  it('确认期内第二次点击：调用 removeProvider，成功 toast 并刷新列表', async () => {
    await setupCustomProvider();
    const listCallsBefore = api.calls.filter((c) => c[0] === 'listProviders').length;
    const btn = document.querySelector('.platform-delete');
    btn.click();
    await flush();
    btn.click();
    await flush();
    await flush();
    assert.deepStrictEqual(
      api.calls.find((c) => c[0] === 'removeProvider'),
      ['removeProvider', '/tmp/mine.js', 'mine']
    );
    assert.strictEqual(api.calls.filter((c) => c[0] === 'listProviders').length > listCallsBefore, true);
    assert.strictEqual(toast().textContent, '已删除 Provider');
    assert.strictEqual(toast().classList.contains('error'), false);
  });

  it('删除失败：toast error 提示，按钮已还原', async () => {
    await setupCustomProvider(async () => ({ success: false, error: '窗口使用中' }));
    const btn = document.querySelector('.platform-delete');
    btn.click();
    await flush();
    btn.click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '删除失败: 窗口使用中');
    assert.strictEqual(toast().classList.contains('error'), true);
    assert.strictEqual(btn.classList.contains('confirming'), false);
  });
});

describe('平台列表回归', () => {
  it('渲染平台卡片 + 导入卡片', () => {
    const cards = document.querySelectorAll('.platform-card[data-id]');
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].dataset.id, 'deepseek');
    assert.strictEqual(document.getElementById('platform-import-card') === null, false);
  });

  it('provider 名走 textContent（不拼 innerHTML）', async () => {
    ctx.cleanup();
    ctx = setupDom(readPageBody());
    const rawName = 'A<img src=x onerror=alert(1)>';
    api = makeApi({
      listProviders: async () => ({
        success: true,
        providers: [{ id: 'evil', name: rawName, custom: false, path: null }],
      }),
    });
    initPlatformSelect(api, document);
    await flush();
    await flush();
    const nameEl = document.querySelector('.platform-card[data-id="evil"] .platform-name');
    assert.strictEqual(nameEl === null, false);
    assert.strictEqual(nameEl.textContent, rawName);
    assert.strictEqual(nameEl.children.length, 0);
  });

  it('点击平台卡片调用 selectPlatform', async () => {
    document.querySelector('.platform-card[data-id="deepseek"]').click();
    await flush();
    assert.deepStrictEqual(api.calls.find((c) => c[0] === 'selectPlatform'), ['selectPlatform', 'deepseek']);
  });

  it('listProviders 缺失时显示 API 未就绪', async () => {
    ctx.cleanup();
    ctx = setupDom(readPageBody());
    api = makeApi();
    delete api.listProviders;
    initPlatformSelect(api, document);
    await flush();
    assert.strictEqual(document.getElementById('platform-list').textContent, 'API 未就绪，请重启应用');
  });
});

// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/panels.js 任务面板测试：
 * 打开面板拉全量（getToolHistory）、增量更新（onToolActivity 同 id 覆盖）、
 * 当前命令区（running spinner / done 输出）、历史条目点击展开详情、清空按钮。
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

function entry(id, overrides) {
  return {
    id: String(id),
    command: '[JS] echo ' + id,
    success: true,
    canceled: false,
    output: 'out ' + id,
    timestamp: Date.now(),
    status: 'done',
    ...(overrides || {}),
  };
}

let ctx;
let api;
let activityCb;
let historyEntries;

function makeApi() {
  const calls = [];
  return {
    calls,
    setPanelOpen: () => {},
    getToolHistory: async () => {
      calls.push(['getToolHistory']);
      return { success: true, entries: historyEntries.slice() };
    },
    clearToolHistory: async () => {
      calls.push(['clearToolHistory']);
      return { success: true };
    },
    onToolActivity: (cb) => { activityCb = cb; },
  };
}

beforeEach(() => {
  ctx = setupDom(readShellBody());
  historyEntries = [];
  activityCb = null;
  api = makeApi();
  const panels = initPanels(api, document);
  initShell(api, document, { onPanelChange: panels.handlePanelChange });
});

afterEach(() => {
  ctx.cleanup();
});

function openTaskPanel() {
  document.querySelector('.rail-btn[data-panel="task"]').click();
}

function taskList() {
  return document.getElementById('shell-task-list');
}

function taskCurrent() {
  return document.getElementById('shell-task-current');
}

describe('任务面板：打开拉取全量', () => {
  it('空历史显示「暂无记录」，当前命令区隐藏', async () => {
    openTaskPanel();
    await flush();
    assert.deepStrictEqual(api.calls, [['getToolHistory']]);
    const empty = taskList().querySelector('.panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, '暂无记录');
    assert.strictEqual(taskCurrent().hidden, true);
  });

  it('最新一条进当前命令区，其余进历史列表', async () => {
    historyEntries = [entry('new'), entry('mid'), entry('old')];
    openTaskPanel();
    await flush();

    assert.strictEqual(taskCurrent().hidden, false);
    assert.strictEqual(
      document.getElementById('shell-task-current-command').textContent,
      '[JS] echo new'
    );
    const out = document.getElementById('shell-task-current-output');
    assert.strictEqual(out.hidden, false);
    assert.strictEqual(out.textContent, 'out new');

    const items = taskList().querySelectorAll('.task-item');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].dataset.taskId, 'mid');
    assert.strictEqual(items[1].dataset.taskId, 'old');
  });

  it('只有一条时历史列表不显示空态（当前区已展示）', async () => {
    historyEntries = [entry('only')];
    openTaskPanel();
    await flush();
    assert.strictEqual(taskList().querySelector('.panel-empty') === null, true);
    assert.strictEqual(taskList().querySelectorAll('.task-item').length, 0);
  });
});

describe('任务面板：当前命令状态', () => {
  it('running：状态区带 spinner，输出区隐藏', async () => {
    historyEntries = [entry('r', { status: 'running', output: '' })];
    openTaskPanel();
    await flush();

    const status = document.getElementById('shell-task-current-status');
    assert.strictEqual(status.className.includes('running'), true);
    assert.strictEqual(status.querySelector('.task-spinner') !== null, true);
    assert.strictEqual(status.textContent.includes('执行中'), true);
    assert.strictEqual(document.getElementById('shell-task-current-output').hidden, true);
  });

  it('失败：状态 error 文案与 class，输出展示', async () => {
    historyEntries = [entry('f', { success: false, output: 'boom' })];
    openTaskPanel();
    await flush();

    const status = document.getElementById('shell-task-current-status');
    assert.strictEqual(status.className.includes('error'), true);
    assert.strictEqual(status.textContent.includes('失败'), true);
    assert.strictEqual(document.getElementById('shell-task-current-output').textContent, 'boom');
  });

  it('成功但无输出：显示「(无输出)」', async () => {
    historyEntries = [entry('s', { output: '' })];
    openTaskPanel();
    await flush();
    assert.strictEqual(
      document.getElementById('shell-task-current-output').textContent,
      '(无输出)'
    );
  });
});

describe('任务面板：增量更新', () => {
  it('新条目插入最前并成为当前命令', async () => {
    historyEntries = [entry('old')];
    openTaskPanel();
    await flush();

    activityCb(entry('new', { status: 'running', output: '' }));
    assert.strictEqual(
      document.getElementById('shell-task-current-command').textContent,
      '[JS] echo new'
    );
    const items = taskList().querySelectorAll('.task-item');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].dataset.taskId, 'old');
  });

  it('同 id 更新（running → done）：不新增条目，状态与输出刷新', async () => {
    openTaskPanel();
    await flush();

    activityCb(entry('x', { status: 'running', output: '' }));
    activityCb(entry('x', { status: 'done', output: 'finished' }));

    const items = taskList().querySelectorAll('.task-item');
    assert.strictEqual(items.length, 0);
    assert.strictEqual(taskCurrent().hidden, false);
    const status = document.getElementById('shell-task-current-status');
    assert.strictEqual(status.className.includes('success'), true);
    assert.strictEqual(document.getElementById('shell-task-current-output').textContent, 'finished');
  });

  it('面板未打开时收到增量：只更新数据，不强制展开面板', async () => {
    activityCb(entry('x'));
    const panel = document.getElementById('side-panel');
    assert.strictEqual(panel.hidden, true);

    openTaskPanel();
    // 打开后拉全量（mock 返回空），但增量渲染已发生；此处验证打开前未弹出面板即可
  });

  it('增量更新超过 50 条截断', async () => {
    openTaskPanel();
    await flush();
    for (let i = 0; i < 55; i++) activityCb(entry('id' + i));
    assert.strictEqual(
      document.getElementById('shell-task-current-command').textContent,
      '[JS] echo id54'
    );
    // 当前区 1 条 + 历史 49 条 = 50
    assert.strictEqual(taskList().querySelectorAll('.task-item').length, 49);
  });
});

describe('任务面板：历史条目交互', () => {
  it('点击条目展开详情（完整命令 + 输出），再点收起', async () => {
    historyEntries = [entry('cur'), entry('h', { output: 'detail output' })];
    openTaskPanel();
    await flush();

    const item = taskList().querySelector('.task-item');
    const detail = item.querySelector('.task-item-detail');
    assert.strictEqual(detail.hidden, true);

    item.click();
    assert.strictEqual(detail.hidden, false);
    assert.strictEqual(detail.querySelector('.task-detail-command').textContent, '[JS] echo h');
    assert.strictEqual(detail.querySelector('.task-output').textContent, 'detail output');

    item.click();
    assert.strictEqual(detail.hidden, true);
  });

  it('命令含 HTML 注入时按纯文本渲染，不产生 img 元素', async () => {
    historyEntries = [entry('cur'), entry('x', { command: '<img src=x onerror=alert(1)>' })];
    openTaskPanel();
    await flush();

    assert.strictEqual(taskList().querySelector('img') === null, true);
    assert.strictEqual(
      taskList().querySelector('.task-item-command').textContent,
      '<img src=x onerror=alert(1)>'
    );
  });

  it('长命令：列表截断显示，详情展开显示全文', async () => {
    const longCmd = '[JS] ' + 'b'.repeat(100);
    historyEntries = [entry('cur'), entry('h', { command: longCmd })];
    openTaskPanel();
    await flush();

    const head = taskList().querySelector('.task-item-command');
    assert.ok(head.textContent.endsWith('...'));
    assert.ok(head.textContent.length < longCmd.length);

    taskList().querySelector('.task-item').click();
    const detail = taskList().querySelector('.task-item-detail');
    assert.strictEqual(detail.hidden, false);
    assert.strictEqual(detail.querySelector('.task-detail-command').textContent, longCmd);
  });

  it('「清空」按钮：调用 clearToolHistory 并清空界面', async () => {
    historyEntries = [entry('a'), entry('b')];
    openTaskPanel();
    await flush();
    api.calls.length = 0;

    document.getElementById('shell-btn-clear-tasks').click();
    await flush();

    assert.deepStrictEqual(api.calls, [['clearToolHistory']]);
    assert.strictEqual(taskCurrent().hidden, true);
    const empty = taskList().querySelector('.panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, '暂无记录');
  });
});

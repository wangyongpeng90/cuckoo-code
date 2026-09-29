// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/panels.js MCP 面板测试（列表 / JSON 编辑 / 保存 / 启停 / 通知 AI）。
 * 标记 HTML 直接读自 src/ui/shell.html，与 panels-session-window.test.js 同一来源。
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

const ALL_SERVERS = [
  { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'srv-fs'], source: 'user', enabled: true, connected: true },
  { name: 'web', type: 'http', url: 'https://mcp.example.com/sse', source: 'project', enabled: true, connected: false },
  { name: 'db', type: 'stdio', command: 'srv-db', args: [], source: 'user', enabled: false, connected: false },
];

function makeApi(overrides) {
  const calls = [];
  const api = {
    calls,
    setPanelOpen: () => {},
    listSessions: async () => ({ success: true, sessions: [] }),
    listProfiles: async () => ({ success: true, profiles: [] }),
    listMcpServers: async (opts) => {
      if (opts && opts.scope === 'user') {
        return {
          success: true,
          servers: [
            { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'srv-fs'], env: { A: '1' } },
            { name: 'web', type: 'http', url: 'https://mcp.example.com/sse', headers: { K: 'v' } },
          ],
        };
      }
      return { success: true, servers: ALL_SERVERS };
    },
    upsertMcpServer: async (server) => { calls.push(['upsertMcpServer', server]); return { success: true }; },
    removeMcpServer: async (name) => { calls.push(['removeMcpServer', name]); return { success: true }; },
    enableMcpServer: async (name) => { calls.push(['enableMcpServer', name]); return { success: true }; },
    disableMcpServer: async (name) => { calls.push(['disableMcpServer', name]); return { success: true }; },
    getMcpTools: async () => ({
      success: true,
      tools: [
        { server: 'fs', name: 'read' },
        { server: 'web', name: 'fetch' },
        { server: 'fs', name: 'write' },
      ],
    }),
    sendToChat: async (msg, tag, delayMs) => { calls.push(['sendToChat', msg, tag, delayMs]); return { success: true }; },
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

function openMcpPanel() {
  document.querySelector('.rail-btn[data-panel="mcp"]').click();
}

function toast() {
  return document.getElementById('panel-toast');
}

function notifyBar() {
  return document.getElementById('shell-mcp-notify');
}

function jsonInput() {
  return document.getElementById('shell-mcp-json');
}

async function setJsonAndSave(value) {
  jsonInput().value = value;
  document.getElementById('shell-btn-mcp-save').click();
  await flush();
  await flush();
}

describe('MCP 面板：列表', () => {
  it('点击「MCP」图标：渲染 server 名 / 来源标记 / 状态点', async () => {
    openMcpPanel();
    await flush();
    await flush();

    const items = document.querySelectorAll('#shell-mcp-list .mcp-item');
    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0].dataset.mcpName, 'fs');
    assert.strictEqual(items[0].querySelector('.mcp-name').textContent, 'fs');
    assert.strictEqual(items[0].querySelector('.mcp-src').textContent, '用户');
    assert.strictEqual(items[0].querySelector('.mcp-dot').className.includes('connected'), true);
    assert.strictEqual(items[0].querySelector('.mcp-dot').title, '已连接');
    assert.strictEqual(items[1].querySelector('.mcp-src').textContent, '项目');
    assert.strictEqual(items[1].querySelector('.mcp-dot').className.includes('enabled'), true);
    assert.strictEqual(items[1].querySelector('.mcp-dot').title, '未连接');
    assert.strictEqual(items[2].querySelector('.mcp-dot').className.includes('disabled'), true);
    assert.strictEqual(items[2].querySelector('.mcp-dot').title, '已禁用');
  });

  it('空列表显示「暂无 MCP Server」', async () => {
    api.listMcpServers = async () => ({ success: true, servers: [] });
    openMcpPanel();
    await flush();
    const empty = document.querySelector('#shell-mcp-list .panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, '暂无 MCP Server');
  });

  it('listMcpServers 缺失时显示「API 不可用」', async () => {
    delete api.listMcpServers;
    openMcpPanel();
    await flush();
    const empty = document.querySelector('#shell-mcp-list .panel-empty');
    assert.strictEqual(empty !== null, true);
    assert.strictEqual(empty.textContent, 'API 不可用');
  });

  it('server 名含 HTML 特殊字符时按文本渲染，不产生注入元素', async () => {
    api.listMcpServers = async (opts) => {
      if (opts && opts.scope === 'user') return { success: true, servers: [] };
      return { success: true, servers: [{ name: '<img src=x>', source: 'user', enabled: false, connected: false }] };
    };
    openMcpPanel();
    await flush();
    const list = document.getElementById('shell-mcp-list');
    assert.strictEqual(list.querySelector('img') === null, true);
    assert.strictEqual(list.querySelector('.mcp-name').textContent, '<img src=x>');
  });

  it('「刷新」按钮重新拉取列表', async () => {
    let listCalls = 0;
    api.listMcpServers = async (opts) => {
      if (!opts || opts.scope !== 'user') listCalls++;
      return { success: true, servers: [] };
    };
    openMcpPanel();
    await flush();
    const before = listCalls;

    document.getElementById('shell-btn-refresh-mcp').click();
    await flush();
    assert.strictEqual(listCalls, before + 1);
  });
});

describe('MCP 面板：启停切换', () => {
  it('点击已连接的 server：调用 disableMcpServer 并刷新列表与 JSON', async () => {
    openMcpPanel();
    await flush();
    await flush();

    document.querySelectorAll('#shell-mcp-list .mcp-item')[0].click();
    await flush();
    await flush();
    assert.deepStrictEqual(api.calls, [['disableMcpServer', 'fs']]);
  });

  it('点击已禁用的 server：调用 enableMcpServer', async () => {
    openMcpPanel();
    await flush();
    await flush();

    document.querySelectorAll('#shell-mcp-list .mcp-item')[2].click();
    await flush();
    await flush();
    assert.deepStrictEqual(api.calls, [['enableMcpServer', 'db']]);
  });
});

describe('MCP 面板：JSON 编辑框', () => {
  it('打开面板时按用户级配置填充 mcpServers JSON', async () => {
    openMcpPanel();
    await flush();
    await flush();

    const parsed = JSON.parse(jsonInput().value);
    assert.deepStrictEqual(Object.keys(parsed.mcpServers).sort(), ['fs', 'web']);
    assert.strictEqual(parsed.mcpServers.fs.command, 'npx');
    assert.deepStrictEqual(parsed.mcpServers.fs.args, ['-y', 'srv-fs']);
    assert.deepStrictEqual(parsed.mcpServers.fs.env, { A: '1' });
    assert.strictEqual(parsed.mcpServers.web.url, 'https://mcp.example.com/sse');
    assert.deepStrictEqual(parsed.mcpServers.web.headers, { K: 'v' });
    assert.strictEqual(parsed.mcpServers.web.command, undefined);
  });
});

describe('MCP 面板：保存校验', () => {
  it('空输入提示「请输入配置」，不调用写接口', async () => {
    openMcpPanel();
    await flush();
    await flush();
    await setJsonAndSave('   ');
    assert.strictEqual(toast().hidden, false);
    assert.strictEqual(toast().textContent, '请输入配置');
    assert.strictEqual(api.calls.length, 0);
    assert.strictEqual(notifyBar().hidden, true);
  });

  it('缺少 mcpServers 对象提示格式错误', async () => {
    openMcpPanel();
    await flush();
    await flush();
    await setJsonAndSave('{"foo": {}}');
    assert.strictEqual(toast().textContent, '配置格式错误，需要 mcpServers 对象');
    assert.strictEqual(api.calls.length, 0);
  });

  it('server 缺少 command/url 时中止保存并提示该 server 名', async () => {
    openMcpPanel();
    await flush();
    await flush();
    await setJsonAndSave('{"mcpServers": {"bad": {}}}');
    assert.strictEqual(toast().textContent.includes('"bad"'), true);
    assert.strictEqual(toast().textContent.includes('缺少 command 或 url'), true);
    assert.strictEqual(api.calls.length, 0);
  });

  it('同时指定 url 和 command 时中止保存', async () => {
    openMcpPanel();
    await flush();
    await flush();
    await setJsonAndSave('{"mcpServers": {"x": {"url": "https://a", "command": "b"}}}');
    assert.strictEqual(toast().textContent.includes('不能同时指定 url 和 command'), true);
    assert.strictEqual(api.calls.length, 0);
  });

  it('args 非数组时中止保存', async () => {
    openMcpPanel();
    await flush();
    await flush();
    await setJsonAndSave('{"mcpServers": {"x": {"command": "b", "args": "oops"}}}');
    assert.strictEqual(toast().textContent.includes('args 必须是数组'), true);
    assert.strictEqual(api.calls.length, 0);
  });

  it('JSON 语法错误提示保存失败', async () => {
    openMcpPanel();
    await flush();
    await flush();
    await setJsonAndSave('{not json');
    assert.strictEqual(toast().textContent.includes('保存失败'), true);
    assert.strictEqual(api.calls.length, 0);
  });
});

describe('MCP 面板：保存与通知 AI', () => {
  const NEW_CONFIG = JSON.stringify({
    mcpServers: {
      fs: { command: 'npx', args: ['-y', 'srv-fs'] },
      extra: { url: 'https://new.example.com/sse' },
    },
  }, null, 2);

  it('合法配置：删除缺失的用户级旧 server → 逐个 upsert → 显示通知确认条', async () => {
    openMcpPanel();
    await flush();
    await flush();

    await setJsonAndSave(NEW_CONFIG);
    await flush();
    await flush();

    // 用户级旧 server：fs、web；新配置：fs、extra → 删除 web
    assert.deepStrictEqual(api.calls[0], ['removeMcpServer', 'web']);
    const upserts = api.calls.filter((c) => c[0] === 'upsertMcpServer').map((c) => c[1]);
    assert.strictEqual(upserts.length, 2);
    assert.deepStrictEqual(upserts[0], { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'srv-fs'], url: undefined, headers: undefined, env: undefined });
    assert.deepStrictEqual(upserts[1], { name: 'extra', type: 'http', command: undefined, args: [], url: 'https://new.example.com/sse', headers: undefined, env: undefined });
    assert.strictEqual(notifyBar().hidden, false);
  });

  it('通知条「发送」：getMcpTools → sendToChat（含去重 server 名），并收起确认条', async () => {
    openMcpPanel();
    await flush();
    await flush();

    await setJsonAndSave(NEW_CONFIG);
    await flush();
    await flush();

    document.getElementById('shell-btn-mcp-notify-send').click();
    await flush();
    await flush();

    const send = api.calls.filter((c) => c[0] === 'sendToChat');
    assert.strictEqual(send.length, 1);
    assert.strictEqual(send[0][1].includes('【MCP 配置已更新】'), true);
    assert.strictEqual(send[0][1].includes('可用的 MCP server：fs、web'), true);
    assert.strictEqual(send[0][2], 'MCP信息');
    assert.strictEqual(send[0][3], 300);
    assert.strictEqual(notifyBar().hidden, true);
  });

  it('通知条「取消」：收起确认条，不发送消息', async () => {
    openMcpPanel();
    await flush();
    await flush();

    await setJsonAndSave(NEW_CONFIG);
    await flush();
    await flush();

    document.getElementById('shell-btn-mcp-notify-cancel').click();
    await flush();

    assert.strictEqual(notifyBar().hidden, true);
    assert.strictEqual(api.calls.some((c) => c[0] === 'sendToChat'), false);
  });

  it('无已连接 server 时通知消息说明没有已连接的 MCP server', async () => {
    api.getMcpTools = async () => ({ success: true, tools: [] });
    openMcpPanel();
    await flush();
    await flush();

    await setJsonAndSave(NEW_CONFIG);
    await flush();
    await flush();

    document.getElementById('shell-btn-mcp-notify-send').click();
    await flush();
    await flush();

    const send = api.calls.filter((c) => c[0] === 'sendToChat');
    assert.strictEqual(send.length, 1);
    assert.strictEqual(send[0][1].includes('当前没有已连接的 MCP server'), true);
  });
});

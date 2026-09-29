// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/panels.js 项目面板测试（Task 6）。
 * 覆盖：项目目录显示/修改、初始化项目、生成说明、催促继续、
 * token 五项明细、压缩、自动压缩设置、token 徽章联动、面板状态回放。
 * 标记 HTML 直接读自 src/ui/shell.html，与其他 panels 测试同一来源。
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
  const handlers = { token: [], total: [] };
  const fire = (list, data) => { for (const cb of list) cb(data); };
  const api = {
    calls,
    handlers: {
      token: (data) => fire(handlers.token, data),
      total: (data) => fire(handlers.total, data),
    },
    _handlers: handlers,
    setPanelOpen: (panelId) => { calls.push(['setPanelOpen', panelId]); },
    listSessions: async () => ({ success: true, sessions: [] }),
    getProjectDir: async () => {
      calls.push(['getProjectDir']);
      return { success: true, projectDir: '/tmp/proj' };
    },
    initProject: async () => {
      calls.push(['initProject']);
      return { success: true, message: '初始化完成' };
    },
    updateProjectDir: async () => {
      calls.push(['updateProjectDir']);
      return { success: true, message: '项目目录已更新' };
    },
    sendToChat: async (msg, tag, delayMs) => {
      calls.push(['sendToChat', msg, tag, delayMs]);
      return { success: true };
    },
    compact: async () => {
      calls.push(['compact']);
      return { success: true };
    },
    getSettings: async () => ({
      autoCompactEnabled: true,
      autoCompactThreshold: 66,
    }),
    saveSettings: async (patch) => {
      calls.push(['saveSettings', patch]);
      return { success: true, settings: { autoCompactEnabled: true, autoCompactThreshold: 66, ...patch } };
    },
    getSystemTotal: async () => {
      calls.push(['getSystemTotal']);
      return { success: true, systemTotal: 987654 };
    },
    onTokenUpdated: (cb) => { handlers.token.push(cb); },
    onTotalUpdated: (cb) => { handlers.total.push(cb); },
    onProjectDirUpdated: (cb) => { api.handlers.projectDir = cb; },
    onPanelRestore: (cb) => { api.handlers.panelRestore = cb; },
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
  initShell(api, document, { onPanelChange: panels.handlePanelChange, onRevealUsage: panels.revealUsage });
});

afterEach(() => {
  ctx.cleanup();
});

function openProjectPanel() {
  document.querySelector('.rail-btn[data-panel="project"]').click();
}

async function openAndLoad() {
  openProjectPanel();
  await flush();
  await flush();
  await flush();
}

function toast() {
  return document.getElementById('panel-toast');
}

function usageText(id) {
  return document.getElementById(id).textContent;
}

describe('项目面板：项目目录', () => {
  it('打开面板时 getProjectDir 拉取并显示目录', async () => {
    await openAndLoad();
    assert.strictEqual(api.calls.some((c) => c[0] === 'getProjectDir'), true);
    assert.strictEqual(document.getElementById('shell-project-dir-path').textContent, '/tmp/proj');
  });

  it('无目录时显示「未选择」', async () => {
    api.getProjectDir = async () => ({ success: true, projectDir: null });
    await openAndLoad();
    assert.strictEqual(document.getElementById('shell-project-dir-path').textContent, '未选择');
  });

  it('getProjectDir 缺失时不报错、保持默认文案', async () => {
    delete api.getProjectDir;
    await openAndLoad();
    assert.strictEqual(document.getElementById('shell-project-dir-path').textContent, '未选择');
  });

  it('onProjectDirUpdated 事件更新显示并刷新会话列表', async () => {
    let listCalls = 0;
    api.listSessions = async () => { listCalls++; return { success: true, sessions: [] }; };
    await openAndLoad();
    api.handlers.projectDir('/tmp/other');
    assert.strictEqual(document.getElementById('shell-project-dir-path').textContent, '/tmp/other');
    assert.strictEqual(listCalls >= 1, true);
  });

  it('修改目录按钮调用 updateProjectDir', async () => {
    await openAndLoad();
    document.getElementById('shell-btn-change-dir').click();
    await flush();
    assert.strictEqual(api.calls.some((c) => c[0] === 'updateProjectDir'), true);
  });

  it('修改目录失败时 toast 提示 message', async () => {
    api.updateProjectDir = async () => ({ success: false, message: '用户取消了目录选择' });
    await openAndLoad();
    document.getElementById('shell-btn-change-dir').click();
    await flush();
    assert.strictEqual(toast().textContent, '用户取消了目录选择');
  });
});

describe('项目面板：初始化项目', () => {
  it('点击调用 initProject，期间按钮 busy，结束后恢复', async () => {
    let resolveInit;
    api.initProject = () => new Promise((r) => { resolveInit = r; });
    await openAndLoad();
    const btn = document.getElementById('shell-btn-init-project');
    btn.click();
    await flush();
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn.textContent, '初始化中...');
    resolveInit({ success: true });
    await flush();
    await flush();
    assert.strictEqual(btn.disabled, false);
    assert.strictEqual(btn.textContent, '初始化项目');
  });

  it('初始化失败时 toast 显示 message', async () => {
    api.initProject = async () => ({ success: false, message: '用户取消了目录选择' });
    await openAndLoad();
    document.getElementById('shell-btn-init-project').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '用户取消了目录选择');
  });

  it('initProject 缺失时提示 API 不可用', async () => {
    delete api.initProject;
    await openAndLoad();
    document.getElementById('shell-btn-init-project').click();
    await flush();
    assert.strictEqual(toast().textContent, 'API 不可用');
  });
});

describe('项目面板：生成说明 / 催促继续', () => {
  it('生成项目说明：sendToChat 精确文案 + tag + delay', async () => {
    await openAndLoad();
    document.getElementById('shell-btn-gen-doc').click();
    await flush();
    await flush();
    assert.deepStrictEqual(api.calls.find((c) => c[0] === 'sendToChat'), [
      'sendToChat',
      '根据当前项目生成一个类似 claude.md 的项目说明文件，并将文件放到当前项目 .cuckoo/CUCKOO.md',
      '生成文档',
      300,
    ]);
  });

  it('生成说明发送失败时提示未找到输入框', async () => {
    api.sendToChat = async () => ({ success: false, error: 'view 不存在' });
    await openAndLoad();
    document.getElementById('shell-btn-gen-doc').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '发送失败：未找到输入框');
  });

  it('催促继续：sendToChat 精确文案，成功 toast「已发送：继续」', async () => {
    await openAndLoad();
    document.getElementById('shell-btn-nudge').click();
    await flush();
    await flush();
    assert.deepStrictEqual(api.calls.find((c) => c[0] === 'sendToChat'), [
      'sendToChat',
      '刚才卡住了请继续 爱你哦',
      '继续',
      300,
    ]);
    assert.strictEqual(toast().textContent, '已发送：继续');
  });

  it('催促继续失败时提示未找到输入框', async () => {
    api.sendToChat = async () => ({ success: false, error: 'view 不存在' });
    await openAndLoad();
    document.getElementById('shell-btn-nudge').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '发送失败：未找到输入框');
  });
});

describe('项目面板：token 五项明细', () => {
  it('初始全部为 0', () => {
    assert.strictEqual(usageText('shell-usage-context'), '0');
    assert.strictEqual(usageText('shell-usage-cumulative'), '0');
    assert.strictEqual(usageText('shell-usage-window'), '0');
    assert.strictEqual(usageText('shell-usage-today'), '0');
    assert.strictEqual(usageText('shell-usage-system'), '0');
  });

  it('onTokenUpdated 填前四项（过万格式化）', () => {
    api.handlers.token({ context: 56100, cumulative: 123456, windowCumulative: 234567, todayCumulative: 345678 });
    assert.strictEqual(usageText('shell-usage-context'), '5.61万');
    assert.strictEqual(usageText('shell-usage-cumulative'), '12.35万');
    assert.strictEqual(usageText('shell-usage-window'), '23.46万');
    assert.strictEqual(usageText('shell-usage-today'), '34.57万');
  });

  it('onTotalUpdated 填系统总累计', () => {
    api.handlers.total({ systemTotal: 123456789 });
    assert.strictEqual(usageText('shell-usage-system'), '1.23亿');
  });

  it('打开面板时主动拉取系统总累计', async () => {
    await openAndLoad();
    assert.strictEqual(api.calls.some((c) => c[0] === 'getSystemTotal'), true);
    assert.strictEqual(usageText('shell-usage-system'), '98.77万');
  });
});

describe('项目面板：压缩', () => {
  it('点击调用 compact relay，成功 toast 提示已开始', async () => {
    await openAndLoad();
    document.getElementById('shell-btn-compact').click();
    await flush();
    await flush();
    assert.strictEqual(api.calls.some((c) => c[0] === 'compact'), true);
    assert.strictEqual(toast().textContent, '已开始压缩流程（在聊天页面执行）');
  });

  it('compact 失败时 toast 显示 error', async () => {
    api.compact = async () => ({ success: false, error: 'view 不存在' });
    await openAndLoad();
    document.getElementById('shell-btn-compact').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '压缩失败: view 不存在');
  });

  it('compact 缺失时提示 API 不可用', async () => {
    delete api.compact;
    await openAndLoad();
    document.getElementById('shell-btn-compact').click();
    await flush();
    assert.strictEqual(toast().textContent, 'API 不可用');
  });
});

describe('项目面板：自动压缩设置', () => {
  it('打开面板时从 getSettings 填充开关与阈值', async () => {
    await openAndLoad();
    assert.strictEqual(document.getElementById('shell-auto-compact-enabled').checked, true);
    assert.strictEqual(document.getElementById('shell-auto-compact-threshold').value, '66');
  });

  it('保存：只提交两个 autoCompact 字段，toast 报开启文案', async () => {
    await openAndLoad();
    document.getElementById('shell-auto-compact-enabled').checked = true;
    document.getElementById('shell-auto-compact-threshold').value = '120';
    document.getElementById('shell-btn-auto-compact-save').click();
    await flush();
    await flush();
    assert.deepStrictEqual(api.calls.find((c) => c[0] === 'saveSettings'), [
      'saveSettings',
      { autoCompactEnabled: true, autoCompactThreshold: 120 },
    ]);
    assert.strictEqual(toast().textContent, '自动压缩设置已保存：开启，阈值 120 万');
  });

  it('保存关闭状态：toast 报关闭文案', async () => {
    await openAndLoad();
    document.getElementById('shell-auto-compact-enabled').checked = false;
    document.getElementById('shell-btn-auto-compact-save').click();
    await flush();
    await flush();
    assert.deepStrictEqual(api.calls.find((c) => c[0] === 'saveSettings')[1], {
      autoCompactEnabled: false,
      autoCompactThreshold: 66,
    });
    assert.strictEqual(toast().textContent, '自动压缩设置已保存：关闭');
  });

  it('阈值非正数时拒绝保存（不调用 saveSettings）', async () => {
    await openAndLoad();
    document.getElementById('shell-auto-compact-threshold').value = '-5';
    document.getElementById('shell-btn-auto-compact-save').click();
    await flush();
    assert.strictEqual(toast().textContent, '阈值需为正数（万）');
    assert.strictEqual(api.calls.some((c) => c[0] === 'saveSettings'), false);
  });

  it('saveSettings 失败时提示设置保存失败', async () => {
    api.saveSettings = async () => ({ success: false });
    await openAndLoad();
    document.getElementById('shell-btn-auto-compact-save').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '设置保存失败');
  });
});

describe('token 徽章联动', () => {
  it('点击徽章：展开项目面板并滚动到用量区', async () => {
    let scrolled = 0;
    const usage = document.getElementById('shell-usage-section');
    usage.scrollIntoView = () => { scrolled++; };

    document.getElementById('token-badge').click();
    await flush();

    assert.strictEqual(document.getElementById('side-panel').hidden, false);
    assert.strictEqual(document.getElementById('panel-title').textContent, '项目');
    assert.deepStrictEqual(api.calls.filter((c) => c[0] === 'setPanelOpen'), [['setPanelOpen', 'project']]);
    assert.strictEqual(scrolled, 1);
    const content = document.querySelector('.panel-content[data-panel-content="project"]');
    assert.strictEqual(content.hidden, false);
  });
});

describe('面板状态回放（壳重载）', () => {
  it('onPanelRestore 恢复面板展开，且不回传 setPanelOpen（quiet）', async () => {
    api.handlers.panelRestore({ panelId: 'project' });
    await flush();

    assert.strictEqual(document.getElementById('side-panel').hidden, false);
    assert.strictEqual(document.getElementById('panel-title').textContent, '项目');
    assert.strictEqual(
      document.querySelector('.rail-btn[data-panel="project"]').classList.contains('active'),
      true
    );
    assert.strictEqual(api.calls.some((c) => c[0] === 'setPanelOpen'), false);
  });

  it('onPanelRestore 空 panelId 收起面板', () => {
    openProjectPanel();
    api.handlers.panelRestore({ panelId: null });
    assert.strictEqual(document.getElementById('side-panel').hidden, true);
  });
});

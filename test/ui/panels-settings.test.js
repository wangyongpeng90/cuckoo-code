// @vitest-environment happy-dom
'use strict';
/**
 * src/ui/panels.js 设置面板测试（读取 / 校验 / 保存 / 恢复默认 / 刷新技能与代理）。
 * 标记 HTML 直接读自 src/ui/shell.html，与 panels-mcp.test.js 同一来源。
 * 校验规则与错误文案对照迁移自 src/overlay/panels/settings.ts（功能等价）。
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

/** 完整设置（存储毫秒；面板显示秒） */
const FULL_SETTINGS = {
  retryEnabled: true,
  retryDelayMin: 4000,
  retryDelayMax: 10000,
  retryCount: 10,
  retry429Delay: 60000,
  retry429Count: 20,
  retryPrompt: '刚才的回复似乎中断了，请重新完整回答上一个问题。',
  xhrIdleTimeout: 300000,
  watchdogPrompt: '请继续',
  watchdogCount: 3,
  sendDelayMin: 2000,
  sendDelayMax: 4000,
  attachDelayMin: 500,
  attachDelayMax: 1000,
  autoCompactEnabled: false,
  autoCompactThreshold: 80,
};

function makeApi(overrides) {
  const calls = [];
  const api = {
    calls,
    setPanelOpen: () => {},
    listSessions: async () => ({ success: true, sessions: [] }),
    listProfiles: async () => ({ success: true, profiles: [] }),
    listMcpServers: async () => ({ success: true, servers: [] }),
    getSettings: async () => ({ ...FULL_SETTINGS }),
    saveSettings: async (patch) => {
      calls.push(['saveSettings', patch]);
      return { success: true, settings: { ...FULL_SETTINGS, ...patch } };
    },
    resetSettings: async () => {
      calls.push(['resetSettings']);
      return { success: true, settings: { ...FULL_SETTINGS } };
    },
    refreshSkills: async () => {
      calls.push(['refreshSkills']);
      return { success: true, section: '技能与代理清单文本', skillCount: 2, agentCount: 1 };
    },
    sendToChat: async (msg, tag, delayMs) => {
      calls.push(['sendToChat', msg, tag, delayMs]);
      return { success: true };
    },
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

function openSettingsPanel() {
  document.querySelector('.rail-btn[data-panel="settings"]').click();
}

async function openAndLoad() {
  openSettingsPanel();
  await flush();
  await flush();
}

function toast() {
  return document.getElementById('panel-toast');
}

function setVal(id, value) {
  document.getElementById(id).value = value;
}

async function clickSave() {
  document.getElementById('shell-btn-settings-save').click();
  await flush();
  await flush();
}

describe('设置面板：打开与加载', () => {
  it('点击「设置」图标：getSettings 拉取后按毫秒→秒填充全部字段', async () => {
    let getCalls = 0;
    api.getSettings = async () => { getCalls++; return { ...FULL_SETTINGS }; };
    await openAndLoad();

    assert.strictEqual(getCalls, 1);
    const g = (id) => document.getElementById(id).value;
    assert.strictEqual(document.getElementById('shell-set-retry-enabled').checked, true);
    assert.strictEqual(g('shell-set-retry-delay-min'), '4');
    assert.strictEqual(g('shell-set-retry-delay-max'), '10');
    assert.strictEqual(g('shell-set-retry-count'), '10');
    assert.strictEqual(g('shell-set-retry-429-delay'), '60');
    assert.strictEqual(g('shell-set-retry-429-count'), '20');
    assert.strictEqual(g('shell-set-retry-prompt'), FULL_SETTINGS.retryPrompt);
    assert.strictEqual(g('shell-set-xhr-idle-timeout'), '300');
    assert.strictEqual(g('shell-set-watchdog-prompt'), '请继续');
    assert.strictEqual(g('shell-set-watchdog-count'), '3');
    assert.strictEqual(g('shell-set-delay-min'), '2');
    assert.strictEqual(g('shell-set-delay-max'), '4');
    assert.strictEqual(g('shell-set-attach-delay-min'), '0.5');
    assert.strictEqual(g('shell-set-attach-delay-max'), '1');
  });

  it('getSettings 缺失时提示 API 不可用', async () => {
    delete api.getSettings;
    await openAndLoad();
    assert.strictEqual(toast().hidden, false);
    assert.strictEqual(toast().textContent, 'API 不可用');
  });

  it('getSettings 抛错时提示设置加载失败', async () => {
    api.getSettings = async () => { throw new Error('boom'); };
    await openAndLoad();
    assert.strictEqual(toast().textContent, '设置加载失败');
  });
});

describe('设置面板：保存', () => {
  it('合法输入：秒→毫秒转换后调用 saveSettings（14 个字段全量补丁）', async () => {
    await openAndLoad();
    setVal('shell-set-retry-delay-min', '5');
    setVal('shell-set-retry-delay-max', '15');
    setVal('shell-set-retry-count', '8');
    setVal('shell-set-retry-429-delay', '90');
    setVal('shell-set-retry-429-count', '30');
    setVal('shell-set-retry-prompt', '  请重试  ');
    setVal('shell-set-xhr-idle-timeout', '240');
    setVal('shell-set-watchdog-prompt', ' 继续 ');
    setVal('shell-set-watchdog-count', '5');
    setVal('shell-set-delay-min', '1.5');
    setVal('shell-set-delay-max', '3.5');
    setVal('shell-set-attach-delay-min', '0.8');
    setVal('shell-set-attach-delay-max', '2');
    document.getElementById('shell-set-retry-enabled').checked = false;

    await clickSave();

    assert.strictEqual(api.calls.length, 1);
    assert.strictEqual(api.calls[0][0], 'saveSettings');
    assert.deepStrictEqual(api.calls[0][1], {
      retryEnabled: false,
      retryDelayMin: 5000,
      retryDelayMax: 15000,
      retryCount: 8,
      retry429Delay: 90000,
      retry429Count: 30,
      retryPrompt: '请重试',
      xhrIdleTimeout: 240000,
      watchdogPrompt: '继续',
      watchdogCount: 5,
      sendDelayMin: 1500,
      sendDelayMax: 3500,
      attachDelayMin: 800,
      attachDelayMax: 2000,
    });
    assert.strictEqual(toast().textContent, '设置已保存');
  });

  it('saveSettings 失败（无 settings 返回）提示设置保存失败', async () => {
    api.saveSettings = async () => ({ success: false });
    await openAndLoad();
    await clickSave();
    assert.strictEqual(toast().textContent, '设置保存失败');
  });
});

describe('设置面板：保存校验（不调用 saveSettings）', () => {
  async function expectReject(mutate, expectText) {
    await openAndLoad();
    mutate();
    await clickSave();
    assert.strictEqual(toast().hidden, false);
    assert.strictEqual(toast().textContent, expectText);
    assert.strictEqual(api.calls.length, 0);
  }

  it('普通失败最小间隔非数字', () =>
    expectReject(() => setVal('shell-set-retry-delay-min', 'abc'),
      '普通失败最小间隔必须是非负数字（秒）'));

  it('普通失败最小间隔为负数', () =>
    expectReject(() => setVal('shell-set-retry-delay-min', '-1'),
      '普通失败最小间隔必须是非负数字（秒）'));

  it('普通失败最大间隔小于最小间隔', () =>
    expectReject(() => {
      setVal('shell-set-retry-delay-min', '10');
      setVal('shell-set-retry-delay-max', '5');
    }, '普通失败最大间隔不能小于最小间隔'));

  it('普通失败重试次数非整数', () =>
    expectReject(() => setVal('shell-set-retry-count', 'x'),
      '普通失败重试次数必须是整数'));

  it('操作频繁重试间隔为负数', () =>
    expectReject(() => setVal('shell-set-retry-429-delay', '-2'),
      '操作频繁重试间隔必须是非负数字（秒）'));

  it('操作频繁重试次数非整数', () =>
    expectReject(() => setVal('shell-set-retry-429-count', 'x'),
      '操作频繁重试次数必须是整数'));

  it('重试提示词为空', () =>
    expectReject(() => setVal('shell-set-retry-prompt', '   '),
      '重试提示词不能为空'));

  it('挂起超时为负数', () =>
    expectReject(() => setVal('shell-set-xhr-idle-timeout', '-1'),
      '挂起超时必须是非负数字（秒）'));

  it('工具循环超时提示词为空', () =>
    expectReject(() => setVal('shell-set-watchdog-prompt', '  '),
      '工具循环超时提示词不能为空'));

  it('工具循环催继续次数非整数', () =>
    expectReject(() => setVal('shell-set-watchdog-count', 'x'),
      '工具循环催继续次数必须是整数'));

  it('发送延迟最大值超过 10 秒', () =>
    expectReject(() => setVal('shell-set-delay-max', '11'),
      '发送延迟最大值不能超过 10 秒'));

  it('发送延迟最大值小于最小值', () =>
    expectReject(() => {
      setVal('shell-set-delay-min', '3');
      setVal('shell-set-delay-max', '1');
    }, '发送延迟最大值不能小于最小值'));

  it('附件上传间隔最大值小于最小值', () =>
    expectReject(() => {
      setVal('shell-set-attach-delay-min', '2');
      setVal('shell-set-attach-delay-max', '1');
    }, '附件上传间隔最大值不能小于最小值'));

  it('附件上传间隔最大值超过 60 秒', () =>
    expectReject(() => setVal('shell-set-attach-delay-max', '61'),
      '附件上传间隔最大值不能超过 60 秒'));
});

describe('设置面板：恢复默认', () => {
  it('调用 resetSettings，用返回的完整设置重填表单', async () => {
    api.resetSettings = async () => ({
      success: true,
      settings: { ...FULL_SETTINGS, retryDelayMin: 1234, retryPrompt: '默认提示词' },
    });
    await openAndLoad();
    setVal('shell-set-retry-delay-min', '99');
    setVal('shell-set-retry-prompt', '改过了');

    document.getElementById('shell-btn-settings-reset').click();
    await flush();
    await flush();

    assert.strictEqual(api.calls.length, 0); // 不经过 saveSettings
    assert.strictEqual(document.getElementById('shell-set-retry-delay-min').value, '1.234');
    assert.strictEqual(document.getElementById('shell-set-retry-prompt').value, '默认提示词');
    assert.strictEqual(toast().textContent, '已恢复默认设置');
  });

  it('resetSettings 失败提示恢复默认失败，表单不变', async () => {
    api.resetSettings = async () => ({ success: false });
    await openAndLoad();
    setVal('shell-set-retry-delay-min', '99');

    document.getElementById('shell-btn-settings-reset').click();
    await flush();
    await flush();

    assert.strictEqual(toast().textContent, '恢复默认失败');
    assert.strictEqual(document.getElementById('shell-set-retry-delay-min').value, '99');
  });
});

describe('设置面板：刷新技能与代理', () => {
  it('refreshSkills → sendToChat（清单文本、tag、delay），toast 报告数量', async () => {
    await openAndLoad();
    document.getElementById('shell-btn-skills-send').click();
    await flush();
    await flush();

    assert.deepStrictEqual(api.calls[0], ['refreshSkills']);
    assert.deepStrictEqual(api.calls[1], ['sendToChat', '技能与代理清单文本', '技能与代理清单', 300]);
    assert.strictEqual(toast().textContent, '已发送（技能 2 个 / 代理 1 个）');
  });

  it('refreshSkills 缺失时提示接口不可用', async () => {
    delete api.refreshSkills;
    await openAndLoad();
    document.getElementById('shell-btn-skills-send').click();
    await flush();
    assert.strictEqual(toast().textContent, '接口不可用');
  });

  it('清单为空时不发送，提示没有找到任何技能或代理', async () => {
    api.refreshSkills = async () => ({ success: true, section: '  ', skillCount: 0, agentCount: 0 });
    await openAndLoad();
    document.getElementById('shell-btn-skills-send').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '没有找到任何技能或代理');
    assert.strictEqual(api.calls.some((c) => c[0] === 'sendToChat'), false);
  });

  it('refreshSkills 失败提示获取清单失败', async () => {
    api.refreshSkills = async () => ({ success: false, error: '扫描出错' });
    await openAndLoad();
    document.getElementById('shell-btn-skills-send').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent, '获取清单失败: 扫描出错');
  });

  it('sendToChat 失败提示发送失败', async () => {
    api.sendToChat = async () => ({ success: false, error: 'view 不存在' });
    await openAndLoad();
    document.getElementById('shell-btn-skills-send').click();
    await flush();
    await flush();
    assert.strictEqual(toast().textContent.includes('发送失败'), true);
  });
});

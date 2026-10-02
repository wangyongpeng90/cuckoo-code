'use strict';
import { test, describe, afterEach } from 'vitest';
import assert from 'node:assert';
import { GoalDoneTool } from '../../src/tools/impl/goal-done.js';
import { registry } from '../../src/tools/index.js';
import { addWindow, getWindowContext, removeWindow } from '../../src/app/window.js';

const testWindowIds = [];

/**
 * 注册一个伪窗口上下文（真实走 window.ts 注册表），harness 视图记录事件推送。
 * isDestroyed 一律 false，模拟存活窗口/视图。
 */
function registerFakeWindow(windowId, harnessView) {
  const events = [];
  const win = {
    id: windowId,
    isDestroyed: () => false,
    on: () => {},
  };
  const view = null;
  addWindow(win, null, null, null, view);
  getWindowContext(windowId).harnessView = harnessView;
  testWindowIds.push(windowId);
  return events;
}

afterEach(() => {
  for (const id of testWindowIds.splice(0)) removeWindow(id);
});

function harnessViewOf(events) {
  return {
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => events.push({ channel, payload }),
    },
  };
}

describe('GoalDoneTool', () => {
  test('已注册到全局工具表，名为 goalDone', () => {
    assert.ok(registry.listNames().includes('goalDone'));
    assert.ok(registry.get('goalDone') instanceof GoalDoneTool);
  });

  test('无参数 schema：无必填项、拒绝额外属性', () => {
    const desc = registry.get('goalDone').getDescription();
    assert.strictEqual(desc.parameters.type, 'object');
    assert.deepStrictEqual(desc.parameters.properties, {});
    assert.strictEqual(desc.parameters.additionalProperties, false);
    assert.deepStrictEqual(desc.parameters.required ?? [], []);
  });

  test('推送 goal-done 事件到窗口的 harness 视图', async () => {
    const events = [];
    registerFakeWindow(7001, harnessViewOf(events));
    const result = await new GoalDoneTool().execute({ currentWindowId: 7001 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].channel, 'harness-event');
    assert.deepStrictEqual(events[0].payload, { type: 'goal-done' });
  });

  test('缺少窗口上下文时返回错误且不推送', async () => {
    const result = await new GoalDoneTool().execute({});
    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /缺少窗口上下文/);
  });

  test('窗口不存在时返回错误且不推送', async () => {
    const result = await new GoalDoneTool().execute({ currentWindowId: 7002 });
    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /不存在或已关闭/);
  });

  test('纯净模式未开启（无 harness 视图）时返回错误且不推送', async () => {
    const events = [];
    registerFakeWindow(7003, null);
    const result = await new GoalDoneTool().execute({ currentWindowId: 7003 });
    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /纯净对话模式未开启/);
    assert.strictEqual(events.length, 0);
  });

  test('系统提示词 section 说明结束语义', () => {
    const section = new GoalDoneTool().getPromptSection();
    assert.ok(section && section.text.includes('goalDone()'));
    assert.ok(section.text.includes('完成'));
  });
});

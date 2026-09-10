'use strict';
/**
 * SubagentRunner 单元测试（Task 4/5）
 * 重点：task 校验、agentType 校验、markReady 时序、_failTask 幂等、abortByParentWindow。
 * windowFactory 注入 mock，不开真窗口。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { installElectronMock } = require('../helpers/mock-electron');
installElectronMock();

const { SubagentRunner } = require('../../src/main/subagent-runner');

function createMockWindowFactory() {
  const calls = [];
  const fn = (profile, options) => {
    calls.push({ profile, options });
    const win = {
      id: 'mock-win-' + calls.length,
      isDestroyed: () => false,
      webContents: {
        setUserAgent: () => {},
        loadURL: () => {},
        once: () => {},
        executeJavaScript: async () => ({ loggedIn: true }),
        session: { storagePath: 'mock-storage-path' },
        getURL: () => 'https://chat.deepseek.com/',
      },
      on: () => {},
      close: () => {},
    };
    return win;
  };
  return { fn, calls };
}

test('task 非空校验', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const r1 = await runner.run({});
  assert.strictEqual(r1.success, false);
  assert.match(r1.error, /task must be a non-empty string/);

  const r2 = await runner.run({ task: '   ' });
  assert.strictEqual(r2.success, false);
  assert.match(r2.error, /task must be a non-empty string/);
});

test('未知 agentType 返回错误且不创建窗口', async () => {
  const { fn, calls } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const r = await runner.run({ task: 'test', agentType: 'nonexistent' });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /未知的 agentType/);
  assert.strictEqual(calls.length, 0);
});

test('markReady 仅对 starting 阶段生效', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  // 不存在的 taskId
  assert.strictEqual(runner.markReady('nonexistent'), false);
});

test('_failTask 幂等：重复调用不抛错', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  // 直接构造一个 state 塞进 activeTasks
  const state = {
    taskId: 'test-id',
    phase: 'starting',
    win: { isDestroyed: () => false, close: () => {} },
    timer: setTimeout(() => {}, 1000),
    startingTimer: setTimeout(() => {}, 1000),
    idleTimer: null,
    reject: null,
  };
  runner.activeTasks.set('test-id', state);

  runner._failTask('test-id', 'test reason');
  // 第二次调用应该直接 return（phase 已 failed）
  runner._failTask('test-id', 'test reason 2');
  assert.strictEqual(state.phase, 'failed');
  assert.strictEqual(state.abortReason, 'test reason');
  assert.strictEqual(runner.activeTasks.has('test-id'), false);
});

test('abortByParentWindow 仅 abort 归属子任务', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  // 构造两个 task，不同 parentWindowId
  const s1 = { taskId: 't1', parentWindowId: 100, phase: 'working', win: { isDestroyed: () => false, close: () => {} }, timer: null, startingTimer: null, idleTimer: null, reject: null };
  const s2 = { taskId: 't2', parentWindowId: 200, phase: 'working', win: { isDestroyed: () => false, close: () => {} }, timer: null, startingTimer: null, idleTimer: null, reject: null };
  runner.activeTasks.set('t1', s1);
  runner.activeTasks.set('t2', s2);

  const count = runner.abortByParentWindow(100);
  assert.strictEqual(count, 1);
  assert.strictEqual(s1.phase, 'failed');
  assert.strictEqual(s2.phase, 'working');
  assert.strictEqual(runner.activeTasks.has('t1'), false);
  assert.strictEqual(runner.activeTasks.has('t2'), true);
});

test('windowFactory 被调用时传入 isSubagent 与 subagentId', async () => {
  const { fn, calls } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  // 手动 mock windowState.getMainContext 返回主窗口 context
  const windowState = require('../../src/main/window');
  const originalGetMainContext = windowState.getMainContext;
  windowState.getMainContext = () => ({
    win: { id: 999 },
    profileId: 'profile-test',
  });

  try {
    // 只测 run 的 windowFactory 调用（异步会卡在 readyPromise，但 windowFactory 在 run 内同步调用）
    runner._openWindow({
      taskId: 'task-abc',
      agentType: null,
      projectDir: '/tmp/proj',
      currentPartition: 'persist:main',
      sessionStore: { state: {} },
      win: null,
    }, 'persist:main').catch(() => {});

    // 等微任务
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.isSubagent, true);
    assert.strictEqual(calls[0].options.subagentId, 'task-abc');
  } finally {
    windowState.getMainContext = originalGetMainContext;
  }
});

test('markReady 对 starting 阶段 resolve readyPromise', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const state = {
    taskId: 'ready-test',
    phase: 'starting',
    readyResolve: null,
    readyPromise: null,
  };
  state.readyPromise = new Promise((resolve) => { state.readyResolve = resolve; });
  runner.activeTasks.set('ready-test', state);

  // markReady 前 readyPromise 未 resolve
  let resolved = false;
  state.readyPromise.then(() => { resolved = true; });

  const ok = runner.markReady('ready-test');
  assert.strictEqual(ok, true);

  await state.readyPromise;
  assert.strictEqual(resolved, true);
});

test('markReady 对非 starting 阶段返回 false', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const state = {
    taskId: 'working-test',
    phase: 'working',
    readyResolve: null,
    readyPromise: Promise.resolve(),
  };
  runner.activeTasks.set('working-test', state);

  assert.strictEqual(runner.markReady('working-test'), false);
});

test('markReady sender 不匹配返回 false（O-1 纵深防御）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const state = {
    taskId: 'sender-test',
    phase: 'starting',
    win: {
      webContents: { id: 'real-wc' },
    },
    readyResolve: null,
    readyPromise: new Promise(() => {}),
  };
  runner.activeTasks.set('sender-test', state);

  // 伪造的 sender 与 state.win.webContents 不一致 → 拒绝
  const fakeSender = { id: 'fake-wc' };
  assert.strictEqual(runner.markReady('sender-test', fakeSender), false);

  // sender 一致 → 接受（state.win 存在，senderWebContents 匹配）
  const realSender = state.win.webContents;
  assert.strictEqual(runner.markReady('sender-test', realSender), true);
});

test('_resetReadyPromise 重置后旧 resolve 失效', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const state = {
    taskId: 'reset-test',
    phase: 'starting',
    readyResolve: null,
    readyPromise: null,
  };
  state.readyPromise = new Promise((resolve) => { state.readyResolve = resolve; });

  // 记下旧 resolve，重置
  const oldResolve = state.readyResolve;
  runner._resetReadyPromise(state);

  // 旧 resolve 不应该影响新 promise
  let newResolved = false;
  state.readyPromise.then(() => { newResolved = true; });

  oldResolve(); // 旧 resolve 触发，新 promise 应不受影响
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(newResolved, false);

  // 新 resolve 应该生效
  state.readyResolve();
  await state.readyPromise;
  assert.strictEqual(newResolved, true);
});

test('_handleLoggedIn 写入 pendingProjectDir 并进入 working', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const sessionStore = { state: {} };
  const state = {
    taskId: 'loggedin-test',
    phase: 'starting',
    projectDir: '/proj/dir',
    task: 'test task',
    agentTemplate: null,
    sessionStore,
    currentPartition: 'persist:main',
    startingTimer: setTimeout(() => {}, 5000),
    readyResolve: null,
    readyPromise: null,
  };
  state.readyPromise = new Promise((resolve) => { state.readyResolve = resolve; });

  const mockWin = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => ({ expertMode: true }), // _ensureExpertMode 用
      send: () => {}, // Task 6 首条消息发送
    },
  };

  const promise = runner._handleLoggedIn(state, mockWin);
  // 等 _ensureExpertMode 完成
  await new Promise((r) => setTimeout(r, 30));
  // markReady 触发 readyPromise resolve
  runner.activeTasks.set('loggedin-test', state);
  runner.markReady('loggedin-test');

  await promise;

  assert.strictEqual(sessionStore.state.pendingProjectDir, '/proj/dir');
  assert.strictEqual(state.phase, 'working');
  // 清理 _handleLoggedIn 创建的 180s idleTimer，避免事件循环等待
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
});

test('_ensureExpertMode 分支1：已在专家模式直接返回 true', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const win = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => ({ expertMode: true }),
    },
  };

  const ok = await runner._ensureExpertMode(win);
  assert.strictEqual(ok, true);
});

test('_ensureExpertMode 分支2：点击按钮后 1.5s 复验成功返回 true', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  let callCount = 0;
  const win = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => {
        callCount++;
        // 第一次：点击按钮；第二次（1.5s 后复验）：已开启
        return callCount === 1 ? { clickedButton: true } : { expertMode: true };
      },
    },
  };

  const start = Date.now();
  const ok = await runner._ensureExpertMode(win);
  const elapsed = Date.now() - start;

  assert.strictEqual(ok, true);
  assert.strictEqual(callCount, 2);
  assert.ok(elapsed >= 1400, '应等待至少 1.5s（实测 ' + elapsed + 'ms）');
});

test('_ensureExpertMode 分支3：找不到按钮非致命返回 false', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const win = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => ({ foundButton: false }),
    },
  };

  const ok = await runner._ensureExpertMode(win);
  assert.strictEqual(ok, false);
});

test('_ensureExpertMode 窗口已销毁返回 false', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const ok = await runner._ensureExpertMode({ isDestroyed: () => true });
  assert.strictEqual(ok, false);
});

test('_buildWrapperTemplate 有 agentTemplate 时含角色段与模板全文', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = {
    task: '审查 utils/a.js',
    agentTemplate: { fullText: '# 代码审查员\n\n审查代码质量' },
  };
  const out = runner._buildWrapperTemplate(state);
  assert.ok(out.includes('【你的角色】'));
  assert.ok(out.includes('代码审查员'));
  assert.ok(out.includes('审查代码质量'));
  assert.ok(out.includes('【回复模式】'));
  assert.ok(out.includes('模式 A - 工具调用'));
  assert.ok(out.includes('模式 B - 最终交付'));
  assert.ok(out.includes('模式 C - 错误交付'));
  assert.ok(out.includes('【禁止】'));
  assert.ok(out.includes('【行为规则】'));
  assert.ok(out.includes('审查 utils/a.js'));
});

test('_buildWrapperTemplate 无 agentTemplate 时无角色段', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = { task: '任务X', agentTemplate: null };
  const out = runner._buildWrapperTemplate(state);
  assert.ok(!out.includes('【你的角色】'));
  assert.ok(out.includes('任务X'));
});

test('_buildWrapperTemplate 任务位于末尾', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = { task: '最终任务', agentTemplate: null };
  const out = runner._buildWrapperTemplate(state);
  assert.ok(out.endsWith('最终任务'));
});

test('_buildFirstMessage 复用主窗口提示词并附加任务', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = { task: '任务Y', agentTemplate: null, projectDir: '/proj' };
  const out = runner._buildFirstMessage(state);
  // 主窗口模板的标识
  assert.ok(out.includes('身份与能力'));
  assert.ok(out.includes('工具 API 类型定义'));
  assert.ok(out.includes('反引号'));
  assert.ok(out.includes('JSON'));
  // 无占位符残留（全部替换）
  assert.ok(!out.includes('{{'), '不应有未替换占位符');
  // ts 围栏（类型定义注入）
  assert.ok(out.includes('ts'));
  // 子 Agent 模式覆盖声明（I-1 防回归）
  assert.ok(out.includes('子 Agent 模式'));
  assert.ok(out.includes('你没有用户可问'));
  // 禁 XML 回退（I-2 防回归）
  assert.ok(out.includes('禁止输出 XML 格式的工具调用'));
  // R-1 嵌套封堵四重断言：无清单行 / 无 declare / 无教学段 / 有禁令
  assert.ok(!out.includes('subagent(options)'), '不应有 subagent 清单行');
  assert.ok(!out.includes('declare function subagent'), '不应有 subagent 类型声明');
  assert.ok(!out.includes('使用 subagent 工具委派'), '不应有 subagent 教学段');
  assert.ok(out.includes('禁止调用 subagent'), '应有禁止调用 subagent 的禁令');
  // 附加的子 Agent 任务段
  assert.ok(out.includes('你的任务'));
  assert.ok(out.includes('任务Y'));
});

test('handleCandidateResult 按 sender 反查并落盘 resolve', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const fs = require('fs');
  const path = require('path');
  const tmpDir = path.join(process.cwd(), 'test', 'tmp', 'subagent-results-test');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const webContents = { id: 'wc-1' };
  let resolvedData = null;
  let closed = false;
  const state = {
    taskId: 'result-test-1',
    phase: 'working',
    projectDir: tmpDir,
    startedAt: Date.now() - 10000,
    supplementCount: 0,
    win: {
      webContents,
      isDestroyed: () => false,
      close: () => { closed = true; },
    },
    timer: setTimeout(() => {}, 5000),
    startingTimer: null,
    idleTimer: null,
    resolve: (v) => { resolvedData = v; },
    reject: null,
  };
  runner.activeTasks.set('result-test-1', state);

  const r = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '修改了 a.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题。' });

  assert.strictEqual(r.success, true);
  assert.strictEqual(r.accepted, true);
  assert.ok(r.resultFile, '应返回 resultFile');
  assert.ok(fs.existsSync(r.resultFile), '文件应已落盘');
  assert.strictEqual(fs.readFileSync(r.resultFile, 'utf-8'), '修改了 a.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题。');
  assert.strictEqual(r.preview, '修改了 a.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题。');
  assert.strictEqual(state.phase, 'completed');
  assert.ok(resolvedData, '应 resolve');
  assert.strictEqual(resolvedData.success, true);
  assert.ok(resolvedData.data.resultFile);
  assert.strictEqual(closed, true, 'completed 应关窗');
  assert.strictEqual(runner.activeTasks.has('result-test-1'), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('handleCandidateResult sender 不匹配拒绝', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const webContents = { id: 'real-wc' };
  const state = {
    taskId: 'result-test-2',
    phase: 'working',
    win: { webContents },
    resolve: null,
    reject: null,
  };
  runner.activeTasks.set('result-test-2', state);

  const fakeSender = { id: 'fake-wc' };
  const r = runner.handleCandidateResult(fakeSender, { type: 'subagent_result', text: 'x' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.accepted, false);
});

test('handleCandidateResult plain_text 不落盘不 resolve（Task 10：无工具活动转停住提醒）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const sent = [];
  const webContents = { id: 'wc-plain' };
  webContents.send = (ch, payload) => sent.push({ ch, payload });
  let resolved = false;
  const state = {
    taskId: 'result-test-3',
    phase: 'working',
    projectDir: null,
    startedAt: Date.now(),
    hasToolActivity: false,
    idleReminderCount: 0,
    win: { webContents, isDestroyed: () => false, close: () => {} },
    resolve: () => { resolved = true; },
    reject: null,
  };
  runner.activeTasks.set('result-test-3', state);

  const r = runner.handleCandidateResult(webContents, { type: 'plain_text', text: '请继续' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.accepted, true);
  assert.strictEqual(r.handled, false, 'plain_text 不作为结果处理');
  assert.strictEqual(sent.length, 1, '无工具活动应发停住提醒（场景 A）');
  assert.strictEqual(resolved, false, 'plain_text 不触发任务完成');
  assert.strictEqual(runner.activeTasks.has('result-test-3'), true, '任务保持 active');
});

test('_handleLoggedIn working 后发首条消息恰好一次', async () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  let sendCount = 0;
  let lastPayload = null;
  const mockWin = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => ({ expertMode: true }),
      send: (channel, payload) => { sendCount++; lastPayload = payload; },
    },
  };

  const state = {
    taskId: 'send-test',
    phase: 'starting',
    projectDir: '/proj',
    task: '请执行任务',
    agentTemplate: null,
    sessionStore: { state: {} },
    currentPartition: 'persist:main',
    startingTimer: setTimeout(() => {}, 5000),
    readyResolve: null,
    readyPromise: null,
  };
  state.readyPromise = new Promise((resolve) => { state.readyResolve = resolve; });

  const promise = runner._handleLoggedIn(state, mockWin);
  await new Promise((r) => setTimeout(r, 30));
  runner.activeTasks.set('send-test', state);
  runner.markReady('send-test');
  await promise;

  assert.strictEqual(sendCount, 1);
  assert.strictEqual(lastPayload.taskId, 'send-test');
  assert.match(lastPayload.task, /请执行任务/);
  // 清理 _handleLoggedIn 创建的 180s idleTimer，避免事件循环等待
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
});

test('handleCandidateResult 空 text 拒绝', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const webContents = { id: 'wc-empty' };
  const state = { taskId: 'r-empty', phase: 'working', win: { webContents } };
  runner.activeTasks.set('r-empty', state);

  const r = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '   ' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.accepted, false);
  assert.match(r.error, /内容为空/);
});

test('handleCandidateResult 未知 type 拒绝', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const webContents = { id: 'wc-unknown' };
  const state = { taskId: 'r-unknown', phase: 'working', win: { webContents } };
  runner.activeTasks.set('r-unknown', state);

  const r = runner.handleCandidateResult(webContents, { type: 'weird_type', text: 'x' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.accepted, false);
  assert.match(r.error, /未知 result type/);
});

test('_cleanupOldResults 清理超过 7 天的文件', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const fsMod = require('fs');
  const pathMod = require('path');
  const tmpBase = pathMod.join(process.cwd(), 'test', 'tmp', 'subagent-cleanup');
  fsMod.rmSync(tmpBase, { recursive: true, force: true });
  const resultsDir = pathMod.join(tmpBase, '.cuckoo', 'subagent-results');
  fsMod.mkdirSync(resultsDir, { recursive: true });

  // 旧文件（> 7 天）
  const oldFile = pathMod.join(resultsDir, 'old.md');
  fsMod.writeFileSync(oldFile, 'old', 'utf-8');
  const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fsMod.utimesSync(oldFile, oldTime, oldTime);

  // 6 天文件（< 7 天，应保留）
  const sixDayFile = pathMod.join(resultsDir, 'six-day.md');
  fsMod.writeFileSync(sixDayFile, 'six', 'utf-8');
  const sixDayTime = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  fsMod.utimesSync(sixDayFile, sixDayTime, sixDayTime);

  // 新文件（< 7 天）
  const newFile = pathMod.join(resultsDir, 'new.md');
  fsMod.writeFileSync(newFile, 'new', 'utf-8');

  runner._cleanupOldResults(tmpBase);

  assert.strictEqual(fsMod.existsSync(oldFile), false, '超过 7 天的文件应被清理');
  assert.strictEqual(fsMod.existsSync(sixDayFile), true, '6 天文件应保留（1-7 天边界）');
  assert.strictEqual(fsMod.existsSync(newFile), true, '7 天内的文件应保留');

  fsMod.rmSync(tmpBase, { recursive: true, force: true });
});

test('敷衍一次后补交合格结果正常落盘', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const fsMod = require('fs');
  const pathMod = require('path');
  const tmpDir = pathMod.join(process.cwd(), 'test', 'tmp', 'recover-after-supplement');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
  fsMod.mkdirSync(tmpDir, { recursive: true });

  const webContents = { id: 'wc-recover', send: () => {} };
  let resolved = null;
  const state = {
    taskId: 'r-recover',
    phase: 'working',
    projectDir: tmpDir,
    startedAt: Date.now() - 10000,
    supplementCount: 0,
    win: {
      webContents,
      isDestroyed: () => false,
      close: () => {},
    },
    resolve: (v) => { resolved = v; },
    reject: null,
  };
  runner.activeTasks.set('r-recover', state);

  // 第一次：敷衍结果 → 触发追问，不落盘
  const r1 = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '我完成了' });
  assert.strictEqual(r1.handled, false);
  assert.strictEqual(r1.supplement, true);
  assert.strictEqual(state.supplementCount, 1);
  assert.strictEqual(runner.activeTasks.has('r-recover'), true);

  // 第二次：合格结果 → 正常落盘 resolve
  const r2 = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '修改了 a.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题。' });
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r2.accepted, true);
  assert.strictEqual(r2.supplement, undefined);
  assert.ok(resolved, '应 resolve');
  assert.strictEqual(runner.activeTasks.has('r-recover'), false);

  fsMod.rmSync(tmpDir, { recursive: true, force: true });
});

test('_cleanupOldResults 目录不存在静默返回', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const pathMod = require('path');
  const tmpBase = pathMod.join(process.cwd(), 'test', 'tmp', 'subagent-cleanup-nonexistent');
  const fsMod = require('fs');
  fsMod.rmSync(tmpBase, { recursive: true, force: true });
  // 目录不存在，不应抛异常
  runner._cleanupOldResults(tmpBase);
  assert.ok(true, '不应抛异常');
});

test('isTrivialResult 长度 < 30 判敷衍', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  assert.strictEqual(runner.isTrivialResult('我完成了'), true);
  // 30+ 字符且多句（多个句号分隔），不应判敷衍
  assert.strictEqual(runner.isTrivialResult('修改了 src/main/index.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题。'), false);
});

test('isTrivialResult 敷衍话术开头且 < 100 判敷衍', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  assert.strictEqual(runner.isTrivialResult('任务已完成，没有其他内容'), true);
  assert.strictEqual(runner.isTrivialResult('已完成。' + '很长的内容'.repeat(30)), false);
});

test('isTrivialResult 单句且 < 100 判敷衍', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  // 单句（无句号分隔）且长度 < 100，应判敷衍
  assert.strictEqual(runner.isTrivialResult('这是一句没有句号分隔的长句子但是仍然只有一句并且长度小于一百'), true);
  // 多句（含句号分隔），即使总长 < 100，也不应判敷衍（但 < 30 仍判敷衍）
  assert.strictEqual(runner.isTrivialResult('第一句话完成了文件修改。第二句话列出了问题清单。第三句话给出了验证结论。'), false);
});

test('isTrivialResult 空输入判敷衍', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  assert.strictEqual(runner.isTrivialResult(''), true);
  assert.strictEqual(runner.isTrivialResult(null), true);
});

test('handleCandidateResult 敷衍结果触发追问不落盘', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  let reminderSent = false;
  const webContents = {
    id: 'wc-trivial',
    send: (ch, payload) => { if (ch === 'subagent-reminder') reminderSent = true; },
  };
  const state = {
    taskId: 'r-trivial',
    phase: 'working',
    projectDir: require('path').join(process.cwd(), 'test', 'tmp', 'trivial-no-write'),
    supplementCount: 0,
    win: {
      webContents,
      isDestroyed: () => false,
      close: () => {},
    },
    resolve: () => {},
    reject: null,
  };
  runner.activeTasks.set('r-trivial', state);

  const r = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '我完成了' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.accepted, true);
  assert.strictEqual(r.handled, false);
  assert.strictEqual(r.supplement, true);
  assert.strictEqual(reminderSent, true, '应发送追问');
  assert.strictEqual(state.supplementCount, 1, '追问计数 +1');
  assert.strictEqual(runner.activeTasks.has('r-trivial'), true, '任务应保持 active 等待补充');
});

test('_checkResultAuthenticity 无路径返回 null', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = { projectDir: '/tmp', startedAt: Date.now() };
  assert.strictEqual(runner._checkResultAuthenticity(state, '没有文件路径的交付内容'), null);
});

test('_checkResultAuthenticity 声称文件不存在返回 warning', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const pathMod = require('path');
  const fsMod = require('fs');
  const tmpDir = pathMod.join(process.cwd(), 'test', 'tmp', 'auth-test');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
  fsMod.mkdirSync(tmpDir, { recursive: true });

  const state = { projectDir: tmpDir, startedAt: Date.now() };
  const r = runner._checkResultAuthenticity(state, '修改了 src/nonexistent-file.js');
  assert.ok(r, '应返回 warning');
  assert.match(r, /声称的文件未找到/);
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
});

test('_checkResultAuthenticity 文件存在且 mtime 在任务后返回 null', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const pathMod = require('path');
  const fsMod = require('fs');
  const tmpDir = pathMod.join(process.cwd(), 'test', 'tmp', 'auth-test2');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
  fsMod.mkdirSync(tmpDir, { recursive: true });
  const file = pathMod.join(tmpDir, 'modified.txt');
  fsMod.writeFileSync(file, 'x', 'utf-8');
  const future = new Date(Date.now() + 5000);
  fsMod.utimesSync(file, future, future);

  const state = { projectDir: tmpDir, startedAt: Date.now() - 1000 };
  const r = runner._checkResultAuthenticity(state, '修改了 modified.txt');
  assert.strictEqual(r, null, '文件存在且 mtime 在任务开始后，不应有 warning');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
});

test('_checkResultAuthenticity mtime 早于任务开始返回 warning', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const pathMod = require('path');
  const fsMod = require('fs');
  const tmpDir = pathMod.join(process.cwd(), 'test', 'tmp', 'auth-test3');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
  fsMod.mkdirSync(tmpDir, { recursive: true });
  const file = pathMod.join(tmpDir, 'sub', 'old-file.txt');
  fsMod.mkdirSync(pathMod.join(tmpDir, 'sub'), { recursive: true });
  fsMod.writeFileSync(file, 'old', 'utf-8');
  const past = new Date(Date.now() - 3600000); // 1 小时前
  fsMod.utimesSync(file, past, past);

  // startedAt 设为 10 分钟前，文件 mtime 1 小时前 → 早于任务开始
  const state = { projectDir: tmpDir, startedAt: Date.now() - 600000 };
  const r = runner._checkResultAuthenticity(state, '修改了 sub/old-file.txt');
  assert.ok(r, '应返回 warning');
  assert.match(r, /修改时间早于任务开始/);
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
});

test('handleCandidateResult 敷衍超限后接受并附 warning', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);

  const fsMod = require('fs');
  const pathMod = require('path');
  const tmpDir = pathMod.join(process.cwd(), 'test', 'tmp', 'trivial-accept');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
  fsMod.mkdirSync(tmpDir, { recursive: true });

  const webContents = { id: 'wc-trivial2' };
  let resolved = null;
  const state = {
    taskId: 'r-trivial2',
    phase: 'working',
    projectDir: tmpDir,
    startedAt: Date.now() - 10000,
    supplementCount: 2,
    win: {
      webContents,
      isDestroyed: () => false,
      close: () => {},
    },
    resolve: (v) => { resolved = v; },
    reject: null,
  };
  runner.activeTasks.set('r-trivial2', state);

  const r = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '我完成了' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.accepted, true);
  assert.ok(r.warning, '应附加 warning');
  assert.match(r.warning, /敷衍/);
  assert.ok(resolved, '应 resolve');
  assert.strictEqual(runner.activeTasks.has('r-trivial2'), false, '任务应完成清理');

  fsMod.rmSync(tmpDir, { recursive: true, force: true });
});

test('handleCandidateResult 落盘失败拒绝', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const fsMod = require('fs');
  const pathMod = require('path');
  const tmpBase = pathMod.join(process.cwd(), 'test', 'tmp', 'subagent-results-fail');
  fsMod.rmSync(tmpBase, { recursive: true, force: true });
  fsMod.mkdirSync(tmpBase, { recursive: true });
  // 造一个「文件」作为 projectDir，让 mkdirSync 在它下面建 .cuckoo 必然失败
  const fakeFile = pathMod.join(tmpBase, 'not-a-dir');
  fsMod.writeFileSync(fakeFile, 'x', 'utf-8');

  const webContents = { id: 'wc-fail' };
  const state = {
    taskId: 'r-fail',
    phase: 'working',
    projectDir: fakeFile,
    startedAt: Date.now() - 10000,
    supplementCount: 0,
    win: { webContents },
  };
  runner.activeTasks.set('r-fail', state);

  const r = runner.handleCandidateResult(webContents, { type: 'subagent_result', text: '修改了 a.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题。' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.accepted, false);
  assert.match(r.error, /落盘失败/);

  fsMod.rmSync(tmpBase, { recursive: true, force: true });
});

// ========== Task 10：停住检测与轮次硬顶 ==========
test('plain_text 无工具活动发停住提醒（场景 A）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const sent = [];
  const webContents = { id: 'wc-a' };
  const state = {
    taskId: 't10-a',
    phase: 'working',
    projectDir: null,
    startedAt: Date.now(),
    hasToolActivity: false,
    idleReminderCount: 0,
    win: { webContents, isDestroyed: () => false, close: () => {} },
    resolve: null,
    reject: null,
  };
  runner.activeTasks.set('t10-a', state);
  webContents.send = (ch, payload) => sent.push({ ch, payload });

  const r = runner.handleCandidateResult(webContents, { type: 'plain_text', text: '我在思考怎么做' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.handled, false);
  assert.strictEqual(sent.length, 1, '应发提醒');
  assert.match(sent[0].payload.message, /请继续执行任务/);
  assert.strictEqual(runner.activeTasks.has('t10-a'), true, '任务保持 active');
});

test('plain_text 有工具活动不发停住提醒（策略 B 回退）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const sent = [];
  const webContents = { id: 'wc-b' };
  const state = {
    taskId: 't10-b',
    phase: 'working',
    projectDir: null,
    startedAt: Date.now(),
    hasToolActivity: true,
    idleReminderCount: 0,
    win: { webContents, isDestroyed: () => false },
    resolve: null,
    reject: null,
  };
  runner.activeTasks.set('t10-b', state);
  webContents.send = (ch, payload) => sent.push({ ch, payload });

  const r = runner.handleCandidateResult(webContents, { type: 'plain_text', text: '正在读取文件' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(sent.length, 0, '有工具活动不应发停住提醒');
});

test('markActivity 递增 interactionCount 并重置 idleTimer', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = {
    taskId: 't10-c',
    phase: 'working',
    interactionCount: 5,
    hasToolActivity: false,
    idleTimer: setTimeout(() => {}, 100000),
  };
  const allowed = runner.markActivity(state);
  assert.strictEqual(allowed, true);
  assert.strictEqual(state.interactionCount, 6);
  assert.strictEqual(state.hasToolActivity, true);
  assert.notStrictEqual(state.idleTimer, null);
  // 清理
  clearTimeout(state.idleTimer);
});

test('markActivity 无匹配任务返回 false 但静默（普通窗口）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  assert.strictEqual(runner.markActivity(null), false);
});

test('轮次硬顶：interactionCount 达上限后 phase→force_deliver 且发强制交付', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const sent = [];
  const webContents = { id: 'wc-round' };
  const state = {
    taskId: 't10-round',
    phase: 'working',
    interactionCount: 59,
    hasToolActivity: true,
    win: { webContents, isDestroyed: () => false },
  };
  runner.activeTasks.set('t10-round', state);
  webContents.send = (ch, payload) => sent.push({ ch, payload });

  // 第 60 轮调用 → 触发轮次硬顶
  const allowed = runner.markActivity(state);
  assert.strictEqual(allowed, false, '第 60 轮后应拦截');
  assert.strictEqual(state.phase, 'force_deliver');
  assert.strictEqual(state.interactionCount, 60, '第 60 轮后计数为 60');
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].payload.message, /最大交互轮次/);
  // 清理 markActivity 创建的 180s idleTimer，避免事件循环等待
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
});

test('force_deliver 阶段后续工具被 ipc.js 拦截（通过 findTaskByWebContents 反查）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const webContents = { id: 'wc-fd' };
  const state = {
    taskId: 't10-fd',
    phase: 'force_deliver',
    interactionCount: 60,
    hasToolActivity: true,
    win: { webContents, isDestroyed: () => false },
  };
  runner.activeTasks.set('t10-fd', state);

  // 模拟 ipc.js 的 execute-tool 拦截逻辑
  const found = runner.findTaskByWebContents(webContents);
  const allowed = found ? runner.markActivity(found) : false;
  assert.strictEqual(found, state);
  assert.strictEqual(allowed, false, 'force_deliver 后工具调用被拒绝');
});

test('findTaskByWebContents 普通窗口返回 null', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const normalWc = { id: 'wc-normal' };
  assert.strictEqual(runner.findTaskByWebContents(normalWc), null);
});

test('_onIdleTimeout 未达上限：发提醒 + count+1 + 重新 arm', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const sent = [];
  const webContents = { id: 'wc-idle-a' };
  webContents.send = (ch, payload) => sent.push({ ch, payload });
  const state = {
    taskId: 't10-idle-a',
    phase: 'working',
    idleReminderCount: 0,
    idleTimer: null,
    win: { webContents, isDestroyed: () => false },
  };
  runner.activeTasks.set('t10-idle-a', state);

  runner._onIdleTimeout(state);
  assert.strictEqual(sent.length, 1, '未达上限应发提醒');
  assert.match(sent[0].payload.message, /请立即继续执行任务/);
  assert.strictEqual(state.idleReminderCount, 1, '提醒后计数+1');
  assert.ok(state.idleTimer, '应重新 arm idleTimer');
  clearTimeout(state.idleTimer); // 清理真实 180s 定时器
});

test('_onIdleTimeout 达上限：不发不 arm（静默等待总超时）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const sent = [];
  const webContents = { id: 'wc-idle-b' };
  webContents.send = (ch, payload) => sent.push({ ch, payload });
  const state = {
    taskId: 't10-idle-b',
    phase: 'working',
    idleReminderCount: 2, // 已达 IDLE_REMINDER_MAX
    idleTimer: null,
    win: { webContents, isDestroyed: () => false },
  };
  runner.activeTasks.set('t10-idle-b', state);

  runner._onIdleTimeout(state);
  assert.strictEqual(sent.length, 0, '达上限后不再提醒');
  assert.strictEqual(state.idleTimer, null, '达上限后不重新 arm');
});

test('_onIdleTimeout 任务已结束：不发不 arm', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const sent = [];
  const webContents = { id: 'wc-idle-c' };
  webContents.send = (ch, payload) => sent.push({ ch, payload });
  const state = {
    taskId: 't10-idle-c',
    phase: 'completed',
    idleReminderCount: 0,
    idleTimer: null,
    win: { webContents, isDestroyed: () => false },
  };
  runner.activeTasks.set('t10-idle-c', state);

  runner._onIdleTimeout(state);
  assert.strictEqual(sent.length, 0, '已结束任务不发提醒');
  assert.strictEqual(state.idleTimer, null, '已结束任务不 arm');
});

/* ================= Task 11/12：状态查询、清单、中止、聚焦 ================= */

test('getStatusList 只返回运行中任务', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  runner.activeTasks.set('s-working', { taskId: 's-working', phase: 'working', agentType: 'code-reviewer', startedAt: Date.now() - 5000, win: { id: 1 } });
  runner.activeTasks.set('s-starting', { taskId: 's-starting', phase: 'starting', agentType: null, startedAt: Date.now(), win: { id: 2 } });
  runner.activeTasks.set('s-done', { taskId: 's-done', phase: 'completed', agentType: 'x', startedAt: Date.now(), win: { id: 3 } });

  const list = runner.getStatusList();
  assert.strictEqual(list.length, 2, 'completed 任务不进入列表');
  const ids = list.map(t => t.taskId).sort();
  assert.deepStrictEqual(ids, ['s-starting', 's-working']);
  const working = list.find(t => t.taskId === 's-working');
  assert.strictEqual(working.agentType, 'code-reviewer');
  assert.ok(working.elapsedMs >= 5000);
  const starting = list.find(t => t.taskId === 's-starting');
  assert.strictEqual(starting.agentType, '通用', 'agentType 为空时显示通用');
});

test('getAgentList 返回模板清单', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const fsMod = require('fs');
  const pathMod = require('path');
  // 写入 mock 的内置 agent 目录（getAppPath -> test/tmp/appPath）
  const builtinAgents = pathMod.join(process.cwd(), 'test', 'tmp', 'appPath', 'agents');
  fsMod.rmSync(pathMod.join(process.cwd(), 'test', 'tmp', 'appPath'), { recursive: true, force: true });
  fsMod.rmSync(pathMod.join(process.cwd(), 'test', 'tmp', 'userData', 'agents'), { recursive: true, force: true });
  fsMod.mkdirSync(builtinAgents, { recursive: true });
  fsMod.writeFileSync(pathMod.join(builtinAgents, 'code-reviewer.md'), '# 代码审查\n\n审查代码', 'utf-8');

  const list = runner.getAgentList();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'code-reviewer');
  assert.strictEqual(list[0].summary, '代码审查');
  fsMod.rmSync(pathMod.join(process.cwd(), 'test', 'tmp', 'appPath'), { recursive: true, force: true });
});

test('abortByWindowId 命中任务并中止', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  let closed = false;
  const state = {
    taskId: 'abort-target',
    phase: 'working',
    win: { id: 42, isDestroyed: () => false, close: () => { closed = true; } },
    timer: null, startingTimer: null, idleTimer: null,
    resolve: null, reject: () => {},
  };
  runner.activeTasks.set('abort-target', state);

  const ok = runner.abortByWindowId(42);
  assert.strictEqual(ok, true);
  assert.strictEqual(state.phase, 'failed');
  assert.strictEqual(closed, true, '应关窗');
});

test('abortByWindowId 未命中返回 false', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  assert.strictEqual(runner.abortByWindowId(999), false);
});

test('focusByWindowId 命中任务并 focus', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  let focused = false;
  let restored = false;
  const state = {
    taskId: 'focus-target',
    phase: 'working',
    win: {
      id: 7,
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: () => { restored = true; },
      focus: () => { focused = true; },
    },
  };
  runner.activeTasks.set('focus-target', state);

  const ok = runner.focusByWindowId(7);
  assert.strictEqual(ok, true);
  assert.strictEqual(restored, true, '最小化时应 restore');
  assert.strictEqual(focused, true, '应 focus');
});

test('focusByWindowId 未命中返回 false', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  assert.strictEqual(runner.focusByWindowId(999), false);
});

test('setStatusChangeHandler 任务开始与结束触发通知', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const events = [];
  runner.setStatusChangeHandler((tasks) => events.push(tasks.length));

  // 手动模拟任务注册（不启动真实窗口）
  runner.activeTasks.set('sc-1', { taskId: 'sc-1', phase: 'working', agentType: null, startedAt: Date.now(), win: { id: 1 } });
  runner._notifyStatusChange();
  assert.strictEqual(events[events.length - 1], 1, '有任务时通知 1 条');

  runner.activeTasks.delete('sc-1');
  runner._notifyStatusChange();
  assert.strictEqual(events[events.length - 1], 0, '无任务时通知 0 条');
});

/* ================= 复审修复：R-1/I-1/O-1/O-2 ================= */

test('R-1: force_deliver 阶段交付被接收（落盘 + resolve + 关窗）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const fsMod = require('fs');
  const pathMod = require('path');
  const tmpDir = pathMod.join(process.cwd(), 'test', 'tmp', 'force-deliver-accept');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
  fsMod.mkdirSync(tmpDir, { recursive: true });

  const wc = { id: 'wc-fd-accept', send: () => {} };
  let resolved = null;
  let closed = false;
  const state = {
    taskId: 'fd-accept',
    phase: 'force_deliver',
    projectDir: tmpDir,
    startedAt: Date.now() - 10000,
    supplementCount: 0,
    win: { webContents: wc, isDestroyed: () => false, close: () => { closed = true; } },
    timer: null, startingTimer: null, idleTimer: null,
    resolve: (v) => { resolved = v; },
    reject: null,
  };
  runner.activeTasks.set('fd-accept', state);

  const r = runner.handleCandidateResult(wc, { type: 'subagent_result', text: '修改了 a.js 文件的 createWindow 函数。增加了 isSubagent 参数支持。修复了窗口标题显示问题。' });
  assert.strictEqual(r.success, true, 'force_deliver 阶段应接受交付');
  assert.strictEqual(r.accepted, true);
  assert.ok(r.resultFile, '应落盘');
  assert.strictEqual(state.phase, 'completed');
  assert.ok(resolved, '应 resolve');
  assert.strictEqual(closed, true, '应关窗');
  assert.strictEqual(runner.activeTasks.has('fd-accept'), false, '应摘除 activeTasks');
  fsMod.rmSync(tmpDir, { recursive: true, force: true });
});

test('I-1: 场景 A 停顿提醒 2 次后静默', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  let sentCount = 0;
  const wc = { id: 'wc-stall', send: () => { sentCount++; } };
  const state = {
    taskId: 'stall-cap',
    phase: 'working',
    hasToolActivity: false,
    stallReminderCount: 0,
    win: { webContents: wc, isDestroyed: () => false },
  };

  runner._handlePlainText(state, '随便说点什么');
  assert.strictEqual(sentCount, 1, '第 1 次发提醒');
  assert.strictEqual(state.stallReminderCount, 1);
  runner._handlePlainText(state, '再说点');
  assert.strictEqual(sentCount, 2, '第 2 次发提醒');
  assert.strictEqual(state.stallReminderCount, 2);
  runner._handlePlainText(state, '继续说');
  assert.strictEqual(sentCount, 2, '第 3 次静默（不增）');
  assert.strictEqual(state.stallReminderCount, 2);
});

test('O-1: 第 59 轮放行（未达硬顶）', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = {
    taskId: 'round-59',
    phase: 'working',
    interactionCount: 58,
    hasToolActivity: true,
    win: { webContents: { id: 'wc-59', send: () => {} }, isDestroyed: () => false },
  };
  const allowed = runner.markActivity(state);
  assert.strictEqual(allowed, true, '第 59 轮应放行');
  assert.strictEqual(state.interactionCount, 59);
  assert.strictEqual(state.phase, 'working', '未达硬顶不转 phase');
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
});

test('O-1: 硬顶拦截时 interactionCount 不增长', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = {
    taskId: 'round-fd',
    phase: 'force_deliver',
    interactionCount: 60,
    hasToolActivity: true,
    win: { webContents: { id: 'wc-fd', send: () => {} }, isDestroyed: () => false },
  };
  const allowed = runner.markActivity(state);
  assert.strictEqual(allowed, false, '硬顶后应拦截');
  assert.strictEqual(state.interactionCount, 60, '拦截时计数不增长');
});

test('O-2: 提醒后恢复活跃 → idleReminderCount 归零', () => {
  const { fn } = createMockWindowFactory();
  const runner = new SubagentRunner(fn);
  const state = {
    taskId: 'idle-reset',
    phase: 'working',
    interactionCount: 3,
    idleReminderCount: 2,
    hasToolActivity: true,
    win: { webContents: { id: 'wc-ir', send: () => {} }, isDestroyed: () => false },
  };
  runner.markActivity(state);
  assert.strictEqual(state.idleReminderCount, 0, '恢复活跃应归零');
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
});

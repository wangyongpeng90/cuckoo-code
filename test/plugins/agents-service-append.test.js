/**
 * [022] session.append 错误传播测试（决策 9.7）
 *
 * 契约来源：docs/dsh-compat-decisions.md 9.7
 *   - 保留现状（只处理 session/title，静默忽略其它 type）
 *   - 补充错误传播：host.setSessionTitleForId 失败时 append 要抛错
 *
 * 依据 dsh-tasks（_dsh-tasks.js:493-503）只用 session/title，
 * 且用 try-catch 兜住错误，所以 throw 不会影响任务。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { createAgents } from '../../src/plugins/dsh-compat/agents-service.js';

test('[022] session.append：setSessionTitleForId 抛错 → append 也抛（错误传播）', async () => {
  const agents = createAgents({
    setSessionTitleForId: () => { throw new Error('title write failed'); },
  });
  const h = await agents.create({ sessionId: 'append-err-1' });
  try {
    assert.throws(
      () => h.agent.session.append('session/title', { title: 'x', messageSeqs: [], source: { kind: 'user' } }),
      /title write failed/,
      'append 应传播 setSessionTitleForId 的异常',
    );
  } finally {
    await h.dispose();
  }
});

test('[022] session.append：正常路径 → setSessionTitleForId 收到正确参数', async () => {
  const calls = [];
  const agents = createAgents({
    setSessionTitleForId: (logicId, title) => { calls.push({ logicId, title }); },
  });
  const h = await agents.create({ sessionId: 'append-ok-1' });
  try {
    h.agent.session.append('session/title', { title: '定时任务 · 10-22', messageSeqs: [], source: { kind: 'user' } });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].logicId, 'append-ok-1');
    assert.strictEqual(calls[0].title, '定时任务 · 10-22');
  } finally {
    await h.dispose();
  }
});

test('[022] session.append：其它 type → 静默忽略（不抛错、不调 setSessionTitleForId）', async () => {
  const calls = [];
  const agents = createAgents({
    setSessionTitleForId: (logicId, title) => { calls.push({ logicId, title }); },
  });
  const h = await agents.create({ sessionId: 'append-other-1' });
  try {
    h.agent.session.append('session/other', { some: 'data' });
    assert.strictEqual(calls.length, 0, '不应调用 setSessionTitleForId');
  } finally {
    await h.dispose();
  }
});

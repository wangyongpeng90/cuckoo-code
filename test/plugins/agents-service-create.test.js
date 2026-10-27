/**
 * [022] agents-service.create 深度对齐测试（决策 9.2 + 9.3）
 *
 * 契约来源：
 *   - docs/dsh-compat-decisions.md 9.2：meta.cwd 严格校验绝对路径
 *   - docs/dsh-compat-decisions.md 9.3：setup 必调，agentCtx 最小实现
 *   - DSH 源码 packages/core/session/src/index.ts:116-119（cwd 校验）
 *   - DSH 源码 packages/core/agent-loop/src/index.ts:774-799（setup 失败回滚）
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgents } from '../../src/plugins/dsh-compat/agents-service.js';

/** 建临时目录（realpath 需要真实存在） */
function mkProjDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-create-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ===== 9.2 meta.cwd 校验 =====

test('[022] create：sessionId 已存在 → throw', async () => {
  const agents = createAgents({});
  const h1 = await agents.create({ sessionId: 'dup-1' });
  try {
    await assert.rejects(
      () => agents.create({ sessionId: 'dup-1' }),
      /already exists/i,
    );
  } finally {
    await h1.dispose();
  }
});

test('[022] create：meta.cwd 传了但不是字符串 → throw', async () => {
  const agents = createAgents({});
  await assert.rejects(
    () => agents.create({ sessionId: 'bad-type-1', meta: { cwd: 123 } }),
    /cwd.*string|absolute/i,
  );
});

test('[022] create：meta.cwd 是相对路径 → throw', async () => {
  const agents = createAgents({});
  await assert.rejects(
    () => agents.create({ sessionId: 'rel-1', meta: { cwd: 'relative/path' } }),
    /absolute/i,
  );
});

test('[022] create：meta.cwd 未传 → projectDir = null', async () => {
  const agents = createAgents({});
  const h = await agents.create({ sessionId: 'no-cwd-1' });
  try {
    assert.strictEqual(h.agent.session.projectDir, null);
  } finally {
    await h.dispose();
  }
});

test('[022] create：meta.cwd 是绝对路径 → projectDir 为 realpath 后的路径', async () => {
  const projDir = mkProjDir();
  try {
    const agents = createAgents({});
    const h = await agents.create({ sessionId: 'abs-1', meta: { cwd: projDir } });
    try {
      assert.strictEqual(h.agent.session.projectDir, fs.realpathSync(projDir));
    } finally {
      await h.dispose();
    }
  } finally {
    cleanup(projDir);
  }
});

// ===== 9.3 setup 调用 =====

test('[022] create：传了 setup → setup 被调用（agentCtx + agent 两参）', async () => {
  const agents = createAgents({});
  let called = false;
  let gotCtx = null;
  let gotAgent = null;
  const h = await agents.create({
    sessionId: 'setup-1',
    setup: async (agentCtx, agent) => {
      called = true;
      gotCtx = agentCtx;
      gotAgent = agent;
    },
  });
  try {
    assert.strictEqual(called, true, 'setup 应被调用');
    assert.ok(gotCtx, 'agentCtx 应传入');
    assert.ok(gotAgent, 'agent 应传入');
    assert.strictEqual(typeof gotCtx.get, 'function', 'agentCtx.get 应是函数');
    assert.strictEqual(gotCtx.get('anything'), undefined, 'agentCtx.get 应返回 undefined');
  } finally {
    await h.dispose();
  }
});

test('[022] create：setup 抛错 → create 失败 + activeSessions 回滚（可重新 create 同 id）', async () => {
  const agents = createAgents({});
  await assert.rejects(
    () => agents.create({
      sessionId: 'setup-fail-1',
      setup: async () => { throw new Error('boom from setup'); },
    }),
    /boom from setup/,
  );
  // 回滚验证：同 sessionId 可以再次 create（不会撞 already exists）
  const h = await agents.create({ sessionId: 'setup-fail-1' });
  try {
    assert.ok(h.agent);
  } finally {
    await h.dispose();
  }
});

test('[022] create：未传 setup → 正常返回', async () => {
  const agents = createAgents({});
  const h = await agents.create({ sessionId: 'no-setup-1' });
  try {
    assert.ok(h.agent);
    assert.strictEqual(typeof h.agent.followup, 'function');
  } finally {
    await h.dispose();
  }
});

/**
 * C5 测试：DSH 插件会话落盘 + 重放。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c5-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c5-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "import { defineTool } from '@deepseek-ai/dsh-tools';",
    "export const name = 'c5-test';",
    "export function apply(ctx) {",
    "  ctx.inject(['sessionProjections'], (pc) => {",
    "    pc.sessionProjections.register({ key: 'todos', init: () => null, apply: (s, e) => e.type === 'todo/write' ? e.data.todos : s, view: (s) => s, stateVersion: 1 });",
    "  });",
    "  ctx.tools.register(defineTool({",
    "    name: 'add_todo', description: 'd', parameters: { content: { type: 'string', required: true } },",
    "    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },",
    "    async execute(args, exec) { exec.agent.session.append('todo/write', { todos: [{ content: args.content, status: 'pending' }] }); return 'ok'; },",
    "  }));",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C5：会话事件落盘 + 重启重放', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c5home-'));
  process.env.CUCKOO_HOME = home;
  const dir = makePluginDir();
  try {
    // 第一次：加载 → 调工具 → 落盘
    const r1 = await loadCuckooPlugin(dir);
    await r1.tools[0].execute({ content: '买牛奶' });
    const logFile = path.join(home, 'cuckoo-plugins-data', path.basename(dir), 'session.jsonl');
    assert.ok(fs.existsSync(logFile), '应有 JSONL 落盘');
    // 第二次：重新加载（模拟重启）→ 重放历史 → 投影恢复
    const r2 = await loadCuckooPlugin(dir);
    const todos = r2.runtime.projections.get('todos');
    assert.deepStrictEqual(todos, [{ content: '买牛奶', status: 'pending' }], '重启后投影应恢复');
  } finally {
    delete process.env.CUCKOO_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

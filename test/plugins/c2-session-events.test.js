/**
 * C2 测试：DSH 内存会话事件流 + 投影。
 * 验证：todo_write 的 append 真写、投影能读回。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c2-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c2-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  // 插件：注册 todos 投影 + 注册 todo_write 工具（append + 读投影）
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "import { defineTool } from '@deepseek-ai/dsh-tools';",
    "export const name = 'c2-test';",
    "export function apply(ctx) {",
    "  ctx.inject(['sessionProjections'], (pc) => {",
    "    pc.sessionProjections.register({",
    "      key: 'todos',",
    "      init: () => null,",
    "      apply: (state, event) => {",
    "        if (event.type === 'todo/write') return event.data.todos;",
    "        return state;",
    "      },",
    "      view: (state) => state,",
    "      stateVersion: 1,",
    "    });",
    "  });",
    "  ctx.tools.register(defineTool({",
    "    name: 'todo_write',",
    "    description: 'write todos',",
    "    parameters: { todos: { type: 'array', required: true } },",
    "    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },",
    "    async execute(args, exec) {",
    "      exec.agent.session.append('todo/write', { todos: args.todos });",
    "      return 'written ' + args.todos.length;",
    "    },",
    "  }));",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C2：todo_write 的 append 真写 + 投影真读回', async () => {
  const dir = makePluginDir();
  try {
    const { tools, runtime } = await loadCuckooPlugin(dir);
    assert.strictEqual(tools.length, 1);
    const tool = tools[0];
    const out = await tool.execute({ todos: [{ content: '买牛奶', status: 'pending' }] });
    assert.strictEqual(out, 'written 1');
    // 事件真写进内存会话
    const { getDshSession } = await import('../../src/plugins/dsh-compat/shim.js');
    const session = getDshSession();
    assert.ok(session, '应有内存会话');
    assert.strictEqual(session.events.length, 1);
    assert.strictEqual(session.events[0].type, 'todo/write');
    assert.deepStrictEqual(session.events[0].data.todos, [{ content: '买牛奶', status: 'pending' }]);
    // 投影真读回（插件注册的 todos 投影）
    const todos = runtime.projections.get('todos');
    assert.deepStrictEqual(todos, [{ content: '买牛奶', status: 'pending' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

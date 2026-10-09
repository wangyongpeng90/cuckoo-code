/**
 * 插件工具沙箱注入测试（P1-b）
 * 验证：注册到 registry 的插件工具 → 动态注入沙箱 → AI 代码可调用。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { ToolRegistry } from '../../src/tools/core/ToolRegistry.js';
import { JsRunner } from '../../src/tools/runtime/JsRunner.js';
import { DshPluginTool } from '../../src/plugins/cuckoo-plugins/index.js';

test('插件工具：注册后 AI 可调用（动态注入沙箱）', async () => {
  const registry = new ToolRegistry();
  const tool = new DshPluginTool({
    name: 'greet',
    description: 'Greet someone',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    execute: async (args) => 'Hello, ' + args.name + '!',
  });
  registry.register(tool);

  const runner = new JsRunner(registry);
  const r = await runner.run('const msg = await greet("Cuckoo"); log(msg);', process.cwd());
  assert.strictEqual(r.success, true, '应执行成功，实际: ' + JSON.stringify(r));
  assert.ok(r.output.includes('Hello, Cuckoo!'), '输出应含 Hello, Cuckoo!，实际: ' + r.output);
});

test('插件工具：dynamic 标记 + jsApi 生成', () => {
  const tool = new DshPluginTool({
    name: 'greet',
    description: 'Greet',
    parameters: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name'] },
    execute: async () => 'ok',
  });
  assert.strictEqual(tool.dynamic, true);
  assert.strictEqual(tool.jsApi, 'greet(name: string, age?: number)');
  assert.ok(tool.getPromptSection());
  assert.ok(tool.getPromptSection().text.includes('greet'));
});

test('插件工具：jsApi 展开嵌套（数组元素/枚举）', () => {
  const tool = new DshPluginTool({
    name: 'todo_write',
    description: 'd',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'done'] } },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    execute: async () => 'ok',
  });
  assert.match(tool.jsApi, /todos: \(\{content: string, status: "pending"\|"done"\}\)\[\]/);
});

test('插件工具：非法标识符名不注入（防注入）', async () => {
  const registry = new ToolRegistry();
  const tool = new DshPluginTool({
    name: 'bad-name',
    description: 'bad',
    parameters: { type: 'object', properties: {} },
    execute: async () => 'x',
  });
  registry.register(tool);
  const runner = new JsRunner(registry);
  const r = await runner.run('log(typeof globalThis["bad-name"]);', process.cwd());
  assert.strictEqual(r.success, true);
  assert.ok(r.output.includes('undefined'), '非法名不应注入，实际: ' + r.output);
});

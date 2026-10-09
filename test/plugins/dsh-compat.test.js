/**
 * DSH 兼容层测试（P1-a）
 * 验证：DSH defineTool → Cuckoo 工具的转换 + 执行。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import { defineTool, dshParamsToJsonSchema } from '../../src/plugins/dsh-compat/shim.js';

test('dshParamsToJsonSchema：DSH 参数 → JSON Schema（隐式 open object）', () => {
  const schema = dshParamsToJsonSchema({
    name: { type: 'string', required: true, description: '名字' },
    age: { type: 'number' },
  });
  assert.strictEqual(schema.type, 'object');
  assert.strictEqual(schema.additionalProperties, true);
  assert.deepStrictEqual(schema.required, ['name']);
  assert.strictEqual(schema.properties.name.type, 'string');
  assert.strictEqual(schema.properties.name.description, '名字');
  assert.strictEqual(schema.properties.age.type, 'number');
});

test('dshParamsToJsonSchema：空参数 → 空 object', () => {
  const schema = dshParamsToJsonSchema(undefined);
  assert.strictEqual(schema.type, 'object');
  assert.deepStrictEqual(schema.properties, {});
  assert.deepStrictEqual(schema.required, []);
});

test('dshParamsToJsonSchema：嵌套 required 递归提取', () => {
  const schema = dshParamsToJsonSchema({
    todos: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['pending', 'done'] },
        },
      },
    },
  });
  assert.deepStrictEqual(schema.required, ['todos']);
  const item = schema.properties.todos.items;
  assert.deepStrictEqual(item.required, ['content', 'status']);
  assert.strictEqual(item.additionalProperties, false);
  assert.deepStrictEqual(item.properties.status.enum, ['pending', 'done']);
  // required 不应残留在属性节点上
  assert.strictEqual(item.properties.content.required, undefined);
});

test('defineTool：转成 Cuckoo 工具（name/description/parameters/execute）', async () => {
  const tool = defineTool({
    name: 'greet',
    description: 'Greet someone',
    parameters: { name: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) { return 'Hello, ' + args.name + '!'; },
  });
  assert.strictEqual(tool.name, 'greet');
  assert.strictEqual(tool.description, 'Greet someone');
  assert.strictEqual(tool.parameters.type, 'object');
  assert.deepStrictEqual(tool.parameters.required, ['name']);
  const out = await tool.execute({ name: 'Cuckoo' });
  assert.strictEqual(out, 'Hello, Cuckoo!');
});

test('defineTool：无 output.render 时，值序列化为字符串', async () => {
  const tool = defineTool({
    name: 'echo',
    description: 'echo',
    parameters: { v: { type: 'string' } },
    async execute(args) { return { got: args.v }; },
  });
  const out = await tool.execute({ v: 'x' });
  assert.strictEqual(out, JSON.stringify({ got: 'x' }));
});

test('defineTool：缺 name 抛错', () => {
  assert.throws(() => defineTool({ description: 'd', execute() {} }), /name/);
});

test('defineTool：缺 description 抛错', () => {
  assert.throws(() => defineTool({ name: 'x', execute() {} }), /description/);
});

test('defineTool：缺 execute 抛错', () => {
  assert.throws(() => defineTool({ name: 'x', description: 'd' }), /execute/);
});

test('defineTool：output.render 抛错时回退原值', async () => {
  const tool = defineTool({
    name: 'boom',
    description: 'd',
    parameters: {},
    output: { schema: { type: 'string' }, render() { throw new Error('render 坏了'); } },
    async execute() { return 'ok'; },
  });
  const out = await tool.execute({});
  assert.strictEqual(out, 'ok');
});

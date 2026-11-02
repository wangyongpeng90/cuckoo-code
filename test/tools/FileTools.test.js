'use strict';
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DeleteFileTool } from '../../src/tools/impl/delete-file.js';
import { WriteTool } from '../../src/tools/impl/write.js';
import { ReadTool } from '../../src/tools/impl/read.js';
import { EditTool } from '../../src/tools/impl/edit.js';

const tmpRoot = path.join(process.cwd(), 'test', 'tmp', 'filetools');

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('DeleteFileTool 删除文件', async () => {
  const f = path.join(tmpRoot, 'a.txt');
  fs.writeFileSync(f, 'x');
  const tool = new DeleteFileTool();
  const r = await tool.execute({ filePath: 'a.txt', projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.strictEqual(fs.existsSync(f), false);
});

test('DeleteFileTool 文件不存在', async () => {
  const tool = new DeleteFileTool();
  const r = await tool.execute({ filePath: 'missing.txt', projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /删除文件失败/);
});

test('DeleteFileTool 目录不是文件', async () => {
  fs.mkdirSync(path.join(tmpRoot, 'dir'));
  const tool = new DeleteFileTool();
  const r = await tool.execute({ filePath: 'dir', projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /路径不是文件/);
});

test('DeleteFileTool 缺少 filePath', async () => {
  const tool = new DeleteFileTool();
  const r = await tool.execute({ projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /缺少参数 filePath/);
});

test('WriteTool 新建与覆盖', async () => {
  const tool = new WriteTool();
  const r1 = await tool.execute({ filePath: 'b.txt', content: 'one', projectDir: tmpRoot });
  assert.strictEqual(r1.success, true);
  assert.ok(r1.data.indexOf('b.txt') >= 0, '新建结果应含路径：' + r1.data);
  assert.ok(r1.data.indexOf('<path>') < 0, '不应再是 XML 格式：' + r1.data);
  const r2 = await tool.execute({ filePath: 'b.txt', content: 'two', projectDir: tmpRoot });
  assert.strictEqual(r2.success, true);
  assert.ok(r2.data.indexOf('b.txt') >= 0, '更新结果应含路径：' + r2.data);
  assert.ok(r2.data.indexOf('<path>') < 0, '不应再是 XML 格式：' + r2.data);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'b.txt'), 'utf8'), 'two');
});

test('WriteTool 目标是目录报错', async () => {
  fs.mkdirSync(path.join(tmpRoot, 'dir'));
  const tool = new WriteTool();
  const r = await tool.execute({ filePath: 'dir', content: 'x', projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /目标路径是目录/);
});

test('ReadTool 读取带行号', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'c.txt'), 'line1\nline2\nline3');
  const tool = new ReadTool();
  const r = await tool.execute({ filePath: 'c.txt', projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.match(r.data, /1: line1/);
  assert.match(r.data, /3: line3/);
  assert.ok(r.data.split('\n\n').pop().indexOf('3') >= 0, '结尾应含总行数 3');
});

test('ReadTool 剥离 UTF-8 BOM（PowerShell 写的文件）', async () => {
  const f = path.join(tmpRoot, 'bom.txt');
  // PowerShell 5.1 的 -Encoding UTF8 会写 EF BB BF + 内容
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('中文内容\n', 'utf8')]));
  const tool = new ReadTool();
  const r = await tool.execute({ filePath: 'bom.txt', projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.ok(r.data.indexOf('\uFEFF') < 0, '不应含 BOM：' + JSON.stringify(r.data.slice(0, 40)));
  assert.match(r.data, /1: 中文内容/);
});

test('ReadTool 文件不存在', async () => {
  const tool = new ReadTool();
  const r = await tool.execute({ filePath: 'missing.txt', projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /文件不存在/);
});

test('EditTool 成功替换', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'hello world');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'world', newString: 'cuckoo', projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.match(r.data, /已更新 d.txt，替换了 1 处/);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'd.txt'), 'utf8'), 'hello cuckoo');
});

test('EditTool oldString 不存在', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'abc');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'zzz', newString: 'y', projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /未找到要替换的文本/);
});

test('EditTool 多次匹配需要 replace_all', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'x x x');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'x', newString: 'y', projectDir: tmpRoot });
  assert.strictEqual(r.success, false);
  assert.match(r.error, /出现 3 次/);
});

test('EditTool replace_all', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'x x x');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'x', newString: 'y', replaceAll: true, projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'd.txt'), 'utf8'), 'y y y');
});

test('EditTool dry-run 预览不写入', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'x x x');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'x', newString: 'y', replaceAll: true, dryRun: true, projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.match(r.data, /\[预览\]/);
  assert.match(r.data, /将全部替换 3 处/);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'd.txt'), 'utf8'), 'x x x');
});

test('EditTool dry-run 唯一替换预览', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'hello world');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'world', newString: 'cuckoo', dryRun: true, projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.match(r.data, /\[预览\]/);
  assert.match(r.data, /将替换 1 处/);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'd.txt'), 'utf8'), 'hello world');
});

test('EditTool dry-run 删除预览', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'd.txt'), 'remove me');
  const tool = new EditTool();
  const r = await tool.execute({ filePath: 'd.txt', oldString: 'remove', newString: '', dryRun: true, projectDir: tmpRoot });
  assert.strictEqual(r.success, true);
  assert.match(r.data, /\[预览\]/);
  assert.match(r.data, /原内容 "remove" → 新内容 ""/);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'd.txt'), 'utf8'), 'remove me');
});


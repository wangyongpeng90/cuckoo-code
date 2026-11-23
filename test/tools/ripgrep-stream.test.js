/**
 * 流式 ripgrep 执行器测试
 *
 * 背景：旧实现 `stdout += chunk` 无限拼接，宽泛 pattern 时 rg --json 输出可达数百 MB，
 * 超过 V8 MAX_STRING_LENGTH（约 512MB）就抛 RangeError 把主进程搞崩。
 * 这里验证流式版本：内存恒定、够数即停、chunk 边界半行不丢。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { streamRipgrep } from '../../src/tools/impl/ripgrep-stream.js';

/** 建一个临时目录，写入若干文件 */
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgstream-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return dir;
}

test('逐行回调：--files 输出全部文件', async () => {
  const dir = makeFixture({ 'a.txt': 'x', 'b.txt': 'y', 'sub/c.txt': 'z' });
  const lines = [];
  const run = await streamRipgrep({
    args: ['--files'],
    cwd: dir,
    onLine: (line) => { lines.push(line); },
  });
  assert.strictEqual(run.code, 0);
  assert.strictEqual(run.stopped, false);
  const paths = lines.map(l => l.replace(/\\/g, '/').replace(/^\.\//, '')).sort();
  assert.deepStrictEqual(paths, ['a.txt', 'b.txt', 'sub/c.txt']);
});

test('onLine 返回 false 立即停止，不读完整个输出', async () => {
  // 造 500 个文件，只要前 3 个
  const files = {};
  for (let i = 0; i < 500; i++) files['f' + String(i).padStart(3, '0') + '.txt'] = 'x';
  const dir = makeFixture(files);

  let count = 0;
  const run = await streamRipgrep({
    args: ['--files'],
    cwd: dir,
    onLine: () => { count++; return count < 3; },
  });

  assert.strictEqual(count, 3, '收到第 3 行后应停止');
  assert.strictEqual(run.stopped, true, 'stopped 应标记为 true');
  assert.ok(run.bytesRead < 500 * 40, '不应读完整个输出');
});

test('maxBytes 字节兜底', async () => {
  const files = {};
  for (let i = 0; i < 200; i++) files['g' + i + '.txt'] = 'y';
  const dir = makeFixture(files);

  const run = await streamRipgrep({
    args: ['--files'],
    cwd: dir,
    maxBytes: 1024,           // 极小预算
    onLine: () => true,       // 永不主动停
  });
  assert.strictEqual(run.stopped, true, '超过字节预算应停止');
});

test('跨 chunk 的半行不丢（末行无换行符也回调）', async () => {
  const dir = makeFixture({ 'one.txt': 'a', 'two.txt': 'b', 'three.txt': 'c' });
  const lines = [];
  await streamRipgrep({
    args: ['--files'],
    cwd: dir,
    onLine: (line) => { lines.push(line); },
  });
  // 无论 chunk 如何切分，最终行数必须等于文件数
  const valid = lines.filter(l => l.trim().length > 0);
  assert.strictEqual(valid.length, 3, '3 个文件应产生 3 行');
});

test('无匹配时退出码 1，linesRead 为 0', async () => {
  const dir = makeFixture({ 'a.txt': 'hello' });
  const lines = [];
  const run = await streamRipgrep({
    args: ['--json', '--regexp=NOTHING_MATCHES_THIS', '--', '.'],
    cwd: dir,
    onLine: (line) => { lines.push(line); },
  });
  assert.strictEqual(run.code, 1);
  assert.strictEqual(run.stopped, false);
  // rg --json 无匹配时不输出 match 记录（可能输出 summary）
  assert.ok(lines.every(l => !l.includes('"type":"match"')));
});

test('宽泛搜索不会撑爆字符串（内存恒定）', async () => {
  // 造 3000 个匹配，验证只保留前 250 条时不会把整段输出读进内存
  const files = {};
  for (let i = 0; i < 300; i++) {
    files['m' + i + '.txt'] = Array.from({ length: 10 }, () => 'NEEDLE line').join('\n');
  }
  const dir = makeFixture(files);

  const matches = [];
  const run = await streamRipgrep({
    args: ['--json', '--regexp=NEEDLE', '--', '.'],
    cwd: dir,
    onLine: (line) => {
      if (line.includes('"type":"match"')) matches.push(line);
      return matches.length < 250;
    },
  });

  assert.strictEqual(matches.length, 250, '应只保留 250 条');
  assert.strictEqual(run.stopped, true, '攒满后应主动停止');

  // 对比「不限量跑完」的读取量：流式应显著更少
  const full = await streamRipgrep({
    args: ['--json', '--regexp=NEEDLE', '--', '.'],
    cwd: dir,
    onLine: () => true,
  });
  assert.ok(
    run.bytesRead < full.bytesRead,
    '流式读取量应小于全量（' + run.bytesRead + ' < ' + full.bytesRead + '）',
  );
});

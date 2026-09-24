'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeLineEndings, detectLineEndings, restoreLineEndings } from '../../src/infra/eol.js';
import { EditTool } from '../../src/tools/impl/edit.js';
import { WriteTool } from '../../src/tools/impl/write.js';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

// ===== eol.ts 纯函数 =====

test('normalizeLineEndings: CRLF → LF', () => {
  assert.strictEqual(normalizeLineEndings('a' + CR + LF + 'b'), 'a' + LF + 'b');
});

test('normalizeLineEndings: 孤立 \r 不动', () => {
  assert.strictEqual(normalizeLineEndings('a' + CR + 'b'), 'a' + CR + 'b');
});

test('normalizeLineEndings: 混合 → 全 LF', () => {
  assert.strictEqual(normalizeLineEndings('a' + LF + 'b' + CR + LF + 'c'), 'a' + LF + 'b' + LF + 'c');
});

test('detectLineEndings: 纯 LF', () => {
  assert.strictEqual(detectLineEndings('a' + LF + 'b' + LF), 'LF');
});

test('detectLineEndings: 纯 CRLF', () => {
  assert.strictEqual(detectLineEndings('a' + CR + LF + 'b' + CR + LF), 'CRLF');
});

test('detectLineEndings: 混合，CRLF 多 → CRLF', () => {
  assert.strictEqual(detectLineEndings('a' + CR + LF + 'b' + CR + LF + 'c' + LF), 'CRLF');
});

test('detectLineEndings: 平局 → LF', () => {
  assert.strictEqual(detectLineEndings('a' + LF + 'b' + CR + LF), 'LF');
});

test('detectLineEndings: 空 → LF', () => {
  assert.strictEqual(detectLineEndings(''), 'LF');
});

test('restoreLineEndings: LF 原样', () => {
  assert.strictEqual(restoreLineEndings('a' + LF + 'b', 'LF'), 'a' + LF + 'b');
});

test('restoreLineEndings: 转 CRLF', () => {
  assert.strictEqual(restoreLineEndings('a' + LF + 'b', 'CRLF'), 'a' + CR + LF + 'b');
});

test('restoreLineEndings: 已 CRLF 不翻倍成 \r\r\n', () => {
  assert.strictEqual(restoreLineEndings('a' + CR + LF + 'b', 'CRLF'), 'a' + CR + LF + 'b');
});

// ===== edit 工具 =====

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-eol-'));
  const f = path.join(dir, 'x.md');
  fs.writeFileSync(f, content, 'utf8');
  return f;
}
function countEol(s) {
  let crlf = 0, lf = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === LF) { if (i > 0 && s[i-1] === CR) crlf++; else lf++; }
  }
  return { crlf, lf };
}

test('edit: 纯 CRLF 文件，LF oldString 跨行 → 成功且保持 CRLF', async () => {
  const f = tmpFile(['# t', '- a', '- b'].join(CR + LF) + CR + LF);
  const tool = new EditTool();
  const r = await tool.execute({ filePath: f, oldString: '- a' + LF + '- b', newString: '- a2' + LF + '- b2' });
  assert.strictEqual(r.success, true, r.error);
  const after = fs.readFileSync(f, 'utf8');
  assert.strictEqual(countEol(after).lf, 0);
  assert.ok(after.indexOf('- a2') !== -1);
});

test('edit: 纯 LF 文件 → 保持 LF', async () => {
  const f = tmpFile(['# t', '- a', '- b'].join(LF) + LF);
  const tool = new EditTool();
  const r = await tool.execute({ filePath: f, oldString: '- a' + LF + '- b', newString: '- a2' + LF + '- b2' });
  assert.strictEqual(r.success, true, r.error);
  const after = fs.readFileSync(f, 'utf8');
  assert.strictEqual(countEol(after).crlf, 0);
});

test('edit: 混合文件被规整成主导格式（dsh 行为）', async () => {
  // LF 主导（5 LF / 2 CRLF）
  const content = ['# t', '- a1', '- a2', '- b1', '- b2'].join(LF) + LF + '- c1' + LF + '- d1' + CR + LF + '- d2' + CR + LF;
  const f = tmpFile(content);
  const tool = new EditTool();
  const r = await tool.execute({ filePath: f, oldString: '- b1' + LF + '- b2', newString: '- b1x' + LF + '- b2x' });
  assert.strictEqual(r.success, true, r.error);
  const after = fs.readFileSync(f, 'utf8');
  // 主导是 LF → 整个文件规整成纯 LF
  assert.strictEqual(countEol(after).crlf, 0);
  assert.ok(countEol(after).lf > 0);
});

test('edit: 单行编辑纯 CRLF 保持 CRLF', async () => {
  const f = tmpFile(['# t', '- a', '- b'].join(CR + LF) + CR + LF);
  const tool = new EditTool();
  const r = await tool.execute({ filePath: f, oldString: '- a', newString: '- ax' });
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(countEol(fs.readFileSync(f, 'utf8')).lf, 0);
});

// ===== write 工具 =====

test('write: 新文件用 LF', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-eol-w-'));
  const f = path.join(dir, 'new.md');
  const tool = new WriteTool();
  const r = await tool.execute({ filePath: f, content: 'a' + CR + LF + 'b' });
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(countEol(fs.readFileSync(f, 'utf8')).crlf, 0);
});

test('write: 已有 CRLF 文件，内容跟随 CRLF', async () => {
  const f = tmpFile(['# t', '- a'].join(CR + LF) + CR + LF);
  const tool = new WriteTool();
  const r = await tool.execute({ filePath: f, content: 'x' + LF + 'y' });
  assert.strictEqual(r.success, true, r.error);
  const after = fs.readFileSync(f, 'utf8');
  assert.strictEqual(countEol(after).lf, 0);
  assert.strictEqual(countEol(after).crlf, 1);
});

test('write: 已有 LF 文件，内容跟随 LF', async () => {
  const f = tmpFile(['# t', '- a'].join(LF) + LF);
  const tool = new WriteTool();
  const r = await tool.execute({ filePath: f, content: 'x' + CR + LF + 'y' });
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(countEol(fs.readFileSync(f, 'utf8')).crlf, 0);
});

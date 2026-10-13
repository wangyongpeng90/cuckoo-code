'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { DANGEROUS_CMDS, isDangerous, splitShellSegments } from '../../src/infra/dangerous-commands.js';

test('DANGEROUS_CMDS 非空数组', () => {
  assert.ok(Array.isArray(DANGEROUS_CMDS));
  assert.ok(DANGEROUS_CMDS.length >= 9);
  assert.ok(DANGEROUS_CMDS.every(p => p instanceof RegExp));
});

test('isDangerous 识别危险命令', () => {
  const dangerous = [
    'rm -rf /',
    'format C:',
    'del /f file',
    'rd /s dir',
    'rmdir /s /q C:\\test',
    'shutdown /s',
    'taskkill /im app.exe',
    'diskpart',
    'reg delete HKLM',
    'cipher /w C:',
    'Stop-Computer',
    'Restart-Computer',
    'Clear-Disk',
    'vssadmin delete shadows',
  ];
  for (const cmd of dangerous) {
    assert.strictEqual(isDangerous(cmd), true, cmd);
  }
});

test('isDangerous 识别安全命令', () => {
  assert.strictEqual(isDangerous('echo hello'), false);
  assert.strictEqual(isDangerous('dir'), false);
  assert.strictEqual(isDangerous('npm test'), false);
  assert.strictEqual(isDangerous('node main.js'), false);
  assert.strictEqual(isDangerous('git status && git log'), false);
});

test('isDangerous 忽略首尾空白', () => {
  assert.strictEqual(isDangerous('  shutdown /s  '), true);
});

// ===== 回归：复合命令绕过（P0 修复核心）=====
test('isDangerous 拦截 && 连接的复合命令', () => {
  assert.strictEqual(isDangerous('echo hi && rm -rf /'), true);
  assert.strictEqual(isDangerous('cd /tmp && format C:'), true);
  assert.strictEqual(isDangerous('echo ok && shutdown /s'), true);
});

test('isDangerous 拦截 || 连接的复合命令', () => {
  assert.strictEqual(isDangerous('true || rm -rf /'), true);
});

test('isDangerous 拦截 | 管道连接的复合命令', () => {
  assert.strictEqual(isDangerous('echo x | diskpart'), true);
});

test('isDangerous 拦截 ; 连接的复合命令', () => {
  assert.strictEqual(isDangerous('echo hi; taskkill /im a.exe'), true);
});

test('isDangerous 拦截换行连接的复合命令', () => {
  assert.strictEqual(isDangerous('echo hi\nshutdown /s'), true);
});

test('isDangerous 拦截 & 后台连接符', () => {
  assert.strictEqual(isDangerous('echo hi & format C:'), true);
});

test('isDangerous 不误伤含 && 的正常命令', () => {
  assert.strictEqual(isDangerous('npm install && npm test'), false);
  assert.strictEqual(isDangerous('git add . && git commit -m x'), false);
});

test('splitShellSegments 拆分复合命令', () => {
  assert.deepStrictEqual(splitShellSegments('a && b || c ; d | e & f'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepStrictEqual(splitShellSegments('echo hi\nls'), ['echo hi', 'ls']);
  assert.deepStrictEqual(splitShellSegments('  '), []);
});

// ===== 回归：rm 变体绕过（flag 顺序 / 长选项 / 尾斜杠 / 引号包裹）=====
test('isDangerous 拦截 rm flag 顺序颠倒', () => {
  assert.strictEqual(isDangerous('rm -fr /'), true);
  assert.strictEqual(isDangerous('rm -rf /'), true);
  assert.strictEqual(isDangerous('rm -r /'), true);
  assert.strictEqual(isDangerous('rm -f -r /'), true);
});

test('isDangerous 拦截 rm 分离长选项', () => {
  assert.strictEqual(isDangerous('rm --recursive --force /'), true);
  assert.strictEqual(isDangerous('rm --recursive /'), true);
});

test('isDangerous 拦截 rm 家目录（带/不带尾斜杠/通配）', () => {
  assert.strictEqual(isDangerous('rm -rf ~'), true);
  assert.strictEqual(isDangerous('rm -rf ~/'), true);
  assert.strictEqual(isDangerous('rm -rf ~/*'), true);
  assert.strictEqual(isDangerous('rm -fr ~'), true);
});

test('isDangerous 拦截 rm 顶层通配', () => {
  assert.strictEqual(isDangerous('rm -rf /*'), true);
});

test('isDangerous 拦截引号包裹的 rm 段', () => {
  assert.strictEqual(isDangerous('echo hi && "rm -rf /"'), true);
  assert.strictEqual(isDangerous("echo hi && 'rm -rf /'"), true);
});

test('isDangerous 不误伤普通 rm 用法', () => {
  assert.strictEqual(isDangerous('rm -rf node_modules'), false);
  assert.strictEqual(isDangerous('rm -rf ./dist'), false);
  assert.strictEqual(isDangerous('rm -rf /tmp/build-cache'), false);
  assert.strictEqual(isDangerous('rm file.txt'), false);
  assert.strictEqual(isDangerous('rm -f file.txt'), false);
  // 无递归标志的 rm 删不了目录，不算"灾难级"
  assert.strictEqual(isDangerous('rm --force /'), false);
});

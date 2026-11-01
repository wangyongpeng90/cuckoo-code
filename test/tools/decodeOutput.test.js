'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import { decodeOutput, normalizeCommand, injectEncodingToBody, stripBom } from '../../src/infra/decode-output.js';

test('decodeOutput 空/无输入返回空串', () => {
  assert.strictEqual(decodeOutput(null), '');
  assert.strictEqual(decodeOutput(undefined), '');
  assert.strictEqual(decodeOutput(Buffer.alloc(0)), '');
});

test('decodeOutput UTF-8 正常解码', () => {
  const buf = Buffer.from('hello 中文', 'utf8');
  assert.strictEqual(decodeOutput(buf), 'hello 中文');
});

test('decodeOutput GBK 回退', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const out = decodeOutput(gbk);
  assert.ok(out.length > 0);
  assert.ok(!out.includes('\uFFFD') || out === '你好');
});

test('decodeOutput 非法 UTF-8 无法 GBK 时返回字符串', () => {
  const bad = Buffer.from([0xff, 0xfe, 0xfd]);
  const out = decodeOutput(bad);
  assert.strictEqual(typeof out, 'string');
});

test('normalizeCommand 非字符串原样返回', () => {
  assert.strictEqual(normalizeCommand(null), null);
  assert.strictEqual(normalizeCommand(undefined), undefined);
  assert.strictEqual(normalizeCommand(123), 123);
  assert.strictEqual(normalizeCommand(''), '');
});

test('normalizeCommand 非 powershell 不处理', () => {
  const cmd = 'Get-Content file.txt';
  assert.strictEqual(normalizeCommand(cmd), cmd);
  const bash = 'bash -c "Get-Content x"';
  assert.strictEqual(normalizeCommand(bash), bash);
});

test('normalizeCommand powershell 含 Get-Content 注入 UTF8', () => {
  const cmd = 'powershell -NoProfile -Command Get-Content file.txt';
  assert.strictEqual(normalizeCommand(cmd), 'powershell -NoProfile -Command Get-Content -Encoding UTF8 file.txt');
});

test('normalizeCommand pwsh 含 Get-Content 注入 UTF8', () => {
  const cmd = 'pwsh Get-Content file.txt';
  assert.strictEqual(normalizeCommand(cmd), 'pwsh Get-Content -Encoding UTF8 file.txt');
});

test('normalizeCommand 已有 -Encoding 不动', () => {
  const cmd = 'powershell Get-Content -Encoding UTF8 file.txt';
  assert.strictEqual(normalizeCommand(cmd), cmd);
});

test('normalizeCommand 无编码敏感 cmdlet 不动', () => {
  const cmd = 'powershell Get-ChildItem';
  assert.strictEqual(normalizeCommand(cmd), cmd);
});

test('normalizeCommand 给写操作注入 UTF8', () => {
  assert.strictEqual(
    normalizeCommand('powershell Set-Content -Path a.txt -Value x'),
    'powershell Set-Content -Encoding UTF8 -Path a.txt -Value x'
  );
  assert.strictEqual(
    normalizeCommand('powershell Out-File -FilePath a.txt'),
    'powershell Out-File -Encoding UTF8 -FilePath a.txt'
  );
  assert.strictEqual(
    normalizeCommand('powershell Add-Content -Path a.txt -Value x'),
    'powershell Add-Content -Encoding UTF8 -Path a.txt -Value x'
  );
});

test('injectEncodingToBody 命令体：Get-Content 注入', () => {
  assert.strictEqual(injectEncodingToBody('Get-Content a.txt'), 'Get-Content -Encoding UTF8 a.txt');
});

test('injectEncodingToBody 命令体：写操作注入', () => {
  assert.strictEqual(
    injectEncodingToBody('Set-Content -Path a.txt -Value x'),
    'Set-Content -Encoding UTF8 -Path a.txt -Value x'
  );
  assert.strictEqual(
    injectEncodingToBody('"x" | Out-File -FilePath a.txt'),
    '"x" | Out-File -Encoding UTF8 -FilePath a.txt'
  );
});

test('injectEncodingToBody 命令体：已带 -Encoding 整体不动', () => {
  const body = 'Get-Content -Encoding UTF8 a.txt; Set-Content -Path b.txt -Value y';
  assert.strictEqual(injectEncodingToBody(body), body);
});

test('injectEncodingToBody 命令体：多个 cmdlet 都注入', () => {
  assert.strictEqual(
    injectEncodingToBody('Get-Content a.txt; Set-Content -Path b.txt -Value y'),
    'Get-Content -Encoding UTF8 a.txt; Set-Content -Encoding UTF8 -Path b.txt -Value y'
  );
});

test('injectEncodingToBody 命令体：无敏感 cmdlet 不动', () => {
  const body = 'Get-ChildItem';
  assert.strictEqual(injectEncodingToBody(body), body);
});

test('injectEncodingToBody 命令体：不误伤含 cmdlet 名的变量/路径', () => {
  // Get-ContentRaw 不是 cmdlet，不应被注入
  const body = '$x = "Get-ContentRaw"; Write-Output $x';
  assert.strictEqual(injectEncodingToBody(body), body);
});

test('stripBom 去掉开头 BOM', () => {
  assert.strictEqual(stripBom('\uFEFFabc'), 'abc');
  assert.strictEqual(stripBom('\uFEFF'), '');
});

test('stripBom 无 BOM 原样返回', () => {
  assert.strictEqual(stripBom('abc'), 'abc');
  assert.strictEqual(stripBom(''), '');
});

test('stripBom 只去开头，不动中间', () => {
  assert.strictEqual(stripBom('a\uFEFFb'), 'a\uFEFFb');
});

test('stripBom 非字符串原样返回', () => {
  assert.strictEqual(stripBom(null), null);
  assert.strictEqual(stripBom(undefined), undefined);
});


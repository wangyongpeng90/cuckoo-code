'use strict';
// Task 3 编译期/静态契约测试：api.ts 暴露的 electronAPI 方法集合
// 必须与 api-types.ts 中 ElectronAPI 接口声明的方法集合一致。
// 接口无法在运行时反射，故从源码文本提取方法名对比；
// 运行时对象 key 则通过真实 import api.js（Node 环境下 contextBridge 兜底失败，
// 走 window 兜底赋值路径）取得。
import { test, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiSrc = fs.readFileSync(path.join(repoRoot, 'src/bridge/api.ts'), 'utf-8');
const typesSrc = fs.readFileSync(path.join(repoRoot, 'src/bridge/api-types.ts'), 'utf-8');

// api.ts 实现对象字面量中的方法定义：两空格缩进的 `name: (...) => {`
function implMethodNames(src) {
  const names = [];
  const re = /^ {2}(\w+): \(/gm;
  let m;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names.sort();
}

// api-types.ts 接口中的方法签名：两空格缩进的 `name(...): Promise<...>;`
function declaredMethodNames(src) {
  const names = [];
  const re = /^ {2}(\w+)\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names.sort();
}

test('api.ts 实现的方法集合与 api-types.ts 接口声明一致', () => {
  const impl = implMethodNames(apiSrc);
  const declared = declaredMethodNames(typesSrc);
  assert.deepStrictEqual(declared, impl,
    'ElectronAPI 接口声明与 api.ts 实现不一致：缺失=' +
    impl.filter((n) => !declared.includes(n)).join(',') +
    ' 多余=' + declared.filter((n) => !impl.includes(n)).join(','));
});

test('运行时暴露的 window.electronAPI 方法与接口声明一致', async () => {
  // Node 环境下 require('electron') 返回二进制路径字符串，
  // contextBridge 为 undefined → exposeInMainWorld 抛错被 catch → 走 window 兜底
  vi.spyOn(console, 'error').mockImplementation(() => {});
  globalThis.window = {};
  await import('../../src/bridge/api.js');
  const api = globalThis.window.electronAPI;
  assert.ok(api, 'api.js 应把 electronAPI 挂载到 window');
  const runtimeKeys = Object.keys(api).sort();
  assert.deepStrictEqual(runtimeKeys, declaredMethodNames(typesSrc));
  // 每个方法都是函数
  for (const k of runtimeKeys) {
    assert.strictEqual(typeof api[k], 'function', k + ' 应为函数');
  }
});

test('接口声明恰好 36 个方法（防漏防多）', () => {
  assert.strictEqual(declaredMethodNames(typesSrc).length, 36);
});

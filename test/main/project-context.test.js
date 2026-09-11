'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronMock } = require('../helpers/mock-electron');
installElectronMock();
// 相关导出已从 src/main/project-context.js 移除（提交 a8a59df），以下测试暂时注释
// const { getDirectoryTree, IGNORED_DIRS } = require('../../src/main/project-context');

const tmpRoot = path.join(process.cwd(), 'test', 'tmp', 'tree');

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'README.md'), '');
  fs.writeFileSync(path.join(tmpRoot, 'src', 'a.js'), '');
  fs.writeFileSync(path.join(tmpRoot, 'node_modules', 'x.js'), '');
  fs.writeFileSync(path.join(tmpRoot, '.git', 'HEAD'), '');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// test('getDirectoryTree 生成树', () => {
//   const tree = getDirectoryTree(tmpRoot);
//   assert.ok(tree.includes('src/'));
//   assert.ok(tree.includes('a.js'));
//   assert.ok(tree.includes('README.md'));
//   assert.ok(!tree.includes('node_modules'));
//   assert.ok(!tree.includes('.git'));
// });
//
// test('getDirectoryTree 目录不存在返回错误提示', () => {
//   const tree = getDirectoryTree(path.join(tmpRoot, 'missing'));
//   assert.match(tree, /无法读取目录/);
// });
//
// test('IGNORED_DIRS 包含关键目录', () => {
//   for (const d of ['node_modules', '.git', 'dist', 'build']) {
//     assert.ok(IGNORED_DIRS.has(d));
//   }
// });

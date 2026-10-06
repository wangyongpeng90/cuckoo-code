'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-snap-home-'));
process.env.CUCKOO_HOME = HOME;

const { createSnapshot, listSnapshots, getSnapshot, restoreSnapshot, deleteSnapshot, collectFiles, isExcludedFile } = await import('../../src/app/snapshots.js');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-proj-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'AAA');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'BBB');
  // 应被排除
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'XX');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref');
  return dir;
}

test('collectFiles 排除 node_modules/.git', () => {
  const dir = makeProject();
  const files = collectFiles(dir).map((f) => path.relative(dir, f).replace(/\\/g, '/')).sort();
  assert.deepStrictEqual(files, ['a.txt', 'sub/b.txt']);
});

test('collectFiles 排除敏感文件（.env/私钥/凭据）', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=2');
  fs.writeFileSync(path.join(dir, 'id_rsa'), 'PRIVATE KEY');
  fs.writeFileSync(path.join(dir, 'server.pem'), 'CERT');
  fs.writeFileSync(path.join(dir, 'credentials.json'), '{}');
  fs.writeFileSync(path.join(dir, '.npmrc'), 'token=x');
  fs.writeFileSync(path.join(dir, 'normal.txt'), 'ok');
  const files = collectFiles(dir).map((f) => path.basename(f)).sort();
  assert.deepStrictEqual(files, ['a.txt', 'b.txt', 'normal.txt']);
});

test('isExcludedFile 判定敏感文件', () => {
  assert.strictEqual(isExcludedFile('.env'), true);
  assert.strictEqual(isExcludedFile('.env.production'), true);
  assert.strictEqual(isExcludedFile('id_rsa'), true);
  assert.strictEqual(isExcludedFile('foo.pem'), true);
  assert.strictEqual(isExcludedFile('credentials.json'), true);
  assert.strictEqual(isExcludedFile('normal.txt'), false);
  assert.strictEqual(isExcludedFile('index.js'), false);
});

test('createSnapshot 复制文件并写 meta', () => {
  const dir = makeProject();
  const meta = createSnapshot(dir, '测试快照', '说明');
  assert.ok(meta.id && meta.fileCount === 2);
  const got = getSnapshot(meta.id);
  assert.ok(got && got.name === '测试快照' && got.description === '说明');
});

test('createSnapshot 名为空抛错', () => {
  const dir = makeProject();
  assert.throws(() => createSnapshot(dir, '  '), /快照名不能为空/);
});

test('createSnapshot 目录不存在抛错', () => {
  assert.throws(() => createSnapshot('D:/不存在目录xyz', 'x'), /不存在/);
});

test('listSnapshots 按时间倒序', () => {
  const dir = makeProject();
  createSnapshot(dir, 'A');
  const b = createSnapshot(dir, 'B');
  const list = listSnapshots();
  assert.ok(list.length >= 2);
  assert.strictEqual(list[0].id, b.id);
});

test('restoreSnapshot 还原被修改的文件', () => {
  const dir = makeProject();
  const meta = createSnapshot(dir, '改前');
  // 改坏
  fs.writeFileSync(path.join(dir, 'a.txt'), 'BROKEN');
  fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'BROKEN2');
  const r = restoreSnapshot(meta.id);
  assert.strictEqual(r.restored, 2);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf-8'), 'AAA');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'sub', 'b.txt'), 'utf-8'), 'BBB');
});

test('deleteSnapshot 删除', () => {
  const dir = makeProject();
  const meta = createSnapshot(dir, 'x');
  assert.strictEqual(deleteSnapshot(meta.id), true);
  assert.strictEqual(getSnapshot(meta.id), null);
  assert.strictEqual(deleteSnapshot('不存在'), false);
});

'use strict';
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-guard-'));
process.env.CUCKOO_HOME = TMP;

const { isProtectedPath } = await import('../../src/infra/protected-paths.js');

test('快照目录受保护', () => {
  const p = path.join(TMP, 'snapshots', 'snap-1', 'files', 'a.txt');
  assert.ok(isProtectedPath(p));
});
test('快照根目录受保护', () => {
  assert.ok(isProtectedPath(path.join(TMP, 'snapshots')));
});
test('memories.json 受保护', () => {
  assert.ok(isProtectedPath(path.join(TMP, 'memories.json')));
});
test('普通项目文件不受保护', () => {
  assert.strictEqual(isProtectedPath(path.join(TMP, 'project', 'a.txt')), null);
});
test('snippets.json 不受保护', () => {
  assert.strictEqual(isProtectedPath(path.join(TMP, 'snippets.json')), null);
});
test('相似前缀不误判（snapshots-other）', () => {
  assert.strictEqual(isProtectedPath(path.join(TMP, 'snapshots-other', 'a.txt')), null);
});

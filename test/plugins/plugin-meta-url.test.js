/**
 * 插件入口的 import.meta.url 兼容（261125-bmsfsh 阶段 3）
 *
 * 背景：DSH 插件用 `fileURLToPath(import.meta.url)` / `createRequire(import.meta.url)`
 * 定位自身目录和资源文件（dsh-purge 有 14 处）。esbuild 打成 cjs 后 import.meta 是空的，
 * 于是抛 `The "path" argument must be of type string ... Received undefined`，插件整只加载失败。
 *
 * 修法：bundle 时把 import.meta.url define 成入口文件的真实 file:// URL。
 * 本测试锁住这个行为，防止回归。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';

/** 造一个用 import.meta.url 定位自身的插件 */
function makeMetaPlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-meta-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'meta-tool', version: '1.0.0', main: 'index.js' }), 'utf-8');
  // 插件自身的一个资源文件，靠 import.meta.url 拼路径来找
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'FOUND-BY-META-URL', 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "import { fileURLToPath } from 'node:url';",
    "import { createRequire } from 'node:module';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "export const name = 'meta-tool';",
    "export function apply(ctx) {",
    "  // ① fileURLToPath(import.meta.url) 不能抛",
    "  const here = path.dirname(fileURLToPath(import.meta.url));",
    "  // ② createRequire(import.meta.url) 可用",
    "  const req = createRequire(import.meta.url);",
    "  req('node:path');",
    "  // ③ new URL(rel, import.meta.url) 能读到同目录资源",
    "  const marker = fs.readFileSync(new URL('./marker.txt', import.meta.url), 'utf-8');",
    "  ctx.__probe = { here, marker };",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('import.meta.url：插件能用它定位自身目录和资源', async () => {
  const dir = makeMetaPlugin();
  try {
    // 不抛错即说明 fileURLToPath(import.meta.url) / createRequire 都正常
    const r = await loadCuckooPlugin(dir);
    assert.strictEqual(r.pluginName, 'meta-tool');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

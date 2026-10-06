#!/usr/bin/env node
/**
 * 插件脚手架：从模板生成一个插件目录
 *
 * 用法：
 *   node scripts/create-plugin.mjs <插件id> [目标目录]
 *
 * 例：
 *   node scripts/create-plugin.mjs my-plugin
 *   → 生成 ./my-plugin/（含 plugin.json + dsh/ + ui/ + README）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPL_DIR = path.join(ROOT, 'templates', 'plugin-dev');

const args = process.argv.slice(2);
const id = args[0];
const outDir = args[1] || path.join(process.cwd(), id || '');

if (!id) {
  console.error('用法: node scripts/create-plugin.mjs <插件id> [目标目录]');
  process.exit(1);
}

// 校验 id（小写 kebab-case）
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
  console.error('插件 id 非法：须为小写 kebab-case（字母/数字开头，仅 a-z 0-9 和 -，≤64）');
  process.exit(1);
}

if (fs.existsSync(outDir)) {
  console.error('目标目录已存在: ' + outDir);
  process.exit(1);
}

/** 递归复制目录 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(TPL_DIR, outDir);

// 改写 plugin.json 的 id
const manifestPath = path.join(outDir, 'plugin.json');
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  m.id = id;
  m.name = id;
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf-8');
}

console.log('✅ 插件已生成: ' + outDir);
console.log('');
console.log('下一步：');
console.log('  1. 编辑 plugin.json（name/description/author）');
console.log('  2. 编辑 dsh/example.js 或 ui/example.js（实现你的插件）');
console.log('  3. 测试：复制到 ~/.cuckoo/plugins/' + id + '/ 并在 Cuckoo 里启用');
console.log('  4. 分享：推到 GitHub，打 cuckoo-plugin topic');

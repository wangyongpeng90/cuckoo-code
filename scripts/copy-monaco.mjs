/**
 * 把 monaco-editor 的 min/vs 复制到 src/ui/vendor/monaco/vs
 * （Monaco 体积大，不进 git；由本脚本在 install / 启动 / 编译时补上）
 *
 * 注意：不用 fs.cpSync —— 它在 Windows + Node 24 下复制海量小文件会静默失败/爆栈
 * （实测目标目录为空但退出码 0）。改为显式递归遍历逐个复制，并对每个文件兜错。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname ? path.join(import.meta.dirname, '..') : process.cwd();
const src = path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = path.join(root, 'src', 'ui', 'vendor', 'monaco', 'vs');

if (!fs.existsSync(src)) {
  console.warn('[copy-monaco] 未找到 node_modules/monaco-editor/min/vs，跳过（请先 npm install）');
  process.exit(0);
}

/** 递归复制目录（逐文件，避免 cpSync 的深递归问题） */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
    // 符号链接等其它类型忽略
  }
}

try {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyDir(src, dest);
  // 校验：loader.js 必须存在，否则视为失败（不再"假成功"）
  const marker = path.join(dest, 'loader.js');
  if (!fs.existsSync(marker)) {
    console.error('[copy-monaco] 复制后未找到 loader.js，视为失败:', marker);
    process.exit(1);
  }
  console.log('[copy-monaco] 已复制 monaco → src/ui/vendor/monaco/vs');
} catch (err) {
  console.error('[copy-monaco] 复制失败:', err && err.message ? err.message : err);
  process.exit(1);
}

/**
 * 跨平台启动脚本
 * 1) 编译 TS → out/
 * 2) 启动 Electron（读取 package.json main = out/src/main/index.js）
 * 3) 捕获 stdout/stderr 写入日志文件
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';

// ========== 1. 编译 ==========
console.log('[start.js] 编译中（tsc -p tsconfig.build.json）...');
const build = spawnSync('npx', ['tsc', '-p', 'tsconfig.build.json'], {
  shell: true,
  stdio: 'inherit',
  cwd: import.meta.dirname,
});
if (build.status !== 0) {
  console.error('[start.js] 编译失败，退出。');
  process.exit(build.status ?? 1);
}
console.log('[start.js] 编译完成，启动 Electron...');

// ========== 2. 日志目录 ==========
const logDir = path.join(import.meta.dirname, 'wyp', 'log');
fs.mkdirSync(logDir, { recursive: true });

// 清空旧日志
try {
  for (const f of fs.readdirSync(logDir)) {
    if (f.endsWith('.log')) fs.writeFileSync(path.join(logDir, f), '', 'utf-8');
  }
} catch (err) {
  console.warn('[start.js] 清空日志失败:', err.message);
}

const logFile = path.join(logDir, 'electron.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// ========== 3. 启动 Electron ==========
// 防御：若会话环境残留 ELECTRON_RUN_AS_NODE=1，`electron .` 会以纯 Node 模式加载
// 主入口，导致 require('electron') 拿不到 app（app undefined）。启动 GUI 时必须清除。
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const cmd = isWin ? 'chcp 65001 > nul && electron .' : 'electron .';
const child = spawn(cmd, { shell: true, env: childEnv, stdio: ['inherit', 'pipe', 'pipe'] });

child.stdout.pipe(logStream);
child.stderr.pipe(logStream);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on('close', (code) => {
  logStream.end();
  process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});

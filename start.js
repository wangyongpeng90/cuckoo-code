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
// 远程调试端口（供 Playwright/CDP 连接，仅开发用）。
// 默认 9334；设 CUCKOO_DEBUG_PORT=off（或 0）可关闭。
const envPort = process.env.CUCKOO_DEBUG_PORT;
// 优先复用上次端口（debug-port.txt）——保证端口稳定，MCP 配置不用改
let preferredPort = '9334';
try {
  const lastPort = fs.readFileSync(path.join(import.meta.dirname, '.cuckoo', 'debug-port.txt'), 'utf-8').trim();
  if (/^\d+$/.test(lastPort)) preferredPort = lastPort;
} catch (_) {}
let debugPort = (envPort === 'off' || envPort === '0') ? '' : (envPort || preferredPort);

// 启动前：检测端口是否被僵尸进程占用，是则清理（防"CLOSE_WAIT 僵占"）
function isPortBusy(port) {
  if (!port || !isWin) return false;
  try {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf-8', windowsHide: true }).stdout || '';
    return out.split(/\r?\n/).some((l) => l.includes(':' + port) && /LISTENING|CLOSE_WAIT|TIME_WAIT/.test(l));
  } catch (_) { return false; }
}
function killPortZombies(port) {
  if (!port || !isWin) return;
  try {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf-8', windowsHide: true }).stdout || '';
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(':' + port)) {
        const m = line.trim().match(/\s+(\d+)$/);
        if (m) pids.add(m[1]);
      }
    }
    for (const pid of pids) {
      // 检查进程是否存在（tasklist）
      const t = spawnSync('tasklist', ['/FI', 'PID eq ' + pid, '/NH'], { encoding: 'utf-8', windowsHide: true }).stdout || '';
      if (t.includes('electron') || t.includes('node')) {
        console.log('[start.js] 清理占用 ' + port + ' 的进程 PID ' + pid + '...');
        spawnSync('taskkill', ['/F', '/PID', pid], { windowsHide: true });
      } else {
        // 进程已死但 socket 僵占 → 无 PID 可杀，只能等 Windows 回收（一般 < 2 分钟）
        console.log('[start.js] 端口 ' + port + ' 被已死进程 ' + pid + ' 僵占（等待系统回收）');
      }
    }
  } catch (err) {
    console.warn('[start.js] 端口清理失败:', err && err.message);
  }
}

// 如果端口忙 → 先清理僵尸；清理后仍忙 → 换一个随机端口（并写到文件供 MCP 读）
if (debugPort && isPortBusy(debugPort)) {
  console.log('[start.js] 端口 ' + debugPort + ' 被占用，尝试清理...');
  killPortZombies(debugPort);
  // 等 500ms 让 socket 释放
  try { spawnSync('cmd', ['/c', 'timeout', '/t', '1', '/nobreak'], { windowsHide: true }); } catch (_) {}
  if (isPortBusy(debugPort)) {
    // 换一个端口（9334 附近随机）
    const fallback = String(9334 + Math.floor(Math.random() * 100) + 1);
    console.log('[start.js] 端口 ' + debugPort + ' 仍被占，改用 ' + fallback);
    debugPort = fallback;
  }
}

const debugArg = debugPort ? ' --remote-debugging-port=' + debugPort : '';
if (debugPort) {
  console.log('[start.js] 开启远程调试端口: ' + debugPort + '（CDP；CUCKOO_DEBUG_PORT=off 可关）');
  // 把端口写到固定文件（供 MCP 动态读）
  try {
    fs.writeFileSync(
      path.join(import.meta.dirname, '.cuckoo', 'debug-port.txt'),
      String(debugPort),
      'utf-8',
    );
  } catch (_) {}
  // 自动更新 .cuckoo/mcp.json 的 playwright-cuckoo 端口（免得手动改）
  try {
    const mcpPath = path.join(import.meta.dirname, '.cuckoo', 'mcp.json');
    const raw = fs.readFileSync(mcpPath, 'utf-8');
    let cfg;
    try { cfg = JSON.parse(raw); } catch (_) { cfg = null; }
    if (cfg && cfg.mcpServers && cfg.mcpServers['playwright-cuckoo']) {
      const args = cfg.mcpServers['playwright-cuckoo'].args || [];
      const idx = args.indexOf('--cdp-endpoint');
      if (idx >= 0 && args[idx + 1] !== undefined) {
        args[idx + 1] = 'http://127.0.0.1:' + debugPort;
        fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
        console.log('[start.js] 已更新 .cuckoo/mcp.json 的 playwright-cuckoo 端口为 ' + debugPort);
      }
    }
  } catch (_) {}
}
// 开关必须在应用路径（.）之前，否则会被当成应用参数
const cmd = isWin ? ('chcp 65001 > nul && electron' + debugArg + ' .') : ('electron' + debugArg + ' .');

// 某些 Electron 系 IDE 的终端（VS Code / JetBrains 等）会带 ELECTRON_RUN_AS_NODE=1，
// 子进程继承后 electron.exe 会以「纯 Node 模式」启动，直接报
//   electron.exe: bad option: --remote-debugging-port=...
// 然后退出 —— 表现为 npm start 跑到一半就没了，窗口不出现。启动前显式剔除。
const childEnv = { ...process.env };
if (childEnv.ELECTRON_RUN_AS_NODE) {
  console.log('[start.js] ⚠️ 检测到 ELECTRON_RUN_AS_NODE=' + childEnv.ELECTRON_RUN_AS_NODE + '，已为 Electron 剔除（否则会以 Node 模式启动而闪退）');
  delete childEnv.ELECTRON_RUN_AS_NODE;
}

const child = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], env: childEnv });

child.stdout.pipe(logStream);
child.stderr.pipe(logStream);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on('close', (code) => {
  logStream.end();
  if (code) console.error('[start.js] Electron 退出码 ' + code + '（完整输出见 wyp/log/electron.log）');
  process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});

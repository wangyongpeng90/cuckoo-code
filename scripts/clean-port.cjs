/**
 * 清理 Cuckoo 调试端口（9334）的僵尸占用
 *
 * 用法：node scripts/clean-port.cjs [port]
 * 默认 9334；找到占用 PID → 若是 electron 就杀，若是已死进程就提示等待。
 */
const { spawnSync } = require('node:child_process');
const port = process.argv[2] || '9334';
function run(cmd, args) { try { return spawnSync(cmd, args, { encoding: 'utf-8', windowsHide: true }).stdout || ''; } catch (_) { return ''; } }
const netstatOut = run('netstat', ['-ano']);
const pids = new Set();
for (const line of netstatOut.split(/\r?\n/)) {
  if (line.includes(':' + port)) { const m = line.trim().match(/\s+(\d+)$/); if (m) pids.add(m[1]); }
}
if (!pids.size) { console.log('端口 ' + port + ' 空闲'); process.exit(0); }
console.log('端口 ' + port + ' 被占用，PID: ' + [...pids].join(', '));
let killed = 0;
for (const pid of pids) {
  const t = run('tasklist', ['/FI', 'PID eq ' + pid, '/NH']);
  if (t.includes('electron') || t.includes('node') || t.includes('DeepSeek')) {
    console.log('  杀进程 ' + pid + '...');
    run('taskkill', ['/F', '/PID', pid]);
    killed++;
  } else {
    console.log('  PID ' + pid + ' 已死（僵占 socket），等 Windows 回收（< 2 分钟）');
  }
}
console.log(killed ? '已清理 ' + killed + ' 个进程' : '无可清理的进程（僵占需等待）');
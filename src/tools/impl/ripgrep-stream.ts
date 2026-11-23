/**
 * 流式执行 ripgrep，边读边解析，不在内存里累积整段输出。
 *
 * 为什么需要：旧实现是 `stdout += chunk` 无限拼接，碰到宽泛 pattern（如 "."）
 * 时 rg --json 输出可达数百 MB，一旦超过 V8 的 MAX_STRING_LENGTH（约 512MB）
 * 主进程直接抛 `RangeError: Invalid string length` 崩溃；且 `+=` 是 O(n)
 * 复制，总开销 O(n²)，几百 MB 会拖到几十秒以上。
 *
 * 改成流式后内存只与「保留条数」相关，与仓库规模无关。
 */
import path from 'node:path';
import { spawn } from 'node:child_process';

// @vscode/ripgrep 是 ES Module，CommonJS 里不能用 require() 同步加载；
// 改为惰性动态 import()，只在首次执行 ripgrep 时解析一次。
let rgPathPromise: Promise<string> | null = null;

function getRgPath(): Promise<string> {
  if (!rgPathPromise) {
    rgPathPromise = import('@vscode/ripgrep').then(m => {
      // 打包后 @vscode/ripgrep 返回的路径在 app.asar 内，Windows 无法 spawn；
      // 通过 asarUnpack 解包到 app.asar.unpacked，这里做路径替换。
      let p = m.rgPath;
      if (p && p.includes('app.asar' + path.sep)) {
        p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      }
      return p;
    });
  }
  return rgPathPromise;
}

/** stderr 只用于报错，留一点就够，避免宽泛搜索时同样撑爆内存 */
const MAX_STDERR_BYTES = 64 * 1024;

export interface StreamRipgrepOptions {
  /** ripgrep argv（不含可执行文件本身） */
  args: string[];
  /** 子进程工作目录 */
  cwd: string;
  /** 每读到一行调用一次；返回 false 表示「够了，停止读取」 */
  onLine: (line: string) => boolean | void;
  /** 字节兜底：读了这么多还没达够数，也停（防止非匹配行极多的场景） */
  maxBytes?: number;
}

export interface StreamRipgrepResult {
  /** 实际处理的行数（可能因为提前停止而少于真实总数） */
  linesRead: number;
  /** 实际读取的字节数 */
  bytesRead: number;
  /** 是否因为达到上限而主动终止了 rg */
  stopped: boolean;
  /** ripgrep 退出码；被主动 kill 时为 null */
  code: number | null;
  /** 截断后的 stderr（仅出错时有意义） */
  stderr: string;
}

/**
 * 逐行消费 ripgrep 的 stdout。
 *
 * 关键点：
 * - 只保留「半个行」（chunk 边界可能把一行 JSON 切断），不保留历史输出
 * - onLine 返回 false 立即 kill 子进程，不再等待剩余输出
 * - 结束时把残留的 tail 再喂一次，避免末行丢失
 */
function streamRipgrep(opts: StreamRipgrepOptions): Promise<StreamRipgrepResult> {
  return getRgPath().then(rgPath => new Promise<StreamRipgrepResult>((resolve, reject) => {
    const child = spawn(rgPath, ['--no-config', ...opts.args], {
      cwd: opts.cwd,
      windowsHide: true,
      // stdin 必须忽略：无显式 path 参数时，rg 若发现 stdin 是管道（非 TTY）
      // 会改为从 stdin 读取搜索目标，导致无限等待、搜索卡死。
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let tail = '';
    let linesRead = 0;
    let bytesRead = 0;
    let stderr = '';
    let stopped = false;
    let settled = false;

    const maxBytes = typeof opts.maxBytes === 'number' && opts.maxBytes > 0 ? opts.maxBytes : Infinity;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { child.kill(); } catch { /* 进程可能已退出 */ }
    };

    /** 消费一批完整行；返回 false 表示要停 */
    const consume = (lines: string[]): boolean => {
      for (const line of lines) {
        if (!line) continue;
        linesRead++;
        if (opts.onLine(line) === false) return false;
      }
      return true;
    };

    child.stdout.on('data', (d: Buffer) => {
      if (stopped) return;
      bytesRead += d.length;

      const text = d.toString('utf8');
      const parts = (tail + text).split('\n');
      tail = parts.pop() ?? '';

      if (!consume(parts)) { stop(); return; }
      if (bytesRead > maxBytes) stop();
    });

    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += d;
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      // 末行可能没有换行符结尾：补喂一次
      if (!stopped && tail) {
        linesRead++;
        try { opts.onLine(tail); } catch { /* 交给上层 */ }
        tail = '';
      }
      resolve({ linesRead, bytesRead, stopped, code, stderr });
    });
  }));
}

export { streamRipgrep, getRgPath, MAX_STDERR_BYTES };

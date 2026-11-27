/**
 * pnpm 调用封装（纯 node + 子进程）
 *
 * pnpm 是纯 JS（resources/runtime/pnpm/bin/pnpm.cjs），用自带 node 跑：
 *   <appRoot>/resources/runtime/<platform>/bin/node <appRoot>/resources/runtime/pnpm/bin/pnpm.cjs <args>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveResourceRoot } from '../app-root.js';

/** 找自带的 node 运行时（resources/runtime/<platform>/bin/） */
function bundledNode(): { cmd: string; binDir: string } | null {
  const platform = process.platform === 'win32'
    ? 'win-x64'
    : (process.platform === 'darwin'
      ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
      : null);
  if (!platform) return null;
  // 打包版走 process.resourcesPath，开发版回退源码推算（见 app-root.ts）
  const binDir = path.join(resolveResourceRoot(), 'runtime', platform, 'bin');
  const cmd = path.join(binDir, process.platform === 'win32' ? 'node.exe' : 'node');
  if (fs.existsSync(cmd)) return { cmd, binDir };
  return null;
}

/**
 * [261125-bmsfsh] 回退用的「系统 node」。
 *
 * 背景：自带的 node.exe 在某些 Windows 环境里写 ~/.cuckoo 会 EPERM
 * （同样路径用 PowerShell 或系统 node 都正常），pnpm 的 SQLite store
 * 因此打不开，安装直接失败。这时改用系统 node 跑同一个 pnpm.cjs。
 *
 * 只返回可执行文件名，交给 spawn + shell 解析 PATH；找不到就返回 null。
 */
function systemNode(): { cmd: string; binDir: string } | null {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const pathEnv = process.env.PATH || process.env.Path || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        // 排除自带运行时自己（它就在 resources 下，不该被当回退目标）
        if (candidate.toLowerCase().includes('cuckoo-code')) continue;
        return { cmd: candidate, binDir: dir };
      }
    } catch { /* ignore */ }
  }
  return null;
}

/** 找自带的 pnpm（resources/runtime/pnpm/bin/pnpm.cjs） */
function bundledPnpm(): string | null {
  const cjs = path.join(resolveResourceRoot(), 'runtime', 'pnpm', 'bin', 'pnpm.cjs');
  return fs.existsSync(cjs) ? cjs : null;
}

/** 是否可用（node + pnpm 都在） */
export function isPnpmAvailable(): boolean {
  return !!(bundledNode() && bundledPnpm());
}

/** DSH 的 packageManager invocation 格式：{ command, args, env } */
export interface PnpmInvocation {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** 取 pnpm 的 invocation（供 DSH 插件的 profileContext.packageManager 用） */
export function getPnpmInvocation(): PnpmInvocation | null {
  const node = bundledNode();
  const pnpm = bundledPnpm();
  if (!node || !pnpm) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) { if (typeof v === 'string') env[k] = v; }
  env.PATH = node.binDir + (process.platform === 'win32' ? ';' : ':') + (env.PATH || '');
  if (process.platform === 'win32') env.Path = env.PATH;
  return { command: node.cmd, args: [pnpm], env };
}

export interface PnpmResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 跑 pnpm（同步等待完成）。
 * @param args pnpm 参数（如 ['add', 'dshmarket@latest', '--dir', profileDir]）
 * @param cwd 工作目录
 */
/**
 * 用指定 node 跑一次 pnpm。
 * @param node 用哪个 node 可执行文件
 * @param extraArgs 追加参数（回退时用 copy 导入方式绕开 symlink 权限）
 */
function spawnPnpm(
  node: { cmd: string; binDir: string },
  pnpm: string,
  args: string[],
  cwd: string,
  opts?: { onData?: (s: string) => void },
): Promise<PnpmResult> {
  return new Promise((resolve, reject) => {
    const env: any = Object.assign({}, process.env);
    env.PATH = node.binDir + (process.platform === 'win32' ? ';' : ':') + (env.PATH || '');
    if (process.platform === 'win32') env.Path = env.PATH;
    // 让 pnpm 把自己当成"用户装"的（避免 corepack 干扰）
    env.PNPM_HOME = path.dirname(node.binDir);

    // 不用 shell（node.exe 能直接 spawn；shell=true 会吞 stdout）
    const child = spawn(node.cmd, [pnpm, ...args], { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    const feed = (s: string) => { if (opts && opts.onData) { try { opts.onData(s); } catch (_) {} } };
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; feed(s); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; feed(s); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code == null ? -1 : code, stdout, stderr }));
  });
}

/** pnpm 的「打不开 store / 建不了库」类错误（换 node 或换导入方式能救） */
function isStorePermissionFailure(res: PnpmResult): boolean {
  const text = (res.stderr || '') + (res.stdout || '');
  return /ERR_SQLITE_ERROR|unable to open database file|EPERM|operation not permitted/i.test(text);
}

/** pnpm 的「符号链接建不了」类错误（Windows 未开开发者模式时常见） */
function isSymlinkFailure(res: PnpmResult): boolean {
  const text = (res.stderr || '') + (res.stdout || '');
  return /symlink .*EPERM|EPERM.*symlink/i.test(text);
}

/**
 * 跑 pnpm（同步等待完成）。
 *
 * [261125-bmsfsh] 带两级回退——安装失败不能只报原始错误，用户没法自救：
 *   ① 自带 node 失败（store 打不开）→ 换系统 node 重试
 *   ② 仍因符号链接权限失败 → 追加 `--config.package-import-method=copy` 再试
 *
 * @param args pnpm 参数（如 ['add', 'dshmarket@latest', '-w']）
 * @param cwd 工作目录
 */
export async function runPnpm(args: string[], cwd: string, opts?: { onData?: (s: string) => void }): Promise<PnpmResult> {
  const pnpm = bundledPnpm();
  if (!pnpm) throw new Error('未找到自带 pnpm（resources/runtime/pnpm/）');
  const bundled = bundledNode();
  if (!bundled) throw new Error('未找到自带 node 运行时');

  let res = await spawnPnpm(bundled, pnpm, args, cwd, opts);
  if (res.code === 0 || !isStorePermissionFailure(res)) return res;

  // ① 换系统 node 重试（store 打不开多半是自带 node 的写入权限问题）
  const fallbackNode = systemNode();
  if (fallbackNode) {
    const note = '[pnpm] 自带 node 失败（' + (res.stderr || res.stdout).split(/\r?\n/)[0].slice(0, 160) + '），改用系统 node 重试…';
    if (opts && opts.onData) { try { opts.onData(note + '\n'); } catch { /* ignore */ } }
    res = await spawnPnpm(fallbackNode, pnpm, args, cwd, opts);
    if (res.code === 0) return res;
  }

  // ② 符号链接权限问题 → 改用 copy 导入（不建 symlink）
  if (isSymlinkFailure(res)) {
    const note = '[pnpm] 符号链接被拒，改用 copy 导入重试…';
    if (opts && opts.onData) { try { opts.onData(note + '\n'); } catch { /* ignore */ } }
    const nodeToUse = fallbackNode || bundled;
    res = await spawnPnpm(nodeToUse, pnpm, [...args, '--config.package-import-method=copy'], cwd, opts);
  }
  return res;
}

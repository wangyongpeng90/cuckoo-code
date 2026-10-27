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
import { runtimePlatformDir } from '../../infra/runtime-platform.js';

/** 找自带的 node 运行时（resources/runtime/<platform>/bin/） */
function bundledNode(): { cmd: string; binDir: string } | null {
  const platform = runtimePlatformDir();
  if (!platform) return null;
  // 打包版走 process.resourcesPath，开发版回退源码推算（见 app-root.ts）
  const binDir = path.join(resolveResourceRoot(), 'runtime', platform, 'bin');
  const cmd = path.join(binDir, process.platform === 'win32' ? 'node.exe' : 'node');
  if (fs.existsSync(cmd)) return { cmd, binDir };
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
export function runPnpm(args: string[], cwd: string, opts?: { onData?: (s: string) => void }): Promise<PnpmResult> {
  return new Promise((resolve, reject) => {
    const node = bundledNode();
    const pnpm = bundledPnpm();
    if (!node) { reject(new Error('未找到自带 node 运行时')); return; }
    if (!pnpm) { reject(new Error('未找到自带 pnpm（resources/runtime/pnpm/）')); return; }

    const env: any = Object.assign({}, process.env);
    env.PATH = node.binDir + (process.platform === 'win32' ? ';' : ':') + (env.PATH || '');
    if (process.platform === 'win32') env.Path = env.PATH;
    // 让 pnpm 把自己当成"用户装"的（避免 corepack 干扰）
    env.PNPM_HOME = path.dirname(node.binDir);

    // 不用 shell（node.cmd 是 .exe，能直接 spawn；shell=true 会吞 stdout）
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

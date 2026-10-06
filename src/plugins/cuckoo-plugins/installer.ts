/**
 * Cuckoo 插件安装器：用自带 npm 下载 npm 包到 ~/.cuckoo/cuckoo-plugins/<id>/。
 * 纯 node + 子进程。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getCuckooPluginDir, isValidPluginId } from './paths.js';

/** 找自带的 npm.cmd（resources/runtime/<platform>/bin/） */
function bundledNpm(): { cmd: string; binDir: string } | null {
  // 与 src/mcp/client.ts 的运行时定位一致
  const platform = process.platform === 'win32'
    ? 'win-x64'
    : (process.platform === 'darwin'
      ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
      : null);
  if (!platform) return null;
  // resources/runtime 相对应用根（out/src/plugins/cuckoo-plugins → ../../../..）
  const appRoot = path.join(import.meta.dirname, '..', '..', '..', '..');
  const binDir = path.join(appRoot, 'resources', 'runtime', platform, 'bin');
  const cmd = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (fs.existsSync(cmd)) return { cmd, binDir };
  return null;
}

/** 从包名提取"插件 id"（@scope/name → scope-name） */
function packageNameToId(pkgName: string): string {
  return pkgName.replace(/^@/, '').replace(/\//g, '-').toLowerCase();
}

/**
 * 安装 npm 包到插件目录。
 * @param pkgName npm 包名（如 dsh-greet-tool 或 @scope/name）
 * @returns { id, dir }
 */
async function installCuckooPlugin(pkgName: string): Promise<{ id: string; dir: string }> {
  if (!pkgName || typeof pkgName !== 'string') throw new Error('包名不能为空');
  const id = packageNameToId(pkgName);
  if (!isValidPluginId(id)) throw new Error('包名转 id 非法: ' + id);
  const dir = getCuckooPluginDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const npm = bundledNpm();
  if (!npm) throw new Error('未找到自带 npm 运行时');
  // 写一个最小 package.json（npm install 需要）
  const pkgJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: id, version: '1.0.0', private: true }, null, 2), 'utf-8');
  }
  await runNpm(npm, ['install', pkgName, '--no-audit', '--no-fund', '--loglevel=error'], dir);
  return { id, dir };
}

function runNpm(npm: { cmd: string; binDir: string }, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env);
    env.PATH = npm.binDir + (process.platform === 'win32' ? ';' : ':') + (env.PATH || '');
    if (process.platform === 'win32') env.Path = env.PATH;
    const child = spawn(npm.cmd, args, { cwd, env, shell: process.platform === 'win32' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('npm install 失败（exit ' + code + '）: ' + stderr.slice(-500)));
    });
  });
}

export { installCuckooPlugin, bundledNpm, packageNameToId };

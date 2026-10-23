/**
 * 下载/准备 MCP 运行时二进制（uv + node）
 *
 * 背景：MCP server 常用 `uvx`（Python）或 `npx`（Node）启动，但用户机器
 * 不一定装了 uv/node。此脚本在构建/开发时下载对应平台的二进制到
 * resources/runtime/<platform>/bin/，打包后由 MCP spawn 时优先使用（不碰用户系统）。
 *
 * 幂等：已安装且版本一致时跳过。
 * 用法：node scripts/fetch-runtime.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'resources', 'runtime');
const TMP_DIR = path.join(RUNTIME_DIR, '.tmp');

const VERSIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-versions.json'), 'utf-8'));

function currentPlatform() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win-x64';
  if (p === 'darwin' && a === 'x64') return 'mac-x64';
  if (p === 'darwin' && a === 'arm64') return 'mac-arm64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  throw new Error('不支持的平台: ' + p + '-' + a);
}

function uvAsset(platform) {
  const map = {
    'win-x64': 'uv-x86_64-pc-windows-msvc.zip',
    'mac-x64': 'uv-x86_64-apple-darwin.tar.gz',
    'mac-arm64': 'uv-aarch64-apple-darwin.tar.gz',
    'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
    'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  };
  return map[platform];
}

function nodeAsset(platform) {
  const v = VERSIONS.node;
  const map = {
    'win-x64': 'node-' + v + '-win-x64.zip',
    'mac-x64': 'node-' + v + '-darwin-x64.tar.gz',
    'mac-arm64': 'node-' + v + '-darwin-arm64.tar.gz',
    'linux-x64': 'node-' + v + '-linux-x64.tar.gz',
    'linux-arm64': 'node-' + v + '-linux-arm64.tar.gz',
  };
  return map[platform];
}

function download(url, dest) {
  console.log('[runtime] 下载 ' + url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execSync('curl -L --fail --silent --show-error -o "' + dest + '" "' + url + '"', { stdio: 'inherit' });
}

function extract(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (archive.endsWith('.zip')) {
    execSync('tar -xf "' + archive + '" -C "' + dest + '"', { stdio: 'inherit' });
  } else if (archive.endsWith('.tar.gz')) {
    execSync('tar -xzf "' + archive + '" -C "' + dest + '"', { stdio: 'inherit' });
  } else {
    throw new Error('不支持的压缩格式: ' + archive);
  }
}

function installedMarker(platform) {
  return path.join(RUNTIME_DIR, platform, '.installed.json');
}

function isUpToDate(platform) {
  try {
    const marker = JSON.parse(fs.readFileSync(installedMarker(platform), 'utf-8'));
    return marker.uv === VERSIONS.uv && marker.node === VERSIONS.node;
  } catch {
    return false;
  }
}

/** 把 srcDir 下的所有文件复制到 destDir */
function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function chmodExec(dir) {
  // macOS/Linux 需要可执行位
  if (process.platform === 'win32') return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) chmodExec(p);
    else {
      try { fs.chmodSync(p, 0o755); } catch {}
    }
  }
}

function main() {
  const platform = currentPlatform();
  if (isUpToDate(platform)) {
    console.log('[runtime] ' + platform + ' 已是最新（uv ' + VERSIONS.uv + ', node ' + VERSIONS.node + '），跳过');
    return;
  }

  console.log('[runtime] 准备 ' + platform + ' 运行时...');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const binDir = path.join(RUNTIME_DIR, platform, 'bin');
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });

  // ---- uv ----
  const uvAssetName = uvAsset(platform);
  const uvUrl = 'https://github.com/astral-sh/uv/releases/download/' + VERSIONS.uv + '/' + uvAssetName;
  const uvArchive = path.join(TMP_DIR, uvAssetName);
  download(uvUrl, uvArchive);
  const uvExtract = path.join(TMP_DIR, 'uv');
  extract(uvArchive, uvExtract);
  // uv 解压后直接是 uv / uv.exe（可能有子目录，递归找）
  copyDir(uvExtract, binDir);

  // ---- node ----
  const nodeAssetName = nodeAsset(platform);
  const nodeUrl = 'https://nodejs.org/dist/' + VERSIONS.node + '/' + nodeAssetName;
  const nodeArchive = path.join(TMP_DIR, nodeAssetName);
  download(nodeUrl, nodeArchive);
  const nodeExtract = path.join(TMP_DIR, 'node');
  extract(nodeArchive, nodeExtract);
  // node 解压后是 node-vX.Y.Z-<platform>/ 子目录
  const nodeInner = fs.readdirSync(nodeExtract).map(n => path.join(nodeExtract, n)).find(p => fs.statSync(p).isDirectory());
  copyDir(nodeInner || nodeExtract, binDir);

  chmodExec(binDir);

  // 标记已安装
  fs.writeFileSync(installedMarker(platform), JSON.stringify({
    uv: VERSIONS.uv, node: VERSIONS.node, installedAt: new Date().toISOString(),
  }, null, 2));

  // 清理临时
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  console.log('[runtime] 完成 → ' + binDir);
  console.log('[runtime] 内容: ' + fs.readdirSync(binDir).join(', '));
}

main();

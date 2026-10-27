/**
 * 下载/准备 MCP 运行时二进制（uv + node）以及 pnpm
 *
 * 背景：MCP server 常用 `uvx`（Python）或 `npx`（Node）启动，但用户机器
 * 不一定装了 uv/node。此脚本在构建/开发时下载对应平台的二进制到
 * resources/runtime/<platform>/bin/，打包后由 MCP spawn 时优先使用（不碰用户系统）。
 * pnpm 是纯 JS，跨平台共享，放在 resources/runtime/pnpm/。
 *
 * 幂等：已安装且版本一致时跳过。
 * 支持平台：win-x64 / mac-x64 / mac-arm64 / linux-x64 / linux-arm64
 *  （目录名与 src/infra/runtime-platform.ts 保持一致）。
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

// 目录布局版本：改动安装结构时 +1，让老用户重新下载（v2：posix 按 node 前缀目录铺开，修复 bin/bin/node）
const LAYOUT_VERSION = 2;

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
  } else if (archive.endsWith('.tar.gz') || archive.endsWith('.tgz')) {
    execSync('tar -xzf "' + archive + '" -C "' + dest + '"', { stdio: 'inherit' });
  } else {
    throw new Error('不支持的压缩格式: ' + archive);
  }
}

function installedMarker(platform) {
  return path.join(RUNTIME_DIR, platform, '.installed.json');
}

/** uv/node 是否已就位（不因 pnpm 缺失而重装） */
function isUpToDate(platform) {
  try {
    const marker = JSON.parse(fs.readFileSync(installedMarker(platform), 'utf-8'));
    return marker.uv === VERSIONS.uv && marker.node === VERSIONS.node
      && marker.layout === LAYOUT_VERSION;
  } catch {
    return false;
  }
}

/** pnpm 目录（跨平台共享，纯 JS） */
const PNPM_DIR = path.join(RUNTIME_DIR, 'pnpm');

/** pnpm 已就位且版本一致？ */
function isPnpmUpToDate() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PNPM_DIR, 'package.json'), 'utf-8'));
    return pkg.version === VERSIONS.pnpm;
  } catch {
    return false;
  }
}

/** 下载 pnpm（tarball → 解压 → 拷进 resources/runtime/pnpm/） */
function fetchPnpm() {
  if (isPnpmUpToDate()) {
    console.log('[runtime] pnpm ' + VERSIONS.pnpm + ' 已就位，跳过');
    return;
  }
  console.log('[runtime] 准备 pnpm ' + VERSIONS.pnpm + '...');
  const assetName = 'pnpm-' + VERSIONS.pnpm + '.tgz';
  const url = 'https://registry.npmmirror.com/pnpm/-/' + assetName;
  const archive = path.join(TMP_DIR, assetName);
  download(url, archive);
  const extractDir = path.join(TMP_DIR, 'pnpm');
  extract(archive, extractDir);
  // npm tarball 解压后是 package/ 子目录
  const inner = fs.readdirSync(extractDir).map((n) => path.join(extractDir, n))
    .find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  const srcDir = inner || extractDir;
  fs.rmSync(PNPM_DIR, { recursive: true, force: true });
  fs.mkdirSync(PNPM_DIR, { recursive: true });
  copyDir(srcDir, PNPM_DIR);
  console.log('[runtime] pnpm 就位 → ' + PNPM_DIR);
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

/** 解压 tar.gz 并去掉顶层目录（直接铺到 dest，保留 tar 里的相对符号链接与权限） */
function extractTarGzStripOne(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execSync('tar -xzf "' + archive + '" -C "' + dest + '" --strip-components=1', { stdio: 'inherit' });
}

/**
 * 找到真正存放可执行文件的目录：官方包可能直接铺在根，也可能多一层子目录
 * （如 uv 的 tar.gz 里是 uv-x86_64-unknown-linux-gnu/，node 的 win zip 无子目录）。
 * @param {string} root 解压目录
 * @param {string} markerFile 特征文件名（如 node.exe / uv）
 */
function findPayloadDir(root, markerFile) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.shift();
    if (fs.existsSync(path.join(dir, markerFile))) return dir;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) stack.push(path.join(dir, ent.name));
    }
  }
  return root;
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
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // ---- uv + node（按平台；已就位则跳过）----
  if (isUpToDate(platform)) {
    console.log('[runtime] ' + platform + ' uv/node 已是最新（uv ' + VERSIONS.uv + ', node ' + VERSIONS.node + '），跳过');
  } else {
    console.log('[runtime] 准备 ' + platform + ' 运行时...');
    const isWin = process.platform === 'win32';
    const platformDir = path.join(RUNTIME_DIR, platform);
    const binDir = path.join(platformDir, 'bin');

    // Windows：zip 根目录就是可执行文件集合，只清 bin。
    // macOS/Linux：node 解压出来是 bin/lib/include/share 前缀目录，整目录重铺。
    if (isWin) {
      fs.rmSync(binDir, { recursive: true, force: true });
    } else {
      fs.rmSync(platformDir, { recursive: true, force: true });
    }
    fs.mkdirSync(binDir, { recursive: true });

    // ---- uv ----
    const uvAssetName = uvAsset(platform);
    const uvUrl = 'https://github.com/astral-sh/uv/releases/download/' + VERSIONS.uv + '/' + uvAssetName;
    const uvArchive = path.join(TMP_DIR, uvAssetName);
    download(uvUrl, uvArchive);
    const uvExtract = path.join(TMP_DIR, 'uv');
    extract(uvArchive, uvExtract);
    // uv 包内只取可执行文件（win：uv.exe/uvx.exe；posix：uv/uvx），忽略同层的 LICENSE 与子目录
    const uvPayload = findPayloadDir(uvExtract, isWin ? 'uv.exe' : 'uv');
    for (const ent of fs.readdirSync(uvPayload, { withFileTypes: true })) {
      if (ent.isDirectory()) continue;
      const name = ent.name;
      if (!/^(uv|uvw|uvx)(\.exe)?$/i.test(name)) continue;
      fs.copyFileSync(path.join(uvPayload, name), path.join(binDir, name));
    }

    // ---- node ----
    const nodeAssetName = nodeAsset(platform);
    const nodeUrl = 'https://nodejs.org/dist/' + VERSIONS.node + '/' + nodeAssetName;
    const nodeArchive = path.join(TMP_DIR, nodeAssetName);
    download(nodeUrl, nodeArchive);
    const nodeExtract = path.join(TMP_DIR, 'node');
    if (isWin) {
      // win zip：binDir 直接放 node.exe / npm.cmd / npx.cmd / node_modules/
      extract(nodeArchive, nodeExtract);
      copyDir(findPayloadDir(nodeExtract, 'node.exe'), binDir);
    } else {
      // darwin/linux tar.gz：前缀目录（bin/lib/include/share）直接铺到 <platform>/，
      // 得到 <platform>/bin/node 与 <platform>/bin/npm -> ../lib/node_modules/npm/bin/npm-cli.js
      extractTarGzStripOne(nodeArchive, platformDir);
    }

    chmodExec(binDir);
    if (!isWin) {
      // npm/npx 是指向 lib/node_modules/npm 的符号链接，chmod 会落到链接目标，补一次
      for (const n of ['npm', 'npx', 'corepack']) {
        try { fs.chmodSync(path.join(binDir, n), 0o755); } catch {}
      }
    }

    // 标记已安装
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(installedMarker(platform), JSON.stringify({
      uv: VERSIONS.uv, node: VERSIONS.node, layout: LAYOUT_VERSION, installedAt: new Date().toISOString(),
    }, null, 2));

    console.log('[runtime] 完成 → ' + binDir);
    console.log('[runtime] 内容: ' + fs.readdirSync(binDir).join(', '));
  }

  // ---- pnpm（跨平台共享，纯 JS）----
  fetchPnpm();

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

main();

/**
 * Profile 初始化（纯 node）
 *
 * 首次使用时创建空 profile：
 *  - package.json（默认 manifest）
 *  - cordis.patch.yml（空补丁层）
 *  - pnpm-workspace.yaml（pnpm 需要）
 *
 * 幂等：已存在则不覆盖（用户手改的不会被冲掉）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProfileDir, getProfileManifestPath, getProfilePatchPath, getProfileWorkspacePath, getProfileLocalDir, getProfileModulesDir, getBundledPluginsDir, getUserDir, DEFAULT_PROFILE } from './paths.js';
import { defaultManifest, readProfileManifest, writeProfileManifest } from './manifest.js';
import { writeProfilePatch, readProfilePatch } from './patch.js';

/** 确保 profile 存在且结构完整（幂等）。返回 profile 目录。 */
export function ensureProfile(name: string = DEFAULT_PROFILE): string {
  const dir = getProfileDir(name);
  fs.mkdirSync(dir, { recursive: true });

  // package.json
  if (!fs.existsSync(getProfileManifestPath(dir))) {
    writeProfileManifest(dir, defaultManifest(name));
  }

  // cordis.patch.yml（空补丁层）
  if (!fs.existsSync(getProfilePatchPath(dir))) {
    writeProfilePatch(dir, []);
  }

  // pnpm-workspace.yaml（pnpm 需要这个才认"workspace 根"）
  // 内容对齐 DSH：packages: ['.'] + nodeLinker: hoisted（兼容 npm 的扁平 node_modules）
  if (!fs.existsSync(getProfileWorkspacePath(dir))) {
    const yaml = [
      '# Cuckoo profile workspace（对齐 DSH 的 pnpm-workspace.yaml）',
      'packages:',
      "  - '.'",
      '',
      '# hoisted：扁平 node_modules（Cuckoo 的加载逻辑按目录找插件，不用 pnpm 的软链）',
      'nodeLinker: hoisted',
      '# ⚠️ 不自动装 peer：DSH 插件的 peer 是 @deepseek-ai/*（宿主提供，npm 上没有）',
      '#    装它会 404 / 版本匹配失败（对齐 DSH 的配置）',
      'autoInstallPeers: false',
      '# store 固定在 ~/.cuckoo/pnpm-store（避免环境变量变化导致 store 不一致）',
      'storeDir: ' + JSON.stringify(path.join(getUserDir(), 'pnpm-store')),
      '',
      '# 需要构建的包（原生模块，对齐 DSH）',
      'allowBuilds:',
      '  cloudflared: true',
      '  cpu-features: true',
      '  ssh2: true',
      '',
    ].join(String.fromCharCode(10));
    fs.writeFileSync(getProfileWorkspacePath(dir), yaml, 'utf-8');
  }

  // local-plugins/
  fs.mkdirSync(getProfileLocalDir(dir), { recursive: true });

  // 预置插件（首次创建 profile 时复制内置插件；用标记防"用户删了又回来"）
  seedBundledPlugins(dir, name);

  return dir;
}

/** 预置插件标记文件名 */
const SEED_MARKER = '.bundled-plugins-seeded';

/** 复制目录（递归） */
function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

/**
 * 首次创建 profile 时，把内置插件（resources/bundled-plugins/）复制进 profile 的
 * node_modules/，并写进 package.json 的 dependencies + dsh.profile.bundles。
 * 用 <profile>/.bundled-plugins-seeded 标记：用户删了插件后，下次启动不会"复活"。
 */
function seedBundledPlugins(dir: string, name: string): void {
  const marker = path.join(dir, SEED_MARKER);
  if (fs.existsSync(marker)) return; // 已预置过（用户可自由删）
  const bundledDir = getBundledPluginsDir();
  if (!fs.existsSync(bundledDir)) return; // 没有内置插件目录：不写标记（留待后续版本）

  // 遍历 bundled-plugins 下的包（支持 @scope/name）
  const seeded: string[] = [];
  const scan = (baseDir: string, prefix: string) => {
    for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(baseDir, e.name);
      const pkgName = prefix ? prefix + '/' + e.name : e.name;
      if (fs.existsSync(path.join(full, 'package.json'))) {
        // 是一个包：复制到 node_modules/<pkgName>
        const dst = path.join(getProfileModulesDir(dir), pkgName);
        if (!fs.existsSync(dst)) copyDirSync(full, dst);
        seeded.push(pkgName);
      } else if (e.name.startsWith('@')) {
        // scope 目录：递归
        scan(full, e.name);
      }
    }
  };
  try { scan(bundledDir, ''); } catch { /* ignore */ }

  if (seeded.length) {
    // 写进 manifest（dependencies + bundles）
    const mf = readProfileManifest(dir, name);
    mf.dependencies = mf.dependencies || {};
    mf.dsh = mf.dsh || {};
    mf.dsh.profile = mf.dsh.profile || {};
    mf.dsh.profile.bundles = mf.dsh.profile.bundles || [];
    for (const pkg of seeded) {
      const pkgJson = path.join(getProfileModulesDir(dir), pkg, 'package.json');
      let ver = '*';
      try { ver = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version || '*'; } catch { /* ignore */ }
      if (!mf.dependencies[pkg]) mf.dependencies[pkg] = ver;
      if (!mf.dsh.profile.bundles.includes(pkg)) mf.dsh.profile.bundles.push(pkg);
    }
    writeProfileManifest(dir, mf);
  }
  if (seeded.length) {
    try { fs.writeFileSync(marker, seeded.join(String.fromCharCode(10)), 'utf-8'); } catch { /* ignore */ }
  }
}

/** profile 是否已初始化 */
export function isProfileReady(name: string = DEFAULT_PROFILE): boolean {
  const dir = getProfileDir(name);
  return fs.existsSync(getProfileManifestPath(dir)) && fs.existsSync(getProfilePatchPath(dir));
}

/** 读 profile 状态（manifest + patch） */
export function readProfileState(name: string = DEFAULT_PROFILE): { dir: string; manifest: ReturnType<typeof readProfileManifest>; patches: ReturnType<typeof readProfilePatch> } {
  const dir = ensureProfile(name);
  return { dir, manifest: readProfileManifest(dir, name), patches: readProfilePatch(dir) };
}

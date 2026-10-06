/**
 * 工作快照（Snapshots）管理
 *
 * 存储：~/.cuckoo/snapshots/<id>/
 *   - meta.json：{ id, name, description, projectDir, fileCount, totalBytes, createdAt }
 *   - files/：项目文件副本（保持相对路径结构）
 * 可用环境变量 CUCKOO_HOME 覆盖（测试隔离）。
 *
 * 快照当前项目目录，排除 .git / node_modules / dist / out 等产物目录（避免体积爆炸）。
 * 恢复会覆盖当前项目文件，属破坏性操作，调用方需确认。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SnapshotMeta {
  id: string;
  name: string;
  description: string;
  projectDir: string;
  fileCount: number;
  totalBytes: number;
  createdAt: number;
}

/** 排除的目录名（任意层级命中即跳过） */
const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build',
  '.cuckoo', '.cuckooCode', 'coverage', '.cache', 'wyp',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode',
]);

/**
 * 排除的敏感文件名模式（避免把密钥/凭据复制进快照）。
 * 匹配文件名（basename）本身，不区分大小写。
 */
const EXCLUDE_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,          // .env / .env.local / .env.production ...
  /^id_(rsa|dsa|ecdsa|ed25519)$/i, // SSH 私钥
  /^.*\.(pem|key|p12|pfx|jks|keystore)$/i, // 证书/私钥
  /^credentials(\.json)?$/i,
  /^secrets?(\.json|\.ya?ml)?$/i,
  /^\.npmrc$/i,               // 可能含 token
  /^\.netrc$/i,
  /^auth\.json$/i,
  /^service-account.*\.json$/i, // GCP
  /^\.htpasswd$/i,
];

/** 判断文件名是否应排除（敏感文件） */
function isExcludedFile(name: string): boolean {
  return EXCLUDE_FILE_PATTERNS.some((re) => re.test(name));
}

/** 用户级目录（可用 CUCKOO_HOME 覆盖） */
function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

function getSnapshotsDir(): string {
  return path.join(getUserDir(), 'snapshots');
}

function getSnapshotDir(id: string): string {
  return path.join(getSnapshotsDir(), id);
}

/** 生成快照 id：snap-<时间戳>-<随机> */
function newSnapshotId(): string {
  return 'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 递归收集 projectDir 下需要快照的文件（绝对路径列表），跳过排除目录与符号链接。
 */
function collectFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (EXCLUDE_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        if (isExcludedFile(ent.name)) continue; // 敏感文件不入快照
        result.push(path.join(dir, ent.name));
      }
    }
  };
  walk(root);
  return result;
}

/**
 * 创建快照。
 * @param projectDir 要快照的项目目录（绝对路径）
 * @param name 快照名（非空）
 * @param description 可选描述
 * @returns 快照元数据；失败抛异常
 */
function createSnapshot(projectDir: string, name: string, description: string = ''): SnapshotMeta {
  if (!projectDir || !fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error('项目目录不存在或不是目录: ' + projectDir);
  }
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) throw new Error('快照名不能为空');

  const id = newSnapshotId();
  const snapDir = getSnapshotDir(id);
  const filesDir = path.join(snapDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  const files = collectFiles(projectDir);
  let totalBytes = 0;
  for (const abs of files) {
    const rel = path.relative(projectDir, abs);
    const dest = path.join(filesDir, rel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
      totalBytes += fs.statSync(abs).size;
    } catch (err: any) {
      console.warn('[Snapshots] 复制失败:', abs, err.message);
    }
  }

  const meta: SnapshotMeta = {
    id, name: n, description: String(description || ''),
    projectDir, fileCount: files.length, totalBytes, createdAt: Date.now(),
  };
  fs.writeFileSync(path.join(snapDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  console.log('[Snapshots] 已创建:', id, meta.fileCount + ' 个文件');
  return meta;
}

/** 列出全部快照（按创建时间倒序）。损坏的 meta 跳过。 */
function listSnapshots(): SnapshotMeta[] {
  const dir = getSnapshotsDir();
  if (!fs.existsSync(dir)) return [];
  const metas: SnapshotMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    const metaFile = path.join(dir, name, 'meta.json');
    try {
      if (fs.existsSync(metaFile)) {
        const m = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        if (m && m.id) metas.push(m as SnapshotMeta);
      }
    } catch { /* 跳过损坏项 */ }
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt);
}

/** 读取单个快照元数据 */
function getSnapshot(id: string): SnapshotMeta | null {
  const metaFile = path.join(getSnapshotDir(id), 'meta.json');
  try {
    if (fs.existsSync(metaFile)) return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  } catch { /* ignore */ }
  return null;
}

/**
 * 恢复快照：把 files/ 下的文件复制回 projectDir（覆盖同名文件）。
 * 注意：不删除 projectDir 中快照没有的文件（非镜像还原，只还原被快照的文件）。
 * @param id 快照 id
 * @returns { restored: number, projectDir: string }
 */
function restoreSnapshot(id: string): { restored: number; projectDir: string } {
  const meta = getSnapshot(id);
  if (!meta) throw new Error('快照不存在: ' + id);
  const filesDir = path.join(getSnapshotDir(id), 'files');
  if (!fs.existsSync(filesDir)) throw new Error('快照文件目录缺失: ' + id);
  if (!fs.existsSync(meta.projectDir)) {
    throw new Error('原项目目录已不存在，无法恢复: ' + meta.projectDir);
  }

  const projectRoot = path.resolve(meta.projectDir);
  let restored = 0;
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(src); continue; }
      if (!ent.isFile()) continue;
      const rel = path.relative(filesDir, src);
      const dest = path.resolve(projectRoot, rel);
      // 路径穿越防护：目标必须在项目目录内
      if (dest !== projectRoot && !dest.startsWith(projectRoot + path.sep)) {
        console.warn('[Snapshots] 跳过越界路径:', dest);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      restored++;
    }
  };
  walk(filesDir);
  console.log('[Snapshots] 已恢复:', id, restored + ' 个文件');
  return { restored, projectDir: meta.projectDir };
}

/** 删除快照（整个目录） */
function deleteSnapshot(id: string): boolean {
  const dir = getSnapshotDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[Snapshots] 已删除:', id);
  return true;
}

export {
  createSnapshot, listSnapshots, getSnapshot, restoreSnapshot, deleteSnapshot,
  getSnapshotsDir, getSnapshotDir, collectFiles, EXCLUDE_DIRS, EXCLUDE_FILE_PATTERNS, isExcludedFile,
};

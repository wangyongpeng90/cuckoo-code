/**
 * Profile 的 package.json 读写（纯 node）
 *
 * 格式对齐 DSH（见 docs/dsh-profile-compat.md）：
 *  {
 *    "name": "cuckoo-profile-default",
 *    "private": true,
 *    "dependencies": { "dshmarket": "^1.66.14" },
 *    "dsh": { "profile": { "bundles": ["dshmarket"] } }
 *  }
 */
import fs from 'node:fs';
import path from 'node:path';

/** Profile manifest（对齐 DSH 的最小集） */
export interface ProfileManifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  dsh?: {
    profile?: {
      /** 参与加载的 bundle 列表（按序） */
      bundles?: string[];
    };
  };
}

/** 默认 manifest（新建 profile 时用） */
export function defaultManifest(name: string): ProfileManifest {
  return {
    name: 'cuckoo-profile-' + name,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  };
}

/** 读 profile 的 package.json（不存在返回默认） */
export function readProfileManifest(dir: string, name: string): ProfileManifest {
  const file = path.join(dir, 'package.json');
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as ProfileManifest;
  } catch {
    /* fallthrough */
  }
  return defaultManifest(name);
}

/** 写 profile 的 package.json（缩进 2，末尾换行） */
export function writeProfileManifest(dir: string, manifest: ProfileManifest): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + String.fromCharCode(10), 'utf-8');
}

/** 加/改一个依赖（同时加入 bundles） */
export function addDependency(manifest: ProfileManifest, name: string, version: string): ProfileManifest {
  const m: ProfileManifest = JSON.parse(JSON.stringify(manifest || defaultManifest('default')));
  m.dependencies = m.dependencies || {};
  m.dependencies[name] = version;
  m.dsh = m.dsh || {};
  m.dsh.profile = m.dsh.profile || {};
  m.dsh.profile.bundles = m.dsh.profile.bundles || [];
  if (!m.dsh.profile.bundles.includes(name)) m.dsh.profile.bundles.push(name);
  return m;
}

/** 删一个依赖（同时从 bundles 移除） */
export function removeDependency(manifest: ProfileManifest, name: string): ProfileManifest {
  const m: ProfileManifest = JSON.parse(JSON.stringify(manifest || defaultManifest('default')));
  if (m.dependencies) delete m.dependencies[name];
  if (m.dsh && m.dsh.profile && m.dsh.profile.bundles) {
    m.dsh.profile.bundles = m.dsh.profile.bundles.filter((b) => b !== name);
  }
  return m;
}

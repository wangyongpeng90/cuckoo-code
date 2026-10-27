import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('profile installer', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-install-'));
    process.env.CUCKOO_HOME = tmp;
  });
  afterEach(() => {
    delete process.env.CUCKOO_HOME;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('packageNameToId', async () => {
    const { packageNameToId } = await import('../../src/plugins/profile/installer.js');
    expect(packageNameToId('dshmarket')).toBe('dshmarket');
    expect(packageNameToId('@scope/name')).toBe('scope-name');
    expect(packageNameToId('@linxin666/dsh-web-all')).toBe('linxin666-dsh-web-all');
  });

  it('listProfilePlugins 空 profile', async () => {
    const { listProfilePlugins } = await import('../../src/plugins/profile/installer.js');
    const { ensureProfile } = await import('../../src/plugins/profile/init.js');
    ensureProfile('default');
    const list = listProfilePlugins('default');
    expect(list).toEqual([]);
  });

  it('listProfilePlugins 读到 manifest 里的依赖', async () => {
    const { listProfilePlugins } = await import('../../src/plugins/profile/installer.js');
    const { ensureProfile } = await import('../../src/plugins/profile/init.js');
    const { readProfileManifest, writeProfileManifest, addDependency } = await import('../../src/plugins/profile/manifest.js');
    const dir = ensureProfile('default');
    let m = readProfileManifest(dir, 'default');
    m = addDependency(m, 'dshmarket', '^1.66.14');
    writeProfileManifest(dir, m);
    const list = listProfilePlugins('default');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('dshmarket');
    expect(list[0].spec).toBe('^1.66.14');
    expect(list[0].installed).toBe(false); // 没真装
  });

  it('installToProfile 空包名报错', async () => {
    const { installToProfile } = await import('../../src/plugins/profile/installer.js');
    const r = await installToProfile('');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不能为空');
  });

  it('installToProfile 非法包名报错', async () => {
    const { installToProfile } = await import('../../src/plugins/profile/installer.js');
    const r = await installToProfile('!!!bad!!!');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('非法');
  });

  it('pnpm 可用性（真机有 resources/runtime/pnpm 时为 true）', async () => {
    const { isPnpmAvailable } = await import('../../src/plugins/profile/pnpm.js');
    // 只测函数存在（真机才验证）
    expect(typeof isPnpmAvailable).toBe('function');
  });
});

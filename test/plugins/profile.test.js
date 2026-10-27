import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('profile init', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-profile-'));
    process.env.CUCKOO_HOME = tmp;
  });
  afterEach(() => {
    delete process.env.CUCKOO_HOME;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('ensureProfile 创建结构', async () => {
    const { ensureProfile } = await import('../../src/plugins/profile/init.js');
    const dir = ensureProfile('default');
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'cordis.patch.yml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'local-plugins'))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    expect(pkg.private).toBe(true);
    expect(pkg.dsh.profile.bundles).toEqual([]);
  });

  it('manifest 加/删依赖', async () => {
    const { defaultManifest, addDependency, removeDependency } = await import('../../src/plugins/profile/manifest.js');
    let m = defaultManifest('default');
    m = addDependency(m, 'dshmarket', '^1.66.14');
    expect(m.dependencies.dshmarket).toBe('^1.66.14');
    expect(m.dsh.profile.bundles).toContain('dshmarket');
    m = removeDependency(m, 'dshmarket');
    expect(m.dependencies.dshmarket).toBeUndefined();
    expect(m.dsh.profile.bundles).not.toContain('dshmarket');
  });

  it('patch 解析/序列化往返', async () => {
    const { parsePatch, serializePatch, setDisabled, isDisabled } = await import('../../src/plugins/profile/patch.js');
    const entries = [
      { id: 'plugin-a', disabled: true },
      { id: 'plugin-b', name: '@scope/b', config: { key: 'val' } },
    ];
    const text = serializePatch(entries);
    const back = parsePatch(text);
    expect(back.length).toBe(2);
    expect(back[0].id).toBe('plugin-a');
    expect(back[0].disabled).toBe(true);
    expect(back[1].name).toBe('@scope/b');
    const e2 = setDisabled(back, 'plugin-c', true);
    expect(isDisabled(e2, 'plugin-c')).toBe(true);
  });
});

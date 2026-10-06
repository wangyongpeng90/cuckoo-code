/**
 * 插件源码加载链路测试（隔离，不启动 Electron）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpHome;

beforeAll(() => {
  // 用临时目录做 CUCKOO_HOME
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-test-'));
  process.env.CUCKOO_HOME = tmpHome;
});

afterAll(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  delete process.env.CUCKOO_HOME;
});

describe('插件文件扫描链路', () => {
  it('getEnabledPluginDshFiles 只返回已启用插件的 dsh/*.js', async () => {
    // 动态 import（让 CUCKOO_HOME 生效）
    const paths = await import('../src/plugins/paths.js');
    const state = await import('../src/plugins/state.js');
    const roots = await import('../src/plugins/roots.js');

    const pluginsDir = paths.getPluginsDir();
    const p1 = path.join(pluginsDir, 'plug-a');
    const p2 = path.join(pluginsDir, 'plug-b');
    fs.mkdirSync(path.join(p1, 'dsh'), { recursive: true });
    fs.mkdirSync(path.join(p2, 'dsh'), { recursive: true });
    fs.writeFileSync(path.join(p1, 'plugin.json'), JSON.stringify({ id: 'plug-a', name: 'A' }));
    fs.writeFileSync(path.join(p2, 'plugin.json'), JSON.stringify({ id: 'plug-b', name: 'B' }));
    fs.writeFileSync(path.join(p1, 'dsh', 'a.js'), 'export const name = "a";');
    fs.writeFileSync(path.join(p2, 'dsh', 'b.js'), 'export const name = "b";');

    // 只启用 plug-a
    state.setPluginEnabled('plug-a', true);
    state.setPluginEnabled('plug-b', false);

    const files = roots.getEnabledPluginDshFiles();
    expect(files.length).toBe(1);
    expect(files[0]).toContain('a.js');
    expect(files[0]).not.toContain('b.js');
  });
});

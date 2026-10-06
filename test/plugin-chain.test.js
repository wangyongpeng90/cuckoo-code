/**
 * 完整插件加载链路测试（隔离，不启动 Electron）
 * 模拟：插件文件 → 读源码 → 解析 config → PluginHost 加载
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpHome;

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-chain-'));
  process.env.CUCKOO_HOME = tmpHome;
});

afterAll(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  delete process.env.CUCKOO_HOME;
});

describe('完整插件加载链路', () => {
  it('文件 → 源码 → PluginHost 加载', async () => {
    const paths = await import('../src/plugins/paths.js');
    const state = await import('../src/plugins/state.js');
    const { PluginHost } = await import('../src/plugins/runtime/plugin-host.js');
    const { parseCordisPatch } = await import('../src/plugins/runtime/patch.js');

    // 造一个插件
    const dir = path.join(paths.getPluginsDir(), 'chain-plug');
    fs.mkdirSync(path.join(dir, 'dsh'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'chain-plug', name: 'Chain' }));
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '- insert:\n    - id: chain-plug\n      name: chain-plug');
    fs.writeFileSync(path.join(dir, 'dsh', 'main.js'), 'export const name = "chain-dsh"; export function apply(ctx) { ctx.log("dsh ok"); }');
    fs.writeFileSync(path.join(dir, 'ui', 'pet.js'), 'export const name = "chain-ui"; export function apply(ctx) {}');
    state.setPluginEnabled('chain-plug', true);

    // 读源码（模拟 IPC）
    const fsMod = await import('node:fs');
    const dshFile = path.join(dir, 'dsh', 'main.js');
    const uiFile = path.join(dir, 'ui', 'pet.js');
    const dshSrc = fsMod.readFileSync(dshFile, 'utf-8');
    const uiSrc = fsMod.readFileSync(uiFile, 'utf-8');

    // 解析 config
    const patchText = fsMod.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf-8');
    const patch = parseCordisPatch(patchText);
    expect(patch.inserts.length).toBe(1);

    // PluginHost 加载
    const host = new PluginHost({
      sendToChat: async () => true,
      getCurrentSessionId: () => null,
      getProjectDir: () => null,
      listSessions: () => [],
      listTools: () => [],
      getSetting: () => undefined,
      setSetting: () => {},
    });
    const r = host.loadAll([
      { name: 'chain-dsh', source: dshSrc, kind: 'dsh', config: patch },
      { name: 'chain-ui', source: uiSrc, kind: 'ui', config: patch },
    ]);
    expect(r.loaded).toEqual(['chain-dsh', 'chain-ui']);
    expect(host.stats()).toEqual({ total: 2, dsh: 1, ui: 1, failed: 0 });
  });
});

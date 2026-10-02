'use strict';
/**
 * 插件安装器测试
 *
 * 用真实的 tar.gz 走通下载→解压→校验→落盘全链路（注入假 HTTP 传输层）。
 * 安全相关的过滤器单独做单元测试（构造恶意 tar 成本高，且 tar 包自身默认
 * preservePaths:false 已拦一层，这里验证我们自己的那道）。
 */
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { create } from 'tar';

import {
  isValidRepo,
  isValidBranch,
  buildTarballUrl,
  safeEntryFilter,
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
} from '../../src/plugins/installer.js';
// 状态读写已独立成模块（避免加载 provider 的一方被 tar 拖累）
import { isPluginEnabled, setPluginEnabled } from '../../src/plugins/state.js';
import { getPluginsDir, getPluginDir } from '../../src/plugins/paths.js';

const TMP = path.join(os.tmpdir(), 'cuckoo-plugin-installer-test');
const FAKE_HOME = path.join(TMP, 'home');
const WORK = path.join(TMP, 'work');

let oldHome;
let seq = 0;

beforeEach(() => {
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
});

/**
 * 造一个 GitHub 形态的 tarball：顶层带 `<repo>-<sha>/` 前缀。
 * @param files { 'plugin.json': '...', 'skills/demo/SKILL.md': '...' }
 */
async function makeTarball(files, rootName = 'demo-abc123') {
  const src = path.join(WORK, 'src' + ++seq, rootName);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(src, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
  }
  const out = path.join(WORK, 'out' + seq + '.tar.gz');
  await create({ gzip: true, cwd: path.dirname(src), file: out, portable: true }, [rootName]);
  return fs.readFileSync(out);
}

function httpWith(body, status = 200, calls) {
  return async (req) => {
    if (calls) calls.push(req);
    return { status, headers: {}, body };
  };
}

const GOOD_MANIFEST = JSON.stringify({ id: 'demo', name: '演示插件', version: '1.0.0' });

// ===== 校验 =====

test('isValidRepo: 接受与拒绝', () => {
  assert.strictEqual(isValidRepo('alice/demo'), true);
  assert.strictEqual(isValidRepo('a-b/c.d_e'), true);
  assert.strictEqual(isValidRepo('no-slash'), false);
  assert.strictEqual(isValidRepo('a/b/c'), false);
  assert.strictEqual(isValidRepo('a/'), false);
  assert.strictEqual(isValidRepo('/b'), false);
  assert.strictEqual(isValidRepo(''), false);
  assert.strictEqual(isValidRepo(null), false);
});

test('isValidRepo: 拒绝以 .. 为 owner 的路径逃逸', () => {
  // 曾用 `[A-Za-z0-9._-]+` 匹配 owner，导致 '..' 通过校验，
  // '../evil' 成了"合法仓库"，拼出的 URL 会被规范化到完全不同的路径
  assert.strictEqual(isValidRepo('../evil'), false);
  assert.strictEqual(isValidRepo('../..'), false);
  assert.strictEqual(isValidRepo('./evil'), false);
  assert.strictEqual(isValidRepo('alice/..'), false);
  assert.strictEqual(isValidRepo('alice/.'), false);
  assert.strictEqual(isValidRepo('-alice/demo'), false, 'owner 不能以连字符开头');
});

test('isValidBranch: 接受常规名与带斜杠名', () => {
  assert.strictEqual(isValidBranch('master'), true);
  assert.strictEqual(isValidBranch('main'), true);
  assert.strictEqual(isValidBranch('release/1.0'), true);
});

test('isValidBranch: 拒绝逃逸与空段', () => {
  assert.strictEqual(isValidBranch('..'), false);
  assert.strictEqual(isValidBranch('a/../b'), false);
  assert.strictEqual(isValidBranch('a//b'), false);
  assert.strictEqual(isValidBranch('/a'), false);
  assert.strictEqual(isValidBranch('a/'), false);
  assert.strictEqual(isValidBranch(''), false);
  assert.strictEqual(isValidBranch('  '), false);
  assert.strictEqual(isValidBranch('a b'), false);
});

test('buildTarballUrl: 指向 codeload（不消耗 API 配额）', () => {
  const u = buildTarballUrl('alice/demo', 'master');
  assert.strictEqual(u, 'https://codeload.github.com/alice/demo/tar.gz/refs/heads/master');
});

// ===== 解压过滤器（安全核心）=====

test('safeEntryFilter: 放行正常相对路径', () => {
  assert.strictEqual(safeEntryFilter('plugin.json', { type: 'File' }), true);
  assert.strictEqual(safeEntryFilter('skills/demo/SKILL.md', { type: 'File' }), true);
  assert.strictEqual(safeEntryFilter('dir/', { type: 'Directory' }), true);
});

test('safeEntryFilter: 拒绝绝对路径（POSIX 与 Windows）', () => {
  assert.strictEqual(safeEntryFilter('/etc/passwd', { type: 'File' }), false);
  assert.strictEqual(safeEntryFilter('\\windows\\x', { type: 'File' }), false);
  assert.strictEqual(safeEntryFilter('C:\\evil', { type: 'File' }), false);
  assert.strictEqual(safeEntryFilter('C:/evil', { type: 'File' }), false);
});

test('safeEntryFilter: 拒绝 .. 逃逸（含反斜杠变体）', () => {
  assert.strictEqual(safeEntryFilter('../evil', { type: 'File' }), false);
  assert.strictEqual(safeEntryFilter('a/../../evil', { type: 'File' }), false);
  assert.strictEqual(safeEntryFilter('a\\..\\..\\evil', { type: 'File' }), false);
});

test('safeEntryFilter: 拒绝符号链接与硬链接', () => {
  assert.strictEqual(safeEntryFilter('link', { type: 'SymbolicLink' }), false);
  assert.strictEqual(safeEntryFilter('link', { type: 'Link' }), false);
});

test('safeEntryFilter: 拒绝空路径', () => {
  assert.strictEqual(safeEntryFilter('', { type: 'File' }), false);
});

// ===== 安装 =====

test('installPlugin: 全链路（含 strip 顶层目录）', async () => {
  const body = await makeTarball({
    'plugin.json': GOOD_MANIFEST,
    'skills/demo/SKILL.md': '# demo skill',
    'agents/explore.md': '# explore',
    'rules/style.md': '# style',
  });

  const r = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(r.plugin.manifest.id, 'demo');
  assert.deepStrictEqual(r.plugin.contributes.skills, ['demo']);
  assert.deepStrictEqual(r.plugin.contributes.agents, ['explore']);
  assert.deepStrictEqual(r.plugin.contributes.rules, ['style']);

  // 文件确实落盘
  const dir = getPluginDir('demo');
  assert.ok(fs.existsSync(path.join(dir, 'plugin.json')));
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'demo', 'SKILL.md')));
});

test('installPlugin: 写入来源记录供审计', async () => {
  const body = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master', now: 1_700_000_000_000 });

  const meta = JSON.parse(fs.readFileSync(path.join(getPluginDir('demo'), '.install-meta.json'), 'utf-8'));
  assert.strictEqual(meta.repo, 'alice/demo');
  assert.strictEqual(meta.url, 'https://github.com/alice/demo');
  assert.strictEqual(meta.branch, 'master');
  assert.strictEqual(meta.installedAt, new Date(1_700_000_000_000).toISOString());
});

test('installPlugin: 可执行内容始终落盘，但插件默认未启用', async () => {
  const body = await makeTarball({
    'plugin.json': GOOD_MANIFEST,
    'providers/thing.js': 'module.exports = {}',
  });

  const r = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, true, r.error);
  assert.deepStrictEqual(r.plugin.contributes.providers, ['thing.js']);
  // 文件落盘了 —— 这样"启用"开关才能真正生效（旧实现不落盘，事后开启也加载不到）
  assert.ok(fs.existsSync(path.join(getPluginDir('demo'), 'providers', 'thing.js')));
  // 但默认不启用：装一个插件不该顺带执行第三方代码
  assert.strictEqual(isPluginEnabled('demo'), false);
});

test('installPlugin: 清单非法则拒绝且不落盘', async () => {
  const body = await makeTarball({ 'plugin.json': '{"name":"没有 id"}' });
  const r = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('清单无效'));
  assert.ok(!fs.existsSync(getPluginDir('demo')));
});

test('installPlugin: 无 plugin.json 则拒绝', async () => {
  const body = await makeTarball({ 'README.md': 'hi' });
  const r = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('清单无效'));
});

test('installPlugin: 拒绝 id 非法的清单（防目录逃逸）', async () => {
  const body = await makeTarball({ 'plugin.json': JSON.stringify({ id: '../evil', name: 'x' }) });
  const r = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('清单无效'));
  // 关键：不能在家目录里写出逃逸目录
  assert.ok(!fs.existsSync(path.join(FAKE_HOME, 'evil')));
});

test('installPlugin: 重复安装被拒绝，提示走「更新」', async () => {
  const body = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  const first = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(first.success, true);

  const second = await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(second.success, false);
  assert.ok(second.error.includes('已安装'));
});

// ===== 更新（覆盖安装）=====

test('installPlugin: upgrade=true 覆盖已安装', async () => {
  const v1 = await makeTarball({ 'plugin.json': JSON.stringify({ id: 'demo', name: '演示插件', version: '1.0.0' }) });
  const r1 = await installPlugin({ httpGet: httpWith(v1), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r1.success, true);
  assert.strictEqual(r1.upgraded, false);
  assert.strictEqual(r1.plugin.manifest.version, '1.0.0');

  const v2 = await makeTarball({ 'plugin.json': JSON.stringify({ id: 'demo', name: '演示插件', version: '2.0.0' }) });
  const r2 = await installPlugin({ httpGet: httpWith(v2), repo: 'alice/demo', branch: 'master', upgrade: true });
  assert.strictEqual(r2.success, true, r2.error);
  assert.strictEqual(r2.upgraded, true);
  assert.strictEqual(r2.plugin.manifest.version, '2.0.0');
});

test('installPlugin: 更新时保留用户的启用状态', async () => {
  const v1 = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  await installPlugin({ httpGet: httpWith(v1), repo: 'alice/demo', branch: 'master' });
  setPluginEnabled('demo', true);

  const v2 = await makeTarball({ 'plugin.json': JSON.stringify({ id: 'demo', name: '演示插件', version: '2.0.0' }) });
  await installPlugin({ httpGet: httpWith(v2), repo: 'alice/demo', branch: 'master', upgrade: true });

  // 用户信任过这个插件，不该因为更新就被重置成禁用
  assert.strictEqual(isPluginEnabled('demo'), true, '更新不应重置启用状态');
});

test('installPlugin: 更新会刷新来源记录里的版本', async () => {
  const v1 = await makeTarball({ 'plugin.json': JSON.stringify({ id: 'demo', name: 'X', version: '1.0.0' }) });
  await installPlugin({ httpGet: httpWith(v1), repo: 'alice/demo', branch: 'main', now: 1_000 });

  const v2 = await makeTarball({ 'plugin.json': JSON.stringify({ id: 'demo', name: 'X', version: '2.0.0' }) });
  await installPlugin({ httpGet: httpWith(v2), repo: 'alice/demo', branch: 'main', upgrade: true, now: 2_000 });

  const meta = JSON.parse(fs.readFileSync(path.join(getPluginDir('demo'), '.install-meta.json'), 'utf-8'));
  assert.strictEqual(meta.version, '2.0.0');
  assert.strictEqual(meta.installedAt, new Date(2_000).toISOString());
});

test('installPlugin: 清单非法时不覆盖已有版本（旧版不能被弄坏）', async () => {
  const good = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  await installPlugin({ httpGet: httpWith(good), repo: 'alice/demo', branch: 'master' });

  const bad = await makeTarball({ 'plugin.json': '{"name":"没有 id"}' });
  const r = await installPlugin({ httpGet: httpWith(bad), repo: 'alice/demo', branch: 'master', upgrade: true });
  assert.strictEqual(r.success, false);
  // 旧版本应完好无损
  assert.ok(fs.existsSync(path.join(getPluginDir('demo'), 'plugin.json')));
  const kept = JSON.parse(fs.readFileSync(path.join(getPluginDir('demo'), 'plugin.json'), 'utf-8'));
  assert.strictEqual(kept.id, 'demo');
});

test('installPlugin: HTTP 非 200 报错', async () => {
  const r = await installPlugin({ httpGet: httpWith(Buffer.alloc(0), 404), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('404'));
});

test('installPlugin: 空响应体报错', async () => {
  const r = await installPlugin({ httpGet: httpWith(Buffer.alloc(0), 200), repo: 'alice/demo', branch: 'master' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('为空'));
});

test('installPlugin: 非法 repo / branch 被拦在请求之前', async () => {
  const calls = [];
  const httpGet = httpWith(Buffer.alloc(0), 200, calls);

  const bad1 = await installPlugin({ httpGet, repo: 'no-slash', branch: 'master' });
  assert.strictEqual(bad1.success, false);
  assert.ok(bad1.error.includes('仓库标识非法'));

  const bad2 = await installPlugin({ httpGet, repo: 'a/b', branch: '../evil' });
  assert.strictEqual(bad2.success, false);
  assert.ok(bad2.error.includes('分支名非法'));

  assert.strictEqual(calls.length, 0, '校验失败时不应发出任何请求');
});

test('installPlugin: 网络异常报错', async () => {
  const r = await installPlugin({
    httpGet: async () => { throw new Error('net down'); },
    repo: 'alice/demo',
    branch: 'master',
  });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('下载失败'));
});

// ===== 列表 / 状态 / 卸载 =====

test('listInstalledPlugins: 空目录返回空数组', () => {
  assert.deepStrictEqual(listInstalledPlugins(), []);
});

test('listInstalledPlugins: 列出已装插件', async () => {
  const body = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });

  const list = listInstalledPlugins();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].manifest.id, 'demo');
  assert.strictEqual(list[0].manifest.name, '演示插件');
});

test('setPluginEnabled: 记录启用状态', () => {
  assert.strictEqual(setPluginEnabled('demo', true), true);
  assert.strictEqual(isPluginEnabled('demo'), true);
  assert.strictEqual(setPluginEnabled('demo', false), true);
  assert.strictEqual(isPluginEnabled('demo'), false);
});

test('setPluginEnabled: 拒绝非法 id', () => {
  assert.strictEqual(setPluginEnabled('../evil', true), false);
});

test('uninstallPlugin: 删除目录并清理状态', async () => {
  const body = await makeTarball({ 'plugin.json': GOOD_MANIFEST, 'providers/x.js': 'x' });
  await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  setPluginEnabled('demo', true);

  const r = uninstallPlugin('demo');
  assert.strictEqual(r.success, true, r.error);
  assert.ok(!fs.existsSync(getPluginDir('demo')));
  assert.strictEqual(isPluginEnabled('demo'), false, '启用状态应一并清除');
  assert.deepStrictEqual(listInstalledPlugins(), []);
});

test('uninstallPlugin: 未安装时报错', () => {
  const r = uninstallPlugin('nope');
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('未安装'));
});

test('uninstallPlugin: 拒绝非法 id', () => {
  const r = uninstallPlugin('../evil');
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('非法'));
});

test('installPlugin: 不残留临时目录', async () => {
  const body = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cuckoo-plugin-stage-'));
  assert.deepStrictEqual(leftovers, [], '临时目录应被清理: ' + leftovers.join(', '));
});

test('installPlugin: plugins 根目录被正确创建', async () => {
  assert.ok(!fs.existsSync(getPluginsDir()));
  const body = await makeTarball({ 'plugin.json': GOOD_MANIFEST });
  await installPlugin({ httpGet: httpWith(body), repo: 'alice/demo', branch: 'master' });
  assert.ok(fs.existsSync(getPluginsDir()));
});

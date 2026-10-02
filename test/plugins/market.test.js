'use strict';
/**
 * 插件市场测试（纯逻辑，注入假 HTTP 传输层，不需要 electron）
 *
 * 核心断言：**空结果 = 成功 + 空列表**，不是错误。
 * 这是本模块的设计要点 —— topic 没内容时如实反映，不伪造来源。
 */
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  buildSearchUrl,
  normalizeRepo,
  searchPlugins,
  fetchRemoteManifests,
  CACHE_TTL_MS,
  MANIFEST_CACHE_TTL_MS,
} from '../../src/plugins/market.js';

const TMP = path.join(os.tmpdir(), 'cuckoo-plugin-market-test');
const FAKE_HOME = path.join(TMP, 'home');
const CACHE_FILE = path.join(TMP, 'cache.json');

let oldHome;

beforeEach(() => {
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
});

/** 造一个 GitHub 响应 */
function ghResponse(items, extra) {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({ total_count: items.length, incomplete_results: false, items, ...(extra || {}) }),
  };
}

/**
 * 真实传输层返回 body 为 Buffer（tarball 是二进制，不能按 utf-8 解码）。
 * 测试里用字符串写 body 更易读，这里统一补齐。
 */
function withBufferBody(r) {
  if (!r || Buffer.isBuffer(r.body)) return r;
  return { ...r, body: Buffer.from(r.body == null ? '' : String(r.body), 'utf-8') };
}

function repo(fullName, over) {
  return {
    full_name: fullName,
    description: 'desc of ' + fullName,
    stargazers_count: 7,
    updated_at: '2026-10-01T00:00:00Z',
    html_url: 'https://github.com/' + fullName,
    default_branch: 'master',
    ...(over || {}),
  };
}

/** 记录调用的假传输层 */
function fakeHttp(response, calls) {
  return async (req) => {
    if (calls) calls.push(req);
    const r = typeof response === 'function' ? response(req) : response;
    return withBufferBody(r);
  };
}

// ===== URL =====

test('buildSearchUrl: 指向 topic:cuckoo-plugin', () => {
  const u = buildSearchUrl();
  assert.ok(u.startsWith('https://api.github.com/search/repositories?'));
  assert.ok(u.includes('q=topic%3Acuckoo-plugin'));
  assert.ok(u.includes('per_page=100'));
});

// ===== 归一化 =====

test('normalizeRepo: 正常字段', () => {
  const it = normalizeRepo(repo('alice/demo'));
  assert.strictEqual(it.id, 'alice/demo');
  assert.strictEqual(it.owner, 'alice');
  assert.strictEqual(it.name, 'demo');
  assert.strictEqual(it.stars, 7);
  assert.strictEqual(it.defaultBranch, 'master');
});

test('normalizeRepo: 缺字段时给出安全默认值', () => {
  const it = normalizeRepo({ full_name: 'a/b' });
  assert.strictEqual(it.description, '');
  assert.strictEqual(it.stars, 0);
  assert.strictEqual(it.updatedAt, '');
  assert.strictEqual(it.defaultBranch, '');
  assert.strictEqual(it.url, 'https://github.com/a/b');
});

test('normalizeRepo: 结构不符返回 null', () => {
  assert.strictEqual(normalizeRepo(null), null);
  assert.strictEqual(normalizeRepo({}), null);
  assert.strictEqual(normalizeRepo({ full_name: 'no-slash' }), null);
  assert.strictEqual(normalizeRepo({ full_name: 'a/b/c' }), null);
  assert.strictEqual(normalizeRepo({ full_name: '/b' }), null);
});

// ===== 空结果 = 成功（设计要点）=====

test('searchPlugins: 空结果是成功而非错误（不伪造来源）', async () => {
  const r = await searchPlugins({
    httpGet: fakeHttp(ghResponse([])),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(r.items, []);
  assert.strictEqual(r.error, undefined);
});

// ===== 正常搜索 =====

test('searchPlugins: 归一化并返回条目', async () => {
  const r = await searchPlugins({
    httpGet: fakeHttp(ghResponse([repo('alice/demo'), repo('bob/tool')])),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.items.length, 2);
  assert.deepStrictEqual(r.items.map((x) => x.id), ['alice/demo', 'bob/tool']);
  assert.strictEqual(r.fromCache, false);
});

test('searchPlugins: 丢弃结构不符的条目并去重', async () => {
  const r = await searchPlugins({
    httpGet: fakeHttp(ghResponse([repo('alice/demo'), { bogus: 1 }, repo('alice/demo')])),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].id, 'alice/demo');
});

test('searchPlugins: 带 token 时发 Authorization 头', async () => {
  const calls = [];
  await searchPlugins({
    httpGet: fakeHttp(ghResponse([]), calls),
    token: 'ghp_secret',
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer ghp_secret');
  assert.ok(calls[0].headers.Accept.includes('github'));
});

test('searchPlugins: 无 token 时不发 Authorization 头', async () => {
  const calls = [];
  await searchPlugins({ httpGet: fakeHttp(ghResponse([]), calls), cacheFile: CACHE_FILE });
  assert.strictEqual(calls[0].headers.Authorization, undefined);
});

// ===== 缓存 =====

test('searchPlugins: 命中缓存的二次调用不再发起请求', async () => {
  const calls = [];
  const httpGet = fakeHttp(ghResponse([repo('alice/demo')]), calls);

  const first = await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 });
  assert.strictEqual(first.fromCache, false);
  assert.strictEqual(calls.length, 1);

  const second = await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 + 1000 });
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.items.length, 1);
  assert.strictEqual(calls.length, 1, '缓存有效期内不应再打接口');
});

test('searchPlugins: 缓存过期后重新请求', async () => {
  const calls = [];
  const httpGet = fakeHttp(ghResponse([repo('alice/demo')]), calls);

  await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 });
  await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 + CACHE_TTL_MS + 1 });
  assert.strictEqual(calls.length, 2);
});

test('searchPlugins: force 跳过缓存', async () => {
  const calls = [];
  const httpGet = fakeHttp(ghResponse([repo('alice/demo')]), calls);

  await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 });
  const r = await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_001, force: true });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(r.fromCache, false);
});

test('searchPlugins: 空结果也会被缓存（避免反复空打）', async () => {
  const calls = [];
  const httpGet = fakeHttp(ghResponse([]), calls);
  await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 });
  const r = await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_001 });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(r.fromCache, true);
  assert.deepStrictEqual(r.items, []);
});

test('searchPlugins: 缓存文件损坏按未命中处理', async () => {
  fs.writeFileSync(CACHE_FILE, '{ broken', 'utf-8');
  const calls = [];
  const r = await searchPlugins({
    httpGet: fakeHttp(ghResponse([repo('alice/demo')]), calls),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(r.items.length, 1);
});

// ===== 限流 =====

test('searchPlugins: 403 限流给出带剩余秒数的提示', async () => {
  const now = 1_000_000_000;
  const r = await searchPlugins({
    httpGet: fakeHttp({ status: 403, headers: { 'x-ratelimit-reset': String(now / 1000 + 42) }, body: '{}' }),
    cacheFile: CACHE_FILE,
    now,
  });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('限流'));
  assert.ok(r.error.includes('42'), '应回显剩余秒数，实际: ' + r.error);
});

test('searchPlugins: 403 但有旧缓存时退回缓存并带提示', async () => {
  // 先写一份有效缓存（用旧时间戳使其过期）
  const httpGet = fakeHttp(ghResponse([repo('alice/demo')]));
  await searchPlugins({ httpGet, cacheFile: CACHE_FILE, now: 1_000_000 });

  const r = await searchPlugins({
    httpGet: fakeHttp({ status: 429, headers: {}, body: '{}' }),
    cacheFile: CACHE_FILE,
    now: 1_000_000 + CACHE_TTL_MS + 1,
  });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.fromCache, true);
  assert.strictEqual(r.items.length, 1);
  assert.ok(r.error.includes('限流'));
});

// ===== 其它失败 =====

test('searchPlugins: 网络异常返回失败并报因', async () => {
  const r = await searchPlugins({
    httpGet: async () => { throw new Error('boom'); },
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.success, false);
  assert.deepStrictEqual(r.items, []);
  assert.ok(r.error.includes('boom'));
});

test('searchPlugins: 非 200 返回失败', async () => {
  const r = await searchPlugins({
    httpGet: fakeHttp({ status: 500, headers: {}, body: '' }),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('500'));
});

test('searchPlugins: 响应非法 JSON 返回失败', async () => {
  const r = await searchPlugins({
    httpGet: fakeHttp({ status: 200, headers: {}, body: 'not json' }),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('响应解析失败'));
});

test('searchPlugins: items 缺失时按空列表处理（成功）', async () => {
  const r = await searchPlugins({
    httpGet: fakeHttp({ status: 200, headers: {}, body: '{"total_count":0}' }),
    cacheFile: CACHE_FILE,
  });
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(r.items, []);
});

// ===== normalizeRepo：卡片要用的元信息 =====

test('normalizeRepo: 解析语言 / 许可证 / forks / 推送时间 / 归档 / topics', () => {
  const it = normalizeRepo(repo('alice/demo', {
    language: 'JavaScript',
    license: { spdx_id: 'MIT' },
    forks_count: 12,
    pushed_at: '2026-10-01T12:00:00Z',
    archived: true,
    topics: ['cuckoo-plugin', 'ai'],
  }));
  assert.strictEqual(it.language, 'JavaScript');
  assert.strictEqual(it.license, 'MIT');
  assert.strictEqual(it.forks, 12);
  assert.strictEqual(it.pushedAt, '2026-10-01T12:00:00Z');
  assert.strictEqual(it.archived, true);
  assert.deepStrictEqual(it.topics, ['cuckoo-plugin', 'ai']);
});

test('normalizeRepo: 新字段缺失时安全兜底', () => {
  const it = normalizeRepo({ full_name: 'a/b' });
  assert.strictEqual(it.language, '');
  assert.strictEqual(it.license, '');
  assert.strictEqual(it.forks, 0);
  assert.strictEqual(it.pushedAt, '');
  assert.strictEqual(it.archived, false);
  assert.deepStrictEqual(it.topics, []);
});

test('normalizeRepo: license 为 null / 结构异常时不炸', () => {
  assert.strictEqual(normalizeRepo(repo('a/b', { license: null })).license, '');
  assert.strictEqual(normalizeRepo(repo('a/b', { license: 'MIT' })).license, '');
  assert.strictEqual(normalizeRepo(repo('a/b', { license: {} })).license, '');
});

test('normalizeRepo: topics 里的非字符串被剔除', () => {
  const it = normalizeRepo(repo('a/b', { topics: ['ok', 1, null, ''] }));
  assert.deepStrictEqual(it.topics, ['ok']);
});

// ===== 远端 plugin.json =====

const MANIFEST_CACHE = path.join(TMP, 'manifest-cache.json');

/** 按 URL 路由的假传输层 */
function rawHttp(handler, calls) {
  return async (req) => {
    if (calls) calls.push(req.url);
    return withBufferBody(handler(req.url));
  };
}

/** 默认：任何 repo 都返回给定清单 */
function manifestHttp(manifest, calls) {
  return rawHttp(() => ({ status: 200, headers: {}, body: JSON.stringify(manifest) }), calls);
}

test('fetchRemoteManifests: 拉取并解读版本 / 最低应用版本', async () => {
  const httpGet = manifestHttp({ id: 'zhipu', name: '智谱清言', version: '1.2.3', minAppVersion: '0.8.7' });
  const r = await fetchRemoteManifests({
    httpGet,
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  const info = r['alice/demo'];
  assert.strictEqual(info.ok, true);
  assert.strictEqual(info.version, '1.2.3');
  assert.strictEqual(info.minAppVersion, '0.8.7');
  assert.strictEqual(info.name, '智谱清言');
});

test('fetchRemoteManifests: 请求的是 raw 通道（不消耗 API 配额）', async () => {
  const calls = [];
  await fetchRemoteManifests({
    httpGet: manifestHttp({ id: 'a', name: 'A' }, calls),
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].startsWith('https://raw.githubusercontent.com/alice/demo/main/plugin.json'), calls[0]);
});

test('fetchRemoteManifests: 缓存命中时不重复请求', async () => {
  const calls = [];
  const httpGet = manifestHttp({ id: 'a', name: 'A', version: '1.0.0' }, calls);
  const targets = [{ repo: 'alice/demo', branch: 'main' }];

  await fetchRemoteManifests({ httpGet, targets, cacheFile: MANIFEST_CACHE, now: 1_000_000 });
  assert.strictEqual(calls.length, 1);

  const r = await fetchRemoteManifests({ httpGet, targets, cacheFile: MANIFEST_CACHE, now: 1_000_001 });
  assert.strictEqual(calls.length, 1, 'TTL 内不应再请求');
  assert.strictEqual(r['alice/demo'].version, '1.0.0');
});

test('fetchRemoteManifests: 缓存过期后重新请求', async () => {
  const calls = [];
  const httpGet = manifestHttp({ id: 'a', name: 'A' }, calls);
  const targets = [{ repo: 'alice/demo', branch: 'main' }];

  await fetchRemoteManifests({ httpGet, targets, cacheFile: MANIFEST_CACHE, now: 1_000_000 });
  await fetchRemoteManifests({ httpGet, targets, cacheFile: MANIFEST_CACHE, now: 1_000_000 + MANIFEST_CACHE_TTL_MS + 1 });
  assert.strictEqual(calls.length, 2);
});

test('fetchRemoteManifests: 单条失败只影响该条（逐条降级）', async () => {
  const httpGet = rawHttp((url) => {
    if (url.includes('alice/broken')) return { status: 404, headers: {}, body: '' };
    return { status: 200, headers: {}, body: JSON.stringify({ id: 'ok', name: 'OK', version: '1.0.0' }) };
  });
  const r = await fetchRemoteManifests({
    httpGet,
    targets: [{ repo: 'alice/ok', branch: 'main' }, { repo: 'alice/broken', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(r['alice/ok'].ok, true);
  assert.strictEqual(r['alice/broken'].ok, false);
  assert.ok(r['alice/broken'].error.includes('plugin.json'));
});

test('fetchRemoteManifests: 非法 repo / branch 不发请求', async () => {
  const calls = [];
  const httpGet = manifestHttp({ id: 'a', name: 'A' }, calls);
  const r = await fetchRemoteManifests({
    httpGet,
    targets: [
      { repo: '../evil', branch: 'main' },
      { repo: 'alice/demo', branch: '../evil' },
      { repo: 'no-slash', branch: 'main' },
    ],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(calls.length, 0, '非法输入不应发出任何请求');
  assert.strictEqual(r['../evil'].ok, false);
  assert.strictEqual(r['alice/demo'].ok, false);
});

test('fetchRemoteManifests: 网络异常不抛错，逐条记原因', async () => {
  const r = await fetchRemoteManifests({
    httpGet: async () => { throw new Error('net down'); },
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(r['alice/demo'].ok, false);
  assert.ok(r['alice/demo'].error.includes('net down'));
});

test('fetchRemoteManifests: plugin.json 非法 JSON / 清单无效', async () => {
  const bad = await fetchRemoteManifests({
    httpGet: rawHttp(() => ({ status: 200, headers: {}, body: '{ not json' })),
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(bad['alice/demo'].ok, false);
  assert.ok(bad['alice/demo'].error.includes('JSON'));

  const invalid = await fetchRemoteManifests({
    httpGet: rawHttp(() => ({ status: 200, headers: {}, body: '{"name":"没有 id"}' })),
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: path.join(TMP, 'manifest-cache2.json'),
  });
  assert.strictEqual(invalid['alice/demo'].ok, false);
  assert.ok(invalid['alice/demo'].error.includes('id'));
});

test('fetchRemoteManifests: 同一 repo 只请求一次（去重）', async () => {
  const calls = [];
  await fetchRemoteManifests({
    httpGet: manifestHttp({ id: 'a', name: 'A' }, calls),
    targets: [
      { repo: 'alice/demo', branch: 'main' },
      { repo: 'alice/demo', branch: 'main' },
    ],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(calls.length, 1);
});

test('fetchRemoteManifests: 空目标返回空映射', async () => {
  const r = await fetchRemoteManifests({ httpGet: async () => { throw new Error('不应被调用'); }, targets: [], cacheFile: MANIFEST_CACHE });
  assert.deepStrictEqual(r, {});
});

test('fetchRemoteManifests: 缺 version / minAppVersion 时给空串而非 undefined', async () => {
  const r = await fetchRemoteManifests({
    httpGet: manifestHttp({ id: 'a', name: 'A' }),
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(r['alice/demo'].version, '');
  assert.strictEqual(r['alice/demo'].minAppVersion, '');
});

test('fetchRemoteManifests: 缓存文件损坏时按未命中处理', async () => {
  fs.writeFileSync(MANIFEST_CACHE, '{ broken', 'utf-8');
  const calls = [];
  const r = await fetchRemoteManifests({
    httpGet: manifestHttp({ id: 'a', name: 'A', version: '9.9.9' }, calls),
    targets: [{ repo: 'alice/demo', branch: 'main' }],
    cacheFile: MANIFEST_CACHE,
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(r['alice/demo'].version, '9.9.9');
});

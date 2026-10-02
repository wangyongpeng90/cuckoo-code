/**
 * 插件市场：GitHub topic 搜索
 *
 * **唯一真相源是 `topic:cuckoo-plugin`。**
 * 搜索为空就如实返回空列表 —— 不做关键词兜底、不做官方精选清单。
 * 理由（设计评审结论）：非 topic 来源会在用户和事实之间插一层假象，
 * 且会造出一条不受 topic 协议管理的隐藏分发通道。宁可诚实地空。
 *
 * 本模块不依赖 electron：HTTP 通过注入的 `HttpGet` 使用（见 http.ts），
 * 缓存/归一化/限流解析都是纯逻辑，可在 vitest 直接测。
 *
 * 限流（实测未认证）：
 *  - Search API：10 次/分钟  → 10 分钟本地缓存是必需项，不是优化项
 *  - 配置 GITHUB_TOKEN 可提升到 30 次/分钟
 */
import fs from 'node:fs';
import path from 'node:path';
import { getMarketCacheFile, getMarketConfigFile, getManifestCacheFile } from './paths.js';
import { validateManifest } from './manifest.js';
import { isValidRepo, isValidBranch, buildRawFileUrl } from './github.js';
import type { HttpGet } from './http.js';
import type { MarketItem, RemotePluginInfo } from './types.js';

const SEARCH_ENDPOINT = 'https://api.github.com/search/repositories';
const TOPIC = 'cuckoo-plugin';

/** 缓存有效期：10 分钟（对齐 Search API 10/min 的未认证限流窗口） */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** GitHub 单页上限 */
const PER_PAGE = 100;

/** 缓存文件结构 */
interface MarketCache {
  cachedAt: string;
  items: MarketItem[];
}

/** 搜索结果 */
export interface MarketResult {
  success: boolean;
  items: MarketItem[];
  fromCache: boolean;
  cachedAt?: string;
  /** 命中限流时的可读提示 */
  error?: string;
}

/** 构造搜索 URL（导出供测试断言） */
function buildSearchUrl(): string {
  const q = encodeURIComponent('topic:' + TOPIC);
  // 按最近更新排序：插件过时是负担，活跃度比 star 数更该优先暴露
  return SEARCH_ENDPOINT + '?q=' + q + '&sort=updated&order=desc&per_page=' + PER_PAGE;
}

/** 读取市场配置（可选 GitHub token） */
function readMarketToken(): string | undefined {
  try {
    const file = getMarketConfigFile();
    if (!fs.existsSync(file)) return undefined;
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const token = cfg && typeof cfg.token === 'string' ? cfg.token.trim() : '';
    return token || undefined;
  } catch {
    return undefined; // 配置坏了不该让市场整体不可用
  }
}

/** 把一个 GitHub repo 对象归一化为 MarketItem；结构不符则返回 null */
function normalizeRepo(repo: any): MarketItem | null {
  if (!repo || typeof repo !== 'object') return null;
  const fullName = typeof repo.full_name === 'string' ? repo.full_name.trim() : '';
  if (!fullName) return null;
  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  // 字段全部做类型兜底：GitHub 偶尔省略字段，缺一个不该让整条消失
  const license = repo.license && typeof repo.license === 'object' && typeof repo.license.spdx_id === 'string'
    ? repo.license.spdx_id
    : '';

  return {
    id: fullName,
    owner: parts[0],
    name: parts[1],
    description: typeof repo.description === 'string' ? repo.description : '',
    stars: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0,
    forks: typeof repo.forks_count === 'number' ? repo.forks_count : 0,
    updatedAt: typeof repo.updated_at === 'string' ? repo.updated_at : '',
    pushedAt: typeof repo.pushed_at === 'string' ? repo.pushed_at : '',
    url: typeof repo.html_url === 'string' ? repo.html_url : 'https://github.com/' + fullName,
    defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch : '',
    language: typeof repo.language === 'string' ? repo.language : '',
    license,
    archived: repo.archived === true,
    topics: Array.isArray(repo.topics)
      ? repo.topics.filter((t: any) => typeof t === 'string' && t)
      : [],
  };
}

function readCache(file: string): MarketCache | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.items)) return null;
    if (typeof raw.cachedAt !== 'string') return null;
    return { cachedAt: raw.cachedAt, items: raw.items.filter((x: any) => x && typeof x.id === 'string') };
  } catch {
    return null; // 缓存损坏按未命中处理
  }
}

function writeCache(file: string, items: MarketItem[], now: number): string {
  const cachedAt = new Date(now).toISOString();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ cachedAt, items }, null, 2), 'utf-8');
  } catch {
    // 缓存写失败不影响本次结果
  }
  return cachedAt;
}

/** 命中限流时生成可读提示（带 reset 剩余秒数） */
function rateLimitMessage(status: number, headers: Record<string, string>, now: number): string {
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(reset) && reset > 0) {
    const secs = Math.max(0, Math.ceil(reset - now / 1000));
    return 'GitHub 接口限流（HTTP ' + status + '），约 ' + secs + ' 秒后重试';
  }
  return 'GitHub 接口限流（HTTP ' + status + '），请稍后重试';
}

/**
 * 搜索主题为 `cuckoo-plugin` 的仓库。
 *
 * @param opts.httpGet 注入的传输层（app 层传 Electron net 实现）
 * @param opts.force   跳过缓存读取（仍会写缓存）
 * @param opts.now     当前时间戳（可注入，便于测试）
 * @param opts.cacheFile 缓存文件路径（可注入，便于测试）
 */
async function searchPlugins(opts: {
  httpGet: HttpGet;
  token?: string;
  force?: boolean;
  now?: number;
  cacheFile?: string;
}): Promise<MarketResult> {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const cacheFile = opts.cacheFile || getMarketCacheFile();

  if (!opts.force) {
    const cache = readCache(cacheFile);
    if (cache) {
      const age = now - Date.parse(cache.cachedAt);
      if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
        return { success: true, items: cache.items, fromCache: true, cachedAt: cache.cachedAt };
      }
    }
  }

  const token = opts.token !== undefined ? opts.token : readMarketToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await opts.httpGet({ url: buildSearchUrl(), headers });
  } catch (err: any) {
    // 网络不可达时，退回旧缓存（有总比空好），但如实标注来自缓存
    const stale = readCache(cacheFile);
    if (stale) {
      return { success: true, items: stale.items, fromCache: true, cachedAt: stale.cachedAt,
        error: '网络请求失败，展示上次缓存：' + (err && err.message ? err.message : String(err)) };
    }
    return { success: false, items: [], fromCache: false,
      error: '网络请求失败：' + (err && err.message ? err.message : String(err)) };
  }

  if (res.status === 403 || res.status === 429) {
    const stale = readCache(cacheFile);
    const msg = rateLimitMessage(res.status, res.headers, now);
    if (stale) {
      return { success: true, items: stale.items, fromCache: true, cachedAt: stale.cachedAt, error: msg };
    }
    return { success: false, items: [], fromCache: false, error: msg };
  }

  if (res.status !== 200) {
    return { success: false, items: [], fromCache: false,
      error: 'GitHub 返回 HTTP ' + res.status };
  }

  let parsed: any;
  try {
    // body 是原始字节，文本接口自行解码
    parsed = JSON.parse(res.body ? res.body.toString('utf-8') : '');
  } catch (err: any) {
    return { success: false, items: [], fromCache: false, error: '响应解析失败：' + (err && err.message ? err.message : String(err)) };
  }

  const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  const items: MarketItem[] = [];
  const seen = new Set<string>();
  for (const r of rawItems) {
    const item = normalizeRepo(r);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  // 空结果**照实缓存与返回** —— 这就是 topic 的真实状态
  const cachedAt = writeCache(cacheFile, items, now);
  return { success: true, items, fromCache: false, cachedAt };
}

// ========== 远端 plugin.json（版本 / 最低应用版本）==========

/**
 * GitHub 搜索接口**不返回**插件自身的版本与兼容要求 —— 它们在 plugin.json 里。
 * 这里走 raw.githubusercontent（CDN，**不消耗 API 配额**）单独拉取。
 *
 * 缓存 TTL 比市场列表长：插件版本变动远比仓库活跃度低，
 * 没必要每次刷新市场都重拉一遍。
 */
const MANIFEST_CACHE_TTL_MS = 30 * 60 * 1000;

/** 单次拉取超时：宁可快失败也不要拖住整个市场列表 */
const MANIFEST_TIMEOUT_MS = 8000;

/** 并发上限：避免一次刷新打出一串请求 */
const MANIFEST_CONCURRENCY = 4;

interface ManifestCache {
  cachedAt: string;
  entries: Record<string, RemotePluginInfo>;
}

function readManifestCache(file: string): ManifestCache | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') return null;
    if (typeof raw.cachedAt !== 'string') return null;
    return { cachedAt: raw.cachedAt, entries: raw.entries };
  } catch {
    return null;
  }
}

/** 带并发上限的 map，保持输入顺序 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

/** 拉取单个仓库的 plugin.json 并解读 */
async function fetchOneManifest(
  httpGet: HttpGet,
  repo: string,
  branch: string
): Promise<RemotePluginInfo> {
  const base: RemotePluginInfo = {
    repo, ok: false, version: '', minAppVersion: '', name: '', description: '',
  };

  if (!isValidRepo(repo) || !isValidBranch(branch)) {
    return { ...base, error: '仓库或分支非法' };
  }

  let res;
  try {
    res = await httpGet({
      url: buildRawFileUrl(repo, branch, 'plugin.json'),
      timeoutMs: MANIFEST_TIMEOUT_MS,
    });
  } catch (err: any) {
    return { ...base, error: (err && err.message) ? err.message : String(err) };
  }

  if (res.status === 404) return { ...base, error: '仓库根目录没有 plugin.json' };
  if (res.status !== 200) return { ...base, error: 'HTTP ' + res.status };

  let parsed: any;
  try {
    parsed = JSON.parse(res.body ? res.body.toString('utf-8') : '');
  } catch {
    return { ...base, error: 'plugin.json 不是合法 JSON' };
  }

  const vr = validateManifest(parsed);
  if (!vr.ok || !vr.manifest) return { ...base, error: vr.error || '清单无效' };

  return {
    repo,
    ok: true,
    version: vr.manifest.version || '',
    minAppVersion: vr.manifest.minAppVersion || '',
    name: vr.manifest.name || '',
    description: vr.manifest.description || '',
  };
}

/**
 * 批量获取远端插件清单（带缓存 + 并发限制 + 逐条降级）。
 *
 * 单条失败**只影响该条** —— 返回 ok=false 与原因，不抛错、不中断其它条目。
 * 这样即使某台机器访问 raw.githubusercontent 受限（例如被 hosts 劫持），
 * 市场列表本身仍能正常显示。
 *
 * @returns repo → RemotePluginInfo 的映射
 */
async function fetchRemoteManifests(opts: {
  httpGet: HttpGet;
  targets: Array<{ repo: string; branch: string }>;
  now?: number;
  cacheFile?: string;
  concurrency?: number;
}): Promise<Record<string, RemotePluginInfo>> {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const cacheFile = opts.cacheFile || getManifestCacheFile();
  const out: Record<string, RemotePluginInfo> = {};

  const cache = readManifestCache(cacheFile);
  const cacheFresh = cache
    ? (now - Date.parse(cache.cachedAt)) >= 0 && (now - Date.parse(cache.cachedAt)) < MANIFEST_CACHE_TTL_MS
    : false;

  // 去重（同一 repo 可能来自多个条目）
  const wanted = new Map<string, string>();
  for (const t of opts.targets) {
    if (!t || !t.repo) continue;
    if (!wanted.has(t.repo)) wanted.set(t.repo, t.branch);
  }

  const toFetch: Array<{ repo: string; branch: string }> = [];
  for (const [repo, branch] of wanted) {
    const hit = cacheFresh && cache ? cache.entries[repo] : undefined;
    if (hit) out[repo] = hit;
    else toFetch.push({ repo, branch });
  }

  if (toFetch.length > 0) {
    const fetched = await mapWithConcurrency(
      toFetch,
      opts.concurrency && opts.concurrency > 0 ? opts.concurrency : MANIFEST_CONCURRENCY,
      (t) => fetchOneManifest(opts.httpGet, t.repo, t.branch)
    );
    for (const info of fetched) out[info.repo] = info;
  }

  // 合并旧缓存（保留未请求过的条目），只在有新结果时写
  if (toFetch.length > 0) {
    const merged: Record<string, RemotePluginInfo> = { ...(cache ? cache.entries : {}), ...out };
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ cachedAt: new Date(now).toISOString(), entries: merged }, null, 2), 'utf-8');
    } catch {
      // 缓存写失败不影响本次结果
    }
  }

  return out;
}

export {
  TOPIC,
  CACHE_TTL_MS,
  PER_PAGE,
  MANIFEST_CACHE_TTL_MS,
  buildSearchUrl,
  normalizeRepo,
  readMarketToken,
  searchPlugins,
  fetchRemoteManifests,
};

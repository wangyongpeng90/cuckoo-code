/**
 * SkillHub 市场客户端（https://skillhub.cn）
 *
 * 纯 HTTP API，不走 CLI。接口：
 *  - 搜索：GET https://api.skillhub.cn/api/skills?page=1&pageSize=24&sortBy=score&order=desc&keyword=<词>
 *  - 详情：GET https://api.skillhub.cn/api/v1/skills/{slug}?namespace={ns}
 *  - 下载：GET https://api.skillhub.cn/api/v1/download?slug=@{ns}/{slug}（Zip）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const API_BASE = 'https://api.skillhub.cn';

/** 带 UA 的 GET（部分接口对无 UA 请求返回 405） */
async function httpGet(url: string, opts: { binary?: boolean } = {}): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CuckooCode/1.0',
      'Accept': opts.binary ? '*/*' : 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  if (opts.binary) return Buffer.from(await res.arrayBuffer());
  return res.json();
}

/**
 * 搜索技能。
 * @param keyword 关键词
 * @param page 页码（1 起）
 * @param pageSize 每页条数
 */
async function searchSkills(keyword: string, page = 1, pageSize = 24): Promise<any> {
  const url = API_BASE + '/api/skills?page=' + page + '&pageSize=' + pageSize +
    '&sortBy=score&order=desc&keyword=' + encodeURIComponent(keyword || '');
  const json = await httpGet(url);
  const skills = (json && json.data && json.data.skills) || [];
  return {
    total: (json && json.data && json.data.total) || 0,
    skills: skills.map((s: any) => ({
      slug: s.slug,
      namespace: s.namespace && s.namespace.handle,
      canonicalName: s.namespace && s.namespace.canonicalName,
      name: s.name,
      summary: s.description_zh || s.description || '',
      category: s.category,
      subCategories: (s.subCategories || []).map((c: any) => c.name),
      iconUrl: s.iconUrl,
      downloads: s.downloads,
      installs: s.installs,
      stars: s.stars,
      version: s.version,
      verified: s.verified,
      publisher: s.publisher ? s.publisher.name : s.ownerName,
    })),
  };
}

/**
 * 获取技能详情。
 * @param slug 技能 slug
 * @param namespace 命名空间 handle
 */
async function getSkillDetail(slug: string, namespace: string): Promise<any> {
  const url = API_BASE + '/api/v1/skills/' + encodeURIComponent(slug) +
    '?namespace=' + encodeURIComponent(namespace);
  const json = await httpGet(url);
  const skill = (json && json.skill) || {};
  const latest = (json && json.latestVersion) || {};
  return {
    slug,
    namespace,
    name: skill.displayName || skill.slug,
    summary: skill.summary_zh || skill.summary || '',
    category: skill.category,
    subCategories: (skill.subCategories || []).map((c: any) => c.name),
    tags: skill.tags ? Object.keys(skill.tags) : [],
    iconUrl: skill.iconUrl,
    stats: skill.stats || {},
    version: latest.version,
    changelog: latest.changelog,
    owner: json.owner || {},
    publisher: json.publisher || {},
    security: json.securityReports || {},
  };
}

/**
 * 下载技能 Zip 包到临时目录并解压。
 * @param slug 技能 slug
 * @param namespace 命名空间 handle
 * @returns 解压后的临时目录（含 SKILL.md）
 */
async function downloadAndExtract(slug: string, namespace: string): Promise<string> {
  const fullSlug = '@' + namespace + '/' + slug;
  const url = API_BASE + '/api/v1/download?slug=' + encodeURIComponent(fullSlug);
  const buf = await httpGet(url, { binary: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-skill-'));
  const zipPath = path.join(tmpDir, 'skill.zip');
  fs.writeFileSync(zipPath, buf);

  const extractDir = path.join(tmpDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });
  await unzip(zipPath, extractDir);

  // 找到含 SKILL.md 的目录（可能在根，也可能在一层子目录）
  const found = findSkillRoot(extractDir);
  if (!found) throw new Error('技能包中未找到 SKILL.md');
  return found;
}

/** 在解压目录中查找含 SKILL.md 的根目录 */
function findSkillRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(dir, ent.name);
    if (fs.existsSync(path.join(sub, 'SKILL.md'))) return sub;
  }
  return null;
}

/** 用 PowerShell 的 Expand-Archive 解压（Windows 无外部依赖） */
async function unzip(zipPath: string, destDir: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const ps = 'Expand-Archive -LiteralPath ' + psQuote(zipPath) +
      ' -DestinationPath ' + psQuote(destDir) + ' -Force';
    execFile('powershell', ['-NoProfile', '-Command', ps], (err: any) => {
      if (err) reject(new Error('解压失败: ' + err.message));
      else resolve();
    });
  });
}

/** PowerShell 单引号字符串转义 */
function psQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

export { searchSkills, getSkillDetail, downloadAndExtract };

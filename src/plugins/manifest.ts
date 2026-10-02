/**
 * 插件清单解析与校验（plugin.json）
 *
 * 纯 JSON.parse，零依赖。容错策略对齐 skills/scanner：
 * 非法则**明确报因并跳过**（不静默、不猜测）。
 *
 * 校验点（缺一不可）：
 *  - 是 JSON 对象
 *  - id 合法（小写 kebab-case；直接作为安装目录名，必须排除路径逃逸字符）
 *  - name 非空
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  isValidPluginId,
  getManifestPath,
  SKILLS_DIR,
  AGENTS_DIR,
  RULES_DIR,
  MCP_FILE,
  PROVIDERS_DIR,
} from './paths.js';
import type { PluginManifest, PluginContributes } from './types.js';

/** 解析结果：成功带 manifest，失败带可读原因 */
export interface ManifestResult {
  ok: boolean;
  manifest?: PluginManifest;
  error?: string;
}

/** 取字符串字段（trim 后非空才算有值） */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/**
 * 校验并规整清单对象。
 * @returns 成功返回 manifest，失败返回错误原因
 */
export function validateManifest(raw: unknown): ManifestResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '清单必须是 JSON 对象' };
  }
  const obj = raw as Record<string, unknown>;

  const id = str(obj.id);
  if (!id) return { ok: false, error: '缺少必填字段 id' };
  if (!isValidPluginId(id)) {
    return {
      ok: false,
      error: 'id 非法（须为小写 kebab-case：字母/数字开头，仅含 a-z 0-9 与 -，长度 ≤64）：' + id,
    };
  }

  const name = str(obj.name);
  if (!name) return { ok: false, error: '缺少必填字段 name' };

  return {
    ok: true,
    manifest: {
      id,
      name,
      version: str(obj.version),
      description: str(obj.description),
      author: str(obj.author),
      minAppVersion: str(obj.minAppVersion),
    },
  };
}

/** 从 JSON 文本解析清单 */
export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err: any) {
    return { ok: false, error: 'JSON 解析失败: ' + (err && err.message ? err.message : String(err)) };
  }
  return validateManifest(raw);
}

/** 读取目录下的 plugin.json 并校验 */
export function readManifest(dir: string): ManifestResult {
  const file = getManifestPath(dir);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err: any) {
    return { ok: false, error: '读取 plugin.json 失败: ' + (err && err.message ? err.message : String(err)) };
  }
  return parseManifest(text);
}

/** 列出一层子目录名（不存在则空数组） */
function listSubDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 列出一层的 .md 文件名（去掉扩展名）。agents 与 rules 都是扁平 .md。 */
function listMdNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name.replace(/\.md$/i, ''))
      .sort();
  } catch {
    return [];
  }
}

/** 列出目录下的 .js 文件（一层） */
function listJsFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.js'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 派生插件的实际贡献项。
 *
 * **由目录实际内容派生，而非读清单声明** —— 插件无法虚报自己提供了什么。
 * 也避免了"清单里写路径"带来的路径逃逸面。
 *
 * 三种扩展线的目录结构**并不相同**（对齐各自既有 scanner）：
 *  - skills：`skills/<name>/SKILL.md` —— 一层子目录，且必须有 SKILL.md
 *  - agents：`agents/<name>.md`       —— 扁平 .md 文件
 *  - rules ：`rules/<name>.md`        —— 扁平 .md 文件
 */
export function deriveContributes(dir: string): PluginContributes {
  // 只算真的能被 scanner 识别的：无 SKILL.md 的目录会被跳过，这里也不该计数
  const skills = listSubDirs(path.join(dir, SKILLS_DIR))
    .filter((name) => fs.existsSync(path.join(dir, SKILLS_DIR, name, 'SKILL.md')))
    .sort();

  return {
    skills,
    agents: listMdNames(path.join(dir, AGENTS_DIR)),
    rules: listMdNames(path.join(dir, RULES_DIR)),
    mcp: fs.existsSync(path.join(dir, MCP_FILE)),
    providers: listJsFiles(path.join(dir, PROVIDERS_DIR)),
  };
}

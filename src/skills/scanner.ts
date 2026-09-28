/**
 * 技能扫描：项目级 + 应用级 + 用户级目录 → SkillMeta[]
 *
 * 目录约定：
 *  - 项目级：`<projectDir>/.cuckoo/skills/<name>/SKILL.md`（目录式）
 *  - 应用级：`<userData>/skills/<id>/SKILL.md`（目录式，由界面管理）
 *  - 用户级：`~/.cuckoo/skills/<name>/SKILL.md`（目录式）
 *
 * 规则：
 *  - 目录式：只扫 skills 目录的**直接子目录**（一层），每个子目录里 SKILL.md 必须存在
 *  - 文件式：只扫 skills 目录的**直接 .md 文件**（一层）
 *  - 同名时优先级：项目级 > 应用级 > 用户级
 *  - 宽容：name 缺省取目录名/文件名，description 缺省取正文首段；YAML 解析失败则跳过
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { parseFrontmatter } from './frontmatter.js';
import type { SkillMeta, SkillSource } from './types.js';

const require = createRequire(import.meta.url);

/**
 * 惰性获取 userData 目录（<userData>/skills 的父目录）。
 * 依赖 electron.app；非 Electron 环境（如单测）返回 null，静默跳过应用级技能。
 */
function getUserDataDir(): string | null {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    return null;
  }
}

/** 解析 allowed-tools：优先空格分隔（开放标准），兼容逗号分隔 */
function parseAllowedTools(raw: string): string[] {
  if (!raw) return [];
  const parts = raw.indexOf(',') >= 0 ? raw.split(',') : raw.split(/\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** 从正文取首段（非空、非标题行）作为缺省 description */
function firstParagraph(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    return line;
  }
  return '';
}

/**
 * 扫描某个 .cuckoo/skills 目录下的所有技能。
 * @param baseDir 该作用域的基目录（项目根 或 用户主目录）
 * @param source 作用域来源
 */
function scanDir(baseDir: string, source: SkillSource): SkillMeta[] {
  const skillsDir = path.join(baseDir, '.cuckoo', 'skills');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return []; // 目录不存在或无权限，静默跳过
  }

  const result: SkillMeta[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(skillsDir, ent.name);
    const skillPath = path.join(dir, 'SKILL.md');
    let raw: string;
    try {
      raw = fs.readFileSync(skillPath, 'utf-8');
    } catch {
      continue; // 无 SKILL.md，跳过
    }

    const { data, body } = parseFrontmatter(raw);
    // 注意：data.name 为纯空白时是 truthy，需 trim 后判断，空则回退目录名
    const name = (data.name && data.name.trim()) || ent.name;
    const description = (data.description || firstParagraph(body)).trim();
    if (!name.trim() || !description) continue; // 无名或无描述 → 无法展示，跳过

    const whenToUse = data.when_to_use ? data.when_to_use.trim() : undefined;
    const allowedTools = data['allowed-tools'] ? parseAllowedTools(data['allowed-tools']) : undefined;

    result.push({
      name,
      description,
      whenToUse,
      allowedTools,
      skillPath,
      dir,
      source,
    });
  }
  return result;
}

/**
 * 扫描应用级技能：`<userData>/skills/<id>/SKILL.md`（目录式，由界面管理）。
 * 与项目级/用户级目录式布局一致。
 */
export function scanAppSkillsDir(skillsDir: string, source: SkillSource): SkillMeta[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return []; // 目录不存在，静默跳过
  }

  const result: SkillMeta[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(skillsDir, ent.name);
    const skillPath = path.join(dir, 'SKILL.md');
    let raw: string;
    try {
      raw = fs.readFileSync(skillPath, 'utf-8');
    } catch {
      continue; // 无 SKILL.md，跳过
    }

    const { data, body } = parseFrontmatter(raw);
    const name = (data.name && data.name.trim()) || ent.name;
    const description = (data.description || firstParagraph(body)).trim();
    if (!name.trim() || !description) continue;

    const whenToUse = data.when_to_use ? data.when_to_use.trim() : undefined;
    const allowedTools = data['allowed-tools'] ? parseAllowedTools(data['allowed-tools']) : undefined;

    result.push({
      name,
      description,
      whenToUse,
      allowedTools,
      skillPath,
      dir,
      source,
    });
  }
  return result;
}

/** 扫描用户级应用技能目录（<userData>/skills） */
function scanAppSkills(): SkillMeta[] {
  const userData = getUserDataDir();
  if (!userData) return []; // 非 Electron 环境（如单测）静默跳过
  return scanAppSkillsDir(path.join(userData, 'skills'), 'app');
}

/** 合并技能列表：同名时优先级 项目级 > 应用级 > 用户级 */
export function mergeSkills(project: SkillMeta[], app: SkillMeta[], user: SkillMeta[]): SkillMeta[] {
  const byName = new Map<string, SkillMeta>();
  for (const s of user) byName.set(s.name, s);
  for (const s of app) byName.set(s.name, s); // 应用级覆盖同名用户级
  for (const s of project) byName.set(s.name, s); // 项目级覆盖同名应用级/用户级
  return Array.from(byName.values());
}

/**
 * 扫描并合并技能。
 * 目录约定：
 *  - 项目级：`<projectDir>/.cuckoo/skills/<name>/SKILL.md`
 *  - 应用级：`<APP_ROOT>/skills/<id>.md`
 *  - 用户级：`~/.cuckoo/skills/<name>/SKILL.md`
 * @param projectDir 项目根目录（可为 null，表示未初始化项目）
 * @returns 合并后的技能列表（项目级 > 应用级 > 用户级）
 */
export function scanSkills(projectDir: string | null): SkillMeta[] {
  const user = scanDir(os.homedir(), 'user');
  const app = scanAppSkills();
  const project = projectDir ? scanDir(projectDir, 'project') : [];
  return mergeSkills(project, app, user);
}

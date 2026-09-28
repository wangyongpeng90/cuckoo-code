/**
 * 技能配置管理（应用级，存于 <APP_ROOT>/skills/）
 *
 * 技能按开放标准（agentskills.io）以**目录式**存储，每个技能一个目录：
 *   <userData>/skills/<id>/SKILL.md
 *   <userData>/skills/<id>/...（可含附属脚本/资源）
 *
 * 注：存于 userData（而非应用根目录）以保证打包后仍可写。
 *
 * SKILL.md 格式（标准 frontmatter + 正文）：
 *   ---
 *   name: 实训平台
 *   description: 国家开放大学实训平台的自动化操作流程...
 *   license: MIT
 *   allowed-tools: read bash pwsh
 *   ---
 *   技能指令正文...
 *
 * 说明：
 *  - name 为展示名（可含中文）；id 为 ASCII 目录名（安全、跨平台）
 *  - allowed-tools 按开放标准为空格分隔（兼容逗号分隔的旧写法）
 *  - 启用/禁用状态单独存 skills-state.json（不污染技能目录）：
 *      { "<id>": true, "<id2>": false }
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseFrontmatter } from './frontmatter.js';

const require = createRequire(import.meta.url);

/** userData 目录（开发=项目配置目录，打包=安装后配置目录），惰性获取避免测试环境顶层崩溃 */
function getUserDataDir(): string {
  const { app } = require('electron');
  return app.getPath('userData');
}

/** 技能存储目录：<userData>/skills */
function getSkillsDir(): string {
  return path.join(getUserDataDir(), 'skills');
}

/** 启用状态文件 */
function getStateFile(): string {
  return path.join(getUserDataDir(), 'skills-state.json');
}

/** 确保目录存在 */
function ensureDir(): void {
  try {
    fs.mkdirSync(getSkillsDir(), { recursive: true });
  } catch (err: any) {
    console.error('[Skills] 创建目录失败:', err.message);
  }
}

function readState(): Record<string, boolean> {
  try {
    const file = getStateFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err: any) {
    console.error('[Skills] 读取状态失败:', err.message);
  }
  return {};
}

function writeState(state: Record<string, boolean>): boolean {
  try {
    fs.writeFileSync(getStateFile(), JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error('[Skills] 写入状态失败:', err.message);
    return false;
  }
}

/** 目录名作为 id，做基本安全过滤（防路径穿越） */
function safeId(id: string): string {
  return String(id || '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 100);
}

/**
 * 由 name 生成 ASCII id（用于目录名）。
 * 含中文等非 ASCII 时回退到时间戳。
 */
function idFromName(name: string): string {
  const slug = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || ('skill-' + Date.now());
}

/** 单个技能目录 */
function skillDir(id: string): string {
  return path.join(getSkillsDir(), safeId(id));
}

/** 单个技能 SKILL.md 路径 */
function skillFile(id: string): string {
  return path.join(skillDir(id), 'SKILL.md');
}

/** 解析 allowed-tools：优先空格分隔（开放标准），兼容逗号分隔 */
function parseAllowedTools(raw: string): string[] {
  if (!raw) return [];
  const parts = raw.indexOf(',') >= 0 ? raw.split(',') : raw.split(/\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * 读取某个 SKILL.md 为技能定义。
 * @param skillMdPath SKILL.md 绝对路径
 * @param id 逻辑 id（目录名）
 */
function readSkillFile(skillMdPath: string, id: string): any | null {
  let raw: string;
  try {
    raw = fs.readFileSync(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  const name = (data.name && data.name.trim()) || id;
  const description = (data.description || '').trim();
  const allowedTools = data['allowed-tools'] ? parseAllowedTools(data['allowed-tools']) : undefined;
  return {
    id,
    name,
    description,
    license: data.license || '',
    allowedTools,
    whenToUse: data.when_to_use ? data.when_to_use.trim() : undefined,
    content: body.trim(),
    filePath: skillMdPath,
    dir: path.dirname(skillMdPath),
  };
}

/** 列出所有应用级技能（带 enabled 状态） */
function listSkills(): any[] {
  ensureDir();
  const state = readState();
  const dir = getSkillsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: any[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    const skill = readSkillFile(path.join(dir, id, 'SKILL.md'), id);
    if (!skill) continue;
    skill.enabled = state[id] !== false; // 默认启用
    result.push(skill);
  }
  return result;
}

/** 读取单个技能 */
function getSkill(id: string): any | null {
  const file = skillFile(id);
  if (!fs.existsSync(file)) return null;
  const skill = readSkillFile(file, safeId(id));
  if (!skill) return null;
  const state = readState();
  skill.enabled = state[safeId(id)] !== false;
  return skill;
}

/**
 * 新增或更新技能（写入 <id>/SKILL.md）。
 * @param skill { id?, name, description, license?, allowedTools?, content }
 * @returns 保存后的技能（含生成的 id）
 */
function upsertSkill(skill: any): any {
  ensureDir();
  const name = String(skill.name || '').trim();
  if (!name) throw new Error('技能名称不能为空');
  const description = String(skill.description || '').trim();
  if (!description) throw new Error('技能描述不能为空');
  const content = String(skill.content || '').trim();
  if (!content) throw new Error('技能正文不能为空');

  // id：优先用传入 id；否则由 name 生成 ASCII id
  let id = skill.id ? safeId(skill.id) : idFromName(name);
  if (!id) id = 'skill-' + Date.now();

  const lines: string[] = ['---', 'name: ' + name, 'description: ' + description];
  if (skill.license && String(skill.license).trim()) {
    lines.push('license: ' + String(skill.license).trim());
  }
  let tools: string[] = [];
  if (Array.isArray(skill.allowedTools)) {
    tools = skill.allowedTools.map((s: any) => String(s).trim()).filter(Boolean);
  } else if (skill.allowedTools) {
    tools = parseAllowedTools(String(skill.allowedTools));
  }
  if (tools.length) lines.push('allowed-tools: ' + tools.join(' '));
  lines.push('---', '', content, '');
  const text = lines.join('\n');

  const dir = skillDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text, 'utf-8');
  return getSkill(id);
}

/**
 * 从解压后的临时目录安装技能（保留全部附属文件）。
 * 把 srcDir 整体复制到 <skills>/<id>/。
 * @param srcDir 含 SKILL.md 的源目录
 * @param id 目标 id（目录名）；缺省从 SKILL.md 的 name 生成
 * @returns 安装后的技能
 */
function installSkillFromDir(srcDir: string, id?: string): any {
  ensureDir();
  const skillMd = path.join(srcDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) throw new Error('技能包缺少 SKILL.md');
  const { data } = parseFrontmatter(fs.readFileSync(skillMd, 'utf-8'));
  const name = (data.name && data.name.trim()) || path.basename(srcDir);
  let finalId = id ? safeId(id) : idFromName(name);
  if (!finalId) finalId = 'skill-' + Date.now();

  const destDir = skillDir(finalId);
  // 清空已存在的目标目录（覆盖安装）
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
  return getSkill(finalId);
}

/** 删除技能（整目录 + 状态） */
function removeSkill(id: string): boolean {
  const safe = safeId(id);
  const dir = skillDir(safe);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (err: any) {
    console.error('[Skills] 删除目录失败:', err.message);
    return false;
  }
  const state = readState();
  delete state[safe];
  writeState(state);
  return true;
}

/** 设置启用状态 */
function setSkillEnabled(id: string, enabled: boolean): boolean {
  const state = readState();
  state[safeId(id)] = !!enabled;
  return writeState(state);
}

export {
  getSkillsDir,
  getStateFile,
  listSkills,
  getSkill,
  upsertSkill,
  installSkillFromDir,
  removeSkill,
  setSkillEnabled,
};

/**
 * 技能开关状态（决定技能是否加入上下文）
 *
 * 与 MCP 一致：**状态与定义分离**，不修改 SKILL.md，避免污染技能本体。
 * 只记录**被显式关闭**的技能名，未记录的一律视为开启（默认开启，存量行为不变）。
 *
 * 存储路径：
 *  - 项目级技能：`<projectDir>/.cuckoo/skills-state.json`
 *  - 用户级 / 插件级技能：`~/.cuckoo/skills-state.json`（可用 CUCKOO_HOME 覆盖，供测试隔离）
 *
 * 格式：
 * ```json
 * { "disabled": ["skill-a", "skill-b"] }
 * ```
 *
 * 本模块**只依赖 node 内置**，不引入上层依赖（见 docs/arch/02-dependency.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SkillMeta, SkillSource } from './types.js';

/** 用户级目录（可用 CUCKOO_HOME 覆盖，供测试隔离） */
function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

function getUserStateFile(): string {
  return path.join(getUserDir(), 'skills-state.json');
}

function getProjectStateFile(projectDir: string): string {
  return path.join(projectDir, '.cuckoo', 'skills-state.json');
}

/** 读某状态文件的 disabled 集合（文件不存在或损坏时为空集） */
function readDisabled(file: string): Set<string> {
  try {
    if (!fs.existsSync(file)) return new Set();
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (raw && Array.isArray(raw.disabled)) {
      return new Set(raw.disabled.filter((x: any) => typeof x === 'string' && x));
    }
  } catch (err: any) {
    console.error('[Skills] 读取开关状态失败:', file, err.message);
  }
  return new Set();
}

/** 写某状态文件的 disabled 集合 */
function writeDisabled(file: string, set: Set<string>): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = { disabled: Array.from(set).sort() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error('[Skills] 写入开关状态失败:', file, err.message);
    return false;
  }
}

/** 合并的「已关闭」技能名集合（项目级 + 用户级，任一关闭即关闭） */
function getDisabledNames(projectDir: string | null): Set<string> {
  const merged = readDisabled(getUserStateFile());
  if (projectDir) {
    for (const n of readDisabled(getProjectStateFile(projectDir))) merged.add(n);
  }
  return merged;
}

/**
 * 技能是否启用（加入上下文）。
 * @param name 技能名
 * @param projectDir 项目根目录（可为 null）
 */
export function isSkillEnabled(name: string, projectDir: string | null): boolean {
  return !getDisabledNames(projectDir).has(name);
}

/**
 * 设置技能开关。
 * 状态跟着技能的**来源**走：项目级技能写项目级状态文件，用户级/插件级写用户级。
 * @param name 技能名
 * @param source 技能来源
 * @param projectDir 项目根目录（source=project 时必须提供）
 * @param enabled 是否启用
 */
export function setSkillEnabled(
  name: string,
  source: SkillSource,
  projectDir: string | null,
  enabled: boolean
): boolean {
  if (!name) return false;
  let file: string;
  if (source === 'project') {
    if (!projectDir) return false;
    file = getProjectStateFile(projectDir);
  } else {
    file = getUserStateFile();
  }
  const set = readDisabled(file);
  if (enabled) set.delete(name);
  else set.add(name);
  return writeDisabled(file, set);
}

/**
 * 过滤掉已关闭的技能（用于拼系统提示词等注入点）。
 * @param skills 扫描出的技能列表
 * @param projectDir 项目根目录（可为 null）
 */
export function filterEnabledSkills(skills: SkillMeta[], projectDir: string | null): SkillMeta[] {
  const disabled = getDisabledNames(projectDir);
  if (disabled.size === 0) return skills;
  return skills.filter((s) => !disabled.has(s.name));
}

export { getUserStateFile, getProjectStateFile };

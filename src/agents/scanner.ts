/**
 * 代理扫描：项目级 + 用户级目录 → AgentMeta[]
 *
 * 目录约定（对齐 Claude Code）：
 *  - 项目级：`<projectDir>/.cuckoo/agents/<name>.md`
 *  - 用户级：`~/.cuckoo/agents/<name>.md`
 *
 * 规则：
 *  - 只扫 agents 目录的**直接 .md 文件**（不递归、不含子目录）
 *  - 同名时项目级优先
 *  - 宽容：name 缺省取文件名，description 缺省取正文首段；无 description 则跳过
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseFrontmatter } from '../skills/frontmatter.js';
import type { AgentMeta, AgentSource } from './types.js';

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
 * 扫描某个 .cuckoo/agents 目录下的所有代理。
 * @param baseDir 该作用域的基目录（项目根 或 用户主目录）
 * @param source 作用域来源
 */
function scanDir(baseDir: string, source: AgentSource): AgentMeta[] {
  const agentsDir = path.join(baseDir, '.cuckoo', 'agents');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return []; // 目录不存在或无权限，静默跳过
  }

  const result: AgentMeta[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.toLowerCase().endsWith('.md')) continue;
    const agentPath = path.join(agentsDir, ent.name);
    let raw: string;
    try {
      raw = fs.readFileSync(agentPath, 'utf-8');
    } catch {
      continue;
    }

    const { data, body } = parseFrontmatter(raw);
    const name = (data.name || ent.name.replace(/\.md$/i, '')).trim();
    const description = (data.description || firstParagraph(body)).trim();
    if (!description) continue; // 无描述 → 无法展示，跳过

    let tools: string[] | undefined;
    if (data.tools) {
      tools = data.tools.split(',').map((s) => s.trim()).filter(Boolean);
    }

    let maxTurns: number | undefined;
    if (data.maxTurns) {
      const n = parseInt(data.maxTurns, 10);
      if (Number.isFinite(n) && n > 0) maxTurns = n;
    }

    result.push({
      name,
      description,
      tools,
      maxTurns,
      agentPath,
      systemPrompt: body.trim(),
      source,
    });
  }
  return result;
}

/** 合并代理列表：同名时项目级优先 */
export function mergeAgents(project: AgentMeta[], user: AgentMeta[]): AgentMeta[] {
  const byName = new Map<string, AgentMeta>();
  for (const a of user) byName.set(a.name, a);
  for (const a of project) byName.set(a.name, a); // 项目级覆盖同名用户级
  return Array.from(byName.values());
}

/**
 * 扫描并合并代理。
 * @param projectDir 项目根目录（可为 null，表示未初始化项目）
 * @returns 合并后的代理列表（项目级优先）
 */
export function scanAgents(projectDir: string | null): AgentMeta[] {
  const user = scanDir(os.homedir(), 'user');
  const project = projectDir ? scanDir(projectDir, 'project') : [];
  return mergeAgents(project, user);
}

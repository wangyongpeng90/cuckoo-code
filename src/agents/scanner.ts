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
 * 扫描一个具体的 agents 目录（`<dir>/<name>.md`，只扫一层）。
 * @param agentsDir agents 目录绝对路径
 * @param source 作用域来源
 */
function scanAgentsRoot(agentsDir: string, source: AgentSource): AgentMeta[] {
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
    // 注意：data.name 为纯空白时是 truthy，需 trim 后判断，空则回退文件名
    const name = (data.name && data.name.trim()) || ent.name.replace(/\.md$/i, '');
    const description = (data.description || firstParagraph(body)).trim();
    if (!name.trim() || !description) continue; // 无名或无描述 → 无法展示，跳过

    let tools: string[] | undefined;
    if (data.tools) {
      tools = data.tools.split(',').map((s) => s.trim()).filter(Boolean);
    }

    let maxTurns: number | undefined;
    if (data.maxTurns) {
      // 严格解析：Number() 对 "5abc" 返回 NaN（parseInt 会得 5）；限上界防畸形配置
      const n = Number(data.maxTurns);
      if (Number.isInteger(n) && n > 0 && n <= 1000) maxTurns = n;
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

/** 扫描某个作用域基目录下的 `.cuckoo/agents` */
function scanDir(baseDir: string, source: AgentSource): AgentMeta[] {
  return scanAgentsRoot(path.join(baseDir, '.cuckoo', 'agents'), source);
}

/** 合并代理列表：同名时 项目级 > 用户级 > 插件级 */
export function mergeAgents(project: AgentMeta[], user: AgentMeta[], plugin: AgentMeta[] = []): AgentMeta[] {
  const byName = new Map<string, AgentMeta>();
  for (const a of plugin) byName.set(a.name, a); // 最低优先级
  for (const a of user) byName.set(a.name, a);
  for (const a of project) byName.set(a.name, a); // 项目级覆盖同名用户级
  return Array.from(byName.values());
}

/**
 * 扫描并合并代理。
 * @param projectDir 项目根目录（可为 null，表示未初始化项目）
 * @param extraAgentDirs 额外的 agents 目录（绝对路径）。由上层（session）计算后传入，
 *   本模块**不 import plugins**，避免形成依赖环。
 * @returns 合并后的代理列表（项目级 > 用户级 > 插件级）
 */
export function scanAgents(projectDir: string | null, extraAgentDirs: string[] = []): AgentMeta[] {
  const user = scanDir(os.homedir(), 'user');
  const project = projectDir ? scanDir(projectDir, 'project') : [];
  const plugin: AgentMeta[] = [];
  for (const dir of extraAgentDirs) {
    if (!dir) continue;
    plugin.push(...scanAgentsRoot(dir, 'plugin'));
  }
  return mergeAgents(project, user, plugin);
}

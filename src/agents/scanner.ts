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
import { createRequire } from 'node:module';
import { parseFrontmatter } from '../skills/frontmatter.js';
import type { AgentMeta, AgentSource } from './types.js';

const require = createRequire(import.meta.url);

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
  return scanAgentsDir(path.join(baseDir, '.cuckoo', 'agents'), source);
}

/**
 * 扫描任意 agents 目录下的所有代理（直接给定目录，不再拼接 .cuckoo/agents）。
 * @param agentsDir agents 目录绝对路径
 * @param source 作用域来源
 */
export function scanAgentsDir(agentsDir: string, source: AgentSource): AgentMeta[] {
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

/** 合并代理列表：同名时项目级优先，其次全局，最后用户级 */
export function mergeAgents(project: AgentMeta[], global: AgentMeta[], user: AgentMeta[]): AgentMeta[] {
  const byName = new Map<string, AgentMeta>();
  for (const a of user) byName.set(a.name, a);
  for (const a of global) byName.set(a.name, a); // 全局覆盖同名用户级
  for (const a of project) byName.set(a.name, a); // 项目级覆盖同名全局/用户级
  return Array.from(byName.values());
}

/** 扫描全局目录（userData/agents），并过滤掉被禁用的 agent */
function scanGlobalAgents(): AgentMeta[] {
  let dir: string;
  try {
    const { app } = require('electron');
    dir = path.join(app.getPath('userData'), 'agents');
  } catch {
    return []; // 非 Electron 环境（如单测）静默跳过
  }
  const all = scanAgentsDir(dir, 'global');
  // 读取启用状态，过滤禁用的
  let state: Record<string, boolean> = {};
  try {
    const stateFile = path.join(path.dirname(dir), 'agents-state.json');
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch { /* ignore */ }
  return all.filter((a) => {
    const id = path.basename(a.agentPath).replace(/\.md$/i, '');
    return state[id] !== false; // 默认启用
  });
}

/**
 * 扫描并合并代理。
 * 优先级：项目级 > 全局(userData/agents) > 用户级(~/.cuckoo/agents)
 * @param projectDir 项目根目录（可为 null，表示未初始化项目）
 */
export function scanAgents(projectDir: string | null): AgentMeta[] {
  const user = scanDir(os.homedir(), 'user');
  const global = scanGlobalAgents();
  const project = projectDir ? scanDir(projectDir, 'project') : [];
  return mergeAgents(project, global, user);
}

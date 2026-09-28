/**
 * Agent 配置管理（全局，存于 userData/agents/）
 *
 * 与 MCP 配置不同：agent 是带 frontmatter 的 Markdown 文件，天然适合直接用
 * 文本编辑器编辑，也便于在设置界面里增删改。每个 agent 一个 .md 文件：
 *   <userData>/agents/<id>.md
 *
 * 文件格式（标准 frontmatter + 正文）：
 *   ---
 *   name: 需求调研专家
 *   description: 只读调研...
 *   tools: read, glob, grep
 *   maxTurns: 20
 *   ---
 *   你是...
 *
 * 启用/禁用状态单独存 agents-state.json（不污染 .md 文件）：
 *   { "<id>": true, "<id2>": false }
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseFrontmatter } from '../skills/frontmatter.js';

const require = createRequire(import.meta.url);
const { app } = require('electron');

/** agent 存储目录 */
function getAgentsDir(): string {
  return path.join(app.getPath('userData'), 'agents');
}

/** 启用状态文件 */
function getStateFile(): string {
  return path.join(app.getPath('userData'), 'agents-state.json');
}

/** 确保目录存在 */
function ensureDir(): void {
  try {
    fs.mkdirSync(getAgentsDir(), { recursive: true });
  } catch (err: any) {
    console.error('[Agents] 创建目录失败:', err.message);
  }
}

function readState(): Record<string, boolean> {
  try {
    const file = getStateFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err: any) {
    console.error('[Agents] 读取状态失败:', err.message);
  }
  return {};
}

function writeState(state: Record<string, boolean>): boolean {
  try {
    fs.writeFileSync(getStateFile(), JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error('[Agents] 写入状态失败:', err.message);
    return false;
  }
}

/** 文件名（不含扩展名）作为 id，做基本安全过滤（防路径穿越） */
function safeId(id: string): string {
  return String(id || '').replace(/[^A-Za-z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 100);
}

/** 单个 agent 文件路径 */
function agentFile(id: string): string {
  return path.join(getAgentsDir(), safeId(id) + '.md');
}

/**
 * 读取某个 .md 文件为 agent 定义。
 * @param filePath 绝对路径
 * @param id 逻辑 id（文件名）
 */
function readAgentFile(filePath: string, id: string): any | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  const name = (data.name && data.name.trim()) || id;
  const description = (data.description || '').trim();
  let tools: string[] | undefined;
  if (data.tools) tools = data.tools.split(',').map((s) => s.trim()).filter(Boolean);
  let maxTurns: number | undefined;
  if (data.maxTurns) {
    const n = Number(data.maxTurns);
    if (Number.isInteger(n) && n > 0 && n <= 1000) maxTurns = n;
  }
  return {
    id,
    name,
    description,
    tools,
    maxTurns,
    systemPrompt: body.trim(),
    filePath,
  };
}

/** 列出所有全局 agent（带 enabled 状态） */
function listAgents(): any[] {
  ensureDir();
  const state = readState();
  const dir = getAgentsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: any[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.toLowerCase().endsWith('.md')) continue;
    const id = ent.name.replace(/\.md$/i, '');
    const agent = readAgentFile(path.join(dir, ent.name), id);
    if (!agent) continue;
    agent.enabled = state[id] !== false; // 默认启用
    result.push(agent);
  }
  return result;
}

/** 读取单个 agent */
function getAgent(id: string): any | null {
  const file = agentFile(id);
  if (!fs.existsSync(file)) return null;
  const agent = readAgentFile(file, safeId(id));
  if (!agent) return null;
  const state = readState();
  agent.enabled = state[safeId(id)] !== false;
  return agent;
}

/**
 * 新增或更新 agent。
 * @param agent { id?, name, description, tools?, maxTurns?, systemPrompt }
 * @returns 保存后的 agent（含生成的 id）
 */
function upsertAgent(agent: any): any {
  ensureDir();
  const name = String(agent.name || '').trim();
  if (!name) throw new Error('agent name 不能为空');
  const description = String(agent.description || '').trim();
  if (!description) throw new Error('agent description 不能为空');
  const systemPrompt = String(agent.systemPrompt || '').trim();
  if (!systemPrompt) throw new Error('agent systemPrompt 不能为空');

  // id：优先用传入 id；否则用 name 生成
  let id = agent.id ? safeId(agent.id) : safeId(name);
  if (!id) id = 'agent-' + Date.now();

  const lines: string[] = ['---', 'name: ' + name, 'description: ' + description];
  if (agent.tools) {
    const tools = Array.isArray(agent.tools) ? agent.tools.join(', ') : String(agent.tools);
    if (tools.trim()) lines.push('tools: ' + tools.trim());
  }
  if (agent.maxTurns) {
    const n = Number(agent.maxTurns);
    if (Number.isInteger(n) && n > 0 && n <= 1000) lines.push('maxTurns: ' + n);
  }
  lines.push('---', '', systemPrompt, '');
  const content = lines.join('\n');
  fs.writeFileSync(agentFile(id), content, 'utf-8');
  return getAgent(id);
}

/** 删除 agent（含状态） */
function removeAgent(id: string): boolean {
  const safe = safeId(id);
  const file = agentFile(safe);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err: any) {
    console.error('[Agents] 删除文件失败:', err.message);
    return false;
  }
  const state = readState();
  delete state[safe];
  writeState(state);
  return true;
}

/** 设置启用状态 */
function setAgentEnabled(id: string, enabled: boolean): boolean {
  const state = readState();
  state[safeId(id)] = !!enabled;
  return writeState(state);
}

export {
  getAgentsDir,
  getStateFile,
  listAgents,
  getAgent,
  upsertAgent,
  removeAgent,
  setAgentEnabled,
};

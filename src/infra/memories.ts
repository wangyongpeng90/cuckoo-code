/**
 * 用户记忆（Memories）管理
 *
 * 存储：~/.cuckoo/memories.json（用户级，所有项目通用）
 * 可用环境变量 CUCKOO_HOME 覆盖（测试隔离）。
 *
 * 数据模型：
 *   { id: string, text: string, createdAt: number, updatedAt: number }
 *
 * 记忆内容会注入系统提示词的「## 用户记忆」章节，让模型了解用户习惯。
 * 首次读取时若文件不存在，返回空数组（不写默认）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/** 用户级目录（可用 CUCKOO_HOME 覆盖，供测试隔离） */
function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

function getMemoriesFile(): string {
  return path.join(getUserDir(), 'memories.json');
}

/** 校验并规整单条记忆 */
function normalizeMemory(raw: any): Memory | null {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  const now = Date.now();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'mem-' + now + '-' + Math.random().toString(36).slice(2, 8),
    text,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

/** 读取全部记忆（文件不存在返回空数组） */
function listMemories(): Memory[] {
  const file = getMemoriesFile();
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(raw)) {
        return raw.map(normalizeMemory).filter(Boolean) as Memory[];
      }
    }
  } catch (err: any) {
    console.error('[Memories] 读取失败:', err.message);
  }
  return [];
}

/** 整体覆盖写入 */
function saveMemories(list: any): boolean {
  const file = getMemoriesFile();
  try {
    const arr = Array.isArray(list) ? list : [];
    const clean = arr.map(normalizeMemory).filter(Boolean) as Memory[];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8');
    console.log('[Memories] 已写入:', file);
    return true;
  } catch (err: any) {
    console.error('[Memories] 写入失败:', err.message);
    return false;
  }
}

/** 单条记忆最大字符数（超出截断，防 prompt 膨胀） */
const MAX_MEMORY_LEN = 500;
/** 注入提示词的记忆章节总长上限（字符） */
const MAX_SECTION_LEN = 4000;
/** 记忆条数上限（超出时丢弃最旧的） */
const MAX_MEMORIES = 200;

/**
 * 新增一条记忆，返回新记忆。
 * - text 为空返回 null
 * - 重复内容（忽略首尾空白后完全相同）不重复添加，返回已存在的那条
 * - 超长截断到 MAX_MEMORY_LEN
 * - 超过 MAX_MEMORIES 时丢弃最旧的
 */
function addMemory(text: string): Memory | null {
  let t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  if (t.length > MAX_MEMORY_LEN) t = t.slice(0, MAX_MEMORY_LEN);

  const list = listMemories();
  // 去重：内容完全相同则不重复添加
  const existing = list.find((m) => m.text === t);
  if (existing) return existing;

  const now = Date.now();
  const mem: Memory = {
    id: 'mem-' + now + '-' + Math.random().toString(36).slice(2, 8),
    text: t,
    createdAt: now,
    updatedAt: now,
  };
  list.push(mem);
  // 超上限时丢弃最旧的（按 createdAt 升序删前面的）
  while (list.length > MAX_MEMORIES) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    list.shift();
  }
  return saveMemories(list) ? mem : null;
}

/** 按 id 删除一条记忆 */
function removeMemory(id: string): boolean {
  const list = listMemories();
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  return saveMemories(next);
}

/**
 * 构建注入提示词的「用户记忆」章节。
 * 无记忆时返回空串（不注入章节）。
 */
function buildMemorySection(): string {
  const list = listMemories();
  if (!list.length) return '';
  const lines = list.map((m) => '- ' + m.text.replace(/\n/g, ' '));
  let body = lines.join('\n');
  // 章节总长上限，超出截断并提示（防 prompt 膨胀）
  if (body.length > MAX_SECTION_LEN) {
    body = body.slice(0, MAX_SECTION_LEN) + '\n- ...（更多记忆已省略）';
  }
  return [
    '## 用户记忆',
    '',
    '以下是用户过往沉淀的偏好与习惯，请在后续工作中遵循（除非用户明确改变要求）：',
    '',
    body,
  ].join('\n');
}

export { listMemories, saveMemories, addMemory, removeMemory, buildMemorySection, getMemoriesFile };

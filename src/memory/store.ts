/**
 * 长期记忆存储：<userData>/memories.json
 *
 * 结构：{ version: 1, memories: Memory[] }
 * 并发：写操作用串行队列，避免读-改-写竞争。
 * 依赖：node 内置 + createRequire 懒加载 electron（同 scanner.ts 惯例）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Memory, NewMemory, MemoryScope } from './types.js';
import { MEMORY_TYPES } from './types.js';

const require = createRequire(import.meta.url);

const FILE_VERSION = 1;

function getUserDataDir(): string | null {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    return null;
  }
}

function getFile(): string | null {
  const dir = getUserDataDir();
  if (!dir) return null;
  return path.join(dir, 'memories.json');
}

interface MemoryFile {
  version: number;
  memories: Memory[];
}

function readFile(): MemoryFile {
  const file = getFile();
  if (!file || !fs.existsSync(file)) return { version: FILE_VERSION, memories: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (raw && Array.isArray(raw.memories)) {
      return { version: raw.version || FILE_VERSION, memories: raw.memories };
    }
  } catch (err: any) {
    console.error('[Memory] 读取失败:', err.message);
  }
  return { version: FILE_VERSION, memories: [] };
}

function writeFile(data: MemoryFile): void {
  const file = getFile();
  if (!file) throw new Error('无 userData 目录，无法写入记忆');
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ===== 写串行队列（避免并发读-改-写丢数据）=====
let queue: Promise<any> = Promise.resolve();
function enqueue<T>(fn: () => T): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

function nextId(memories: Memory[]): number {
  let max = 0;
  for (const m of memories) if (m.id > max) max = m.id;
  return max + 1;
}

function normalizeType(t: any): Memory['type'] {
  return MEMORY_TYPES.includes(t) ? t : 'topic';
}

/** 列出全部记忆（可选按作用域过滤） */
export async function listMemories(projectId?: string | null): Promise<Memory[]> {
  const data = readFile();
  if (projectId === undefined) return data.memories;
  return data.memories.filter((m) => {
    if (m.scope === 'project') return !!projectId && m.projectId === projectId;
    return true;
  });
}

/** 同步版列表（供 prompt-builder 等同步上下文使用） */
export function listMemoriesSync(projectId?: string | null): Memory[] {
  const data = readFile();
  if (projectId === undefined) return data.memories;
  return data.memories.filter((m) => {
    if (m.scope === 'project') return !!projectId && m.projectId === projectId;
    return true;
  });
}

/** 保存新记忆，返回新 id */
export async function saveMemory(input: NewMemory): Promise<number> {
  return enqueue(() => {
    const data = readFile();
    const now = Date.now();
    const mem: Memory = {
      id: nextId(data.memories),
      scope: input.scope === 'project' ? 'project' : 'global',
      projectId: input.scope === 'project' ? input.projectId : undefined,
      type: normalizeType(input.type),
      name: String(input.name || '').trim(),
      content: String(input.content || '').trim(),
      description: String(input.description || '').trim(),
      tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      pinned: !!input.pinned,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    };
    if (!mem.name) throw new Error('记忆 name 不能为空');
    if (!mem.content) throw new Error('记忆 content 不能为空');
    data.memories.push(mem);
    writeFile(data);
    return mem.id;
  });
}

/** 更新记忆（整体覆盖，保留 createdAt/accessCount） */
export async function updateMemory(mem: Memory): Promise<void> {
  return enqueue(() => {
    const data = readFile();
    const idx = data.memories.findIndex((m) => m.id === mem.id);
    if (idx < 0) throw new Error('记忆不存在: ' + mem.id);
    data.memories[idx] = { ...data.memories[idx], ...mem, updatedAt: Date.now() };
    writeFile(data);
  });
}

/** 删除记忆 */
export async function deleteMemory(id: number): Promise<void> {
  return enqueue(() => {
    const data = readFile();
    data.memories = data.memories.filter((m) => m.id !== id);
    writeFile(data);
  });
}

/** 批量记录"被注入"（accessCount+1, 刷新 lastAccessedAt） */
export async function touchMemories(ids: number[]): Promise<void> {
  if (!ids.length) return;
  return enqueue(() => {
    const data = readFile();
    const set = new Set(ids);
    const now = Date.now();
    for (const m of data.memories) {
      if (set.has(m.id)) { m.accessCount++; m.lastAccessedAt = now; }
    }
    writeFile(data);
  });
}

/** 整体替换（导入用） */
export async function replaceAllMemories(memories: Memory[]): Promise<void> {
  return enqueue(() => {
    writeFile({ version: FILE_VERSION, memories });
  });
}

export { getUserDataDir };

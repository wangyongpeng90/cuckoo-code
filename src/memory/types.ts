/**
 * 长期记忆系统 —— 类型定义
 *
 * 对齐 DeepSeek++ 的 Memory 结构。存储为 <userData>/memories.json。
 */

/** 记忆类型：用户画像 / 行为反馈 / 话题上下文 / 参考资料 */
export type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';

/** 记忆作用域：全局 / 项目级 */
export type MemoryScope = 'global' | 'project';

export interface Memory {
  /** 自增数字 id */
  id: number;
  /** 作用域（默认 global） */
  scope: MemoryScope;
  /** 项目级记忆所属项目目录（scope=project 时有效） */
  projectId?: string;
  /** 类型 */
  type: MemoryType;
  /** 简短标题 */
  name: string;
  /** 正文内容 */
  content: string;
  /** 补充描述 */
  description: string;
  /** 标签（用于关键词匹配） */
  tags: string[];
  /** 是否置顶（置顶优先注入） */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** 被注入次数 */
  accessCount: number;
  /** 最近一次被注入时间 */
  lastAccessedAt: number;
}

/** 新增记忆时的输入（id/时间戳/计数由 store 生成） */
export type NewMemory = Pick<Memory, 'type' | 'name' | 'content'> & {
  description?: string;
  tags?: string[];
  pinned?: boolean;
  scope?: MemoryScope;
  projectId?: string;
};

export const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'topic', 'reference'];

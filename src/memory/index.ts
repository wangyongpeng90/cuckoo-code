/**
 * 长期记忆系统（底层共享模块）
 *
 * 依赖铁律：只依赖 node 内置（fs/path/os）+ createRequire 懒加载 electron。
 * 不得反向依赖 tools/session/bridge/app 等上层。
 */
export type { Memory, NewMemory, MemoryType, MemoryScope } from './types.js';
export { MEMORY_TYPES } from './types.js';
export {
  listMemories, listMemoriesSync, saveMemory, updateMemory, deleteMemory,
  touchMemories, replaceAllMemories, getUserDataDir,
} from './store.js';
export {
  selectMemories, getMemoryBudget, formatMemoryLine, formatMemoriesBlock,
  estimateTokens, segmentText, MEMORY_TOKEN_BUDGET,
} from './selector.js';
export type { SelectOptions } from './selector.js';

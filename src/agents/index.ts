/**
 * 代理模块入口
 */
export { scanAgents, mergeAgents, scanAgentsDir } from './scanner.js';
export { buildAgentsSection } from './prompt.js';
export {
  getAgentsDir,
  getStateFile,
  listAgents,
  getAgent,
  upsertAgent,
  removeAgent,
  setAgentEnabled,
} from './config.js';
export type { AgentMeta, AgentSource } from './types.js';

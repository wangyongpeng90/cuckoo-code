/**
 * 技能模块入口
 */
export { scanSkills, mergeSkills, scanAppSkillsDir } from './scanner.js';
export { buildSkillsSection } from './prompt.js';
export { parseFrontmatter } from './frontmatter.js';
export {
  getSkillsDir,
  getStateFile,
  listSkills,
  getSkill,
  upsertSkill,
  installSkillFromDir,
  removeSkill,
  setSkillEnabled,
} from './config.js';
export type { SkillMeta, SkillSource } from './types.js';

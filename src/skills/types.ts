/**
 * Skill（技能）相关类型定义
 *
 * 对齐 Claude Code 的 Agent Skills 机制：技能是带 frontmatter 的 SKILL.md，
 * 放在约定目录下，由宿主扫描后把 name + description 注入系统提示词（渐进式披露）。
 */

/** 技能的来源作用域 */
export type SkillSource = 'project' | 'user';

/** 扫描出的技能元数据 */
export interface SkillMeta {
  /** 技能名（frontmatter 的 name，缺省取目录名） */
  name: string;
  /** 简述（frontmatter 的 description，缺省取正文首段） */
  description: string;
  /** 建议使用场景（frontmatter 的 when_to_use，可选） */
  whenToUse?: string;
  /** 声明可用工具（frontmatter 的 allowed-tools，仅声明不强制） */
  allowedTools?: string[];
  /** SKILL.md 的绝对路径（供 AI read） */
  skillPath: string;
  /** 技能目录绝对路径 */
  dir: string;
  /** 来源 */
  source: SkillSource;
}

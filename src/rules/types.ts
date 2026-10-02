/**
 * Rule（规则）相关类型定义
 *
 * 对齐 Claude Code 的 `.claude/rules/`：规则是带 frontmatter 的 Markdown，
 * 放在约定目录下。
 *  - 有 `paths` 的：AI「读（read）」匹配文件时注入
 *  - 无 `paths` 的：初始化时注入（同 CUCKOO.md 待遇）
 */

/** 规则来源作用域（plugin = 由已安装插件贡献，优先级最低） */
export type RuleSource = 'project' | 'user' | 'plugin';

/** 扫描出的规则元数据 */
export interface RuleMeta {
  /** 规则名（frontmatter 的 name，缺省取文件名） */
  name: string;
  /** 适用路径 glob（frontmatter 的 paths，可多条；空数组 = 无路径限定） */
  paths: string[];
  /** 规则文件绝对路径（去重键；也供 AI read） */
  rulePath: string;
  /** 规则正文（frontmatter 之后的内容） */
  body: string;
  /** 来源 */
  source: RuleSource;
}

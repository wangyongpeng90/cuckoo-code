/**
 * Agent（子代理）相关类型定义
 *
 * 对齐 Claude Code 的 subagents：代理是带 frontmatter 的 Markdown 文件，
 * 放在约定目录下，由宿主扫描后把 name + description 注入系统提示词（渐进式披露），
 * 主对话通过 runAgent 工具委派任务给独立上下文的子代理。
 */

/** 代理的来源作用域 */
export type AgentSource = 'project' | 'user';

/** 扫描出的代理元数据 */
export interface AgentMeta {
  /** 代理名（frontmatter 的 name，缺省取文件名） */
  name: string;
  /** 何时委派给它（frontmatter 的 description） */
  description: string;
  /** 允许使用的工具（frontmatter 的 tools，缺省=全部） */
  tools?: string[];
  /** 代理定义文件绝对路径 */
  agentPath: string;
  /** 系统提示正文（frontmatter 之后的内容） */
  systemPrompt: string;
  /** 来源 */
  source: AgentSource;
}

/**
 * 生成系统提示词里的「可用子代理」章节
 *
 * 渐进式披露：只展示 name + description，让主对话知道有哪些代理可委派。
 * 主对话通过 runAgent(name, task) 调用（工具描述里说明用法）。
 */
import type { AgentMeta } from './types.js';

/** 拼单条代理的展示文本 */
function formatAgentLine(a: AgentMeta): string {
  return '- ' + a.name + '：' + a.description;
}

/**
 * 生成「可用子代理」章节。无代理时返回空串（不占用提示词）。
 * @param agents 代理列表
 */
export function buildAgentsSection(agents: AgentMeta[]): string {
  const list = agents || [];
  if (list.length === 0) return '';
  const lines: string[] = [];
  lines.push('## 可用子代理（Agents）');
  lines.push('');
  lines.push('当任务适合委派时，用 runAgent(name, task) 把任务交给对应子代理处理；');
  lines.push('子代理在独立上下文中完成，只把结果摘要返回给你。');
  lines.push('适合委派：大范围搜索/分析、独立子任务，避免污染当前上下文。');
  lines.push('');
  for (const a of list) lines.push(formatAgentLine(a));
  lines.push('');
  return lines.join('\n');
}

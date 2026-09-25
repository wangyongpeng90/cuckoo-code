/**
 * 生成系统提示词里的「可用技能」章节
 *
 * 渐进式披露：只展示 name + description(+when_to_use)，路径给出 SKILL.md 绝对路径，
 * 由 AI 按需 read 全文。description 与 when_to_use 合计截断 1536 字符（对齐 Claude Code）。
 */
import type { SkillMeta } from './types.js';

/** description + when_to_use 合计上限（对齐 Claude Code） */
const DESC_LIMIT = 1536;

/** 拼单条技能的展示文本（name：description） */
function formatSkillLine(s: SkillMeta): string {
  let desc = s.description;
  if (s.whenToUse) desc += '；适用场景：' + s.whenToUse;
  if (desc.length > DESC_LIMIT) desc = desc.slice(0, DESC_LIMIT) + '…';
  return '- ' + s.name + '：' + desc + '\n  路径：' + s.skillPath;
}

/**
 * 生成「可用技能」章节。无技能时返回空串。
 * @param skills 技能列表
 */
export function buildSkillsSection(skills: SkillMeta[]): string {
  if (!skills || skills.length === 0) return '';
  const lines: string[] = [];
  lines.push('## 可用技能（Skills）');
  lines.push('');
  lines.push('当任务与某个技能相关时，你必须先用 read 读取其 SKILL.md 全文，再按其中指令执行。');
  lines.push('技能若有附带脚本，按 SKILL.md 里的说明、用 bash/pwsh 运行（路径以该技能目录为准）。');
  lines.push('若 SKILL.md 内容被截断，用 read 的 offset 参数继续读取。');
  lines.push('');
  for (const s of skills) lines.push(formatSkillLine(s));
  lines.push('');
  return lines.join('\n');
}

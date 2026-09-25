/**
 * 极简 YAML frontmatter 解析（零依赖）
 *
 * 只解析 SKILL.md 顶部 `---` 块中的**顶层** `key: value`，
 * 不处理嵌套 / 多文档 / 锚点等完整 YAML 特性——技能 frontmatter 够用即可。
 */

/** 解析结果：键值对（值均为字符串） */
export interface Frontmatter {
  [key: string]: string;
}

/**
 * 从 markdown 文本中提取 frontmatter。
 * 无 frontmatter 或格式不完整时，data 为空对象、body 为原文。
 * @param content 文件原文
 * @returns { data, body } —— data 为键值对，body 为去掉 frontmatter 的正文
 */
export function parseFrontmatter(content: string): { data: Frontmatter; body: string } {
  // 归一化换行，简化后续处理
  const text = content.replace(/\r\n/g, '\n');

  // 必须以 "---\n" 开头
  if (!text.startsWith('---\n')) {
    return { data: {}, body: content };
  }

  // 找结束的 "---"（行首）
  const endIdx = text.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { data: {}, body: content };
  }

  const fmText = text.slice(4, endIdx); // 去掉开头的 "---\n"
  let bodyStart = endIdx + 4; // 越过 "\n---"
  if (text[bodyStart] === '\n') bodyStart += 1;
  const body = text.slice(bodyStart);

  const data: Frontmatter = {};
  for (const rawLine of fmText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    // 去掉包裹的引号
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (key) data[key] = value;
  }

  return { data, body };
}

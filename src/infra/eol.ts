/**
 * 换行符处理（对齐 dsh 的 fs-local/fsio 方案）
 *
 * 核心思路：读入时把 CRLF 归一成 LF（内存里只留 LF），编辑匹配都在 LF 世界做，
 * 写回前再按文件原本的风格恢复。这样：
 *  - 匹配永远简单（只需 LF 世界）
 *  - 写回不改变文件整体风格（LF 文件还是 LF，CRLF 文件还是 CRLF）
 *  - 混合文件被规整成主导格式（编辑即清理）
 */

/** 换行符风格（只有两种主导格式） */
export type LineEndings = 'LF' | 'CRLF';

/**
 * CRLF → LF。
 * 孤立 \r（后面不跟 \n）保持不变。
 */
export function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

/**
 * 检测文件的主导换行符：取前 4096 字符，多数决。
 * 平局（CRLF == LF）判 LF。
 */
export function detectLineEndings(raw: string): LineEndings {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split('\r\n').length - 1;
  const lfCount = sample.split('\n').length - 1 - crlfCount;
  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

/**
 * 把 LF 归一的文本恢复成指定换行符风格。
 * LF → 原样；CRLF → 先归一（防止已有 \r\n 变成 \r\r\n）再逐行转。
 */
export function restoreLineEndings(content: string, le: LineEndings): string {
  return le === 'LF' ? content : normalizeLineEndings(content).split('\n').join('\r\n');
}

/**
 * [261101-ym9l98] read 工具首行模板池
 *
 * 只改 read 输出的首行元信息（文件名 + 行号范围）。
 * 正文的「行号: 内容」与结尾续读提示保持固定 —— 前者是 AI 解析行号的基础，
 * 后者带 offset 续读指令，随机化会引入误判。
 *
 * 两套池：
 *   - 完整文件：占位符 {path} {total}
 *   - 部分读取：占位符 {path} {start} {end} {total} {rest}
 */

/** 完整文件首行池的键名 */
export const READ_HEADER_FULL_KEY = 'cuckoo-read-header-full';

/** 部分读取首行池的键名 */
export const READ_HEADER_PARTIAL_KEY = 'cuckoo-read-header-partial';

/** 完整文件首行默认池 */
export const DEFAULT_READ_HEADER_FULL: string[] = [
  '{path}（全部 {total} 行）',
  '{path}，一共 {total} 行',
  '{path} 读完了，{total} 行都在下面',
  '{path} 全文 {total} 行',
  '{path} 总共 {total} 行，给你看看',
  '{path} 一共 {total} 行，内容如下',
  '{path} 的 {total} 行都在这儿',
  '{path}（共 {total} 行）',
];

/** 部分读取首行默认池 */
export const DEFAULT_READ_HEADER_PARTIAL: string[] = [
  '{path}（第 {start}-{end} 行，共 {total} 行，还剩 {rest} 行）',
  '{path} 先看第 {start}-{end} 行，全文件 {total} 行，还有 {rest} 行',
  '{path}：第 {start} 到 {end} 行（共 {total} 行，剩 {rest} 行）',
  '{path}（{start}-{end} / 共 {total} 行，余 {rest} 行）',
  '{path} 这次是第 {start}-{end} 行，全 {total} 行，还剩 {rest} 行',
  '{path} 的第 {start}-{end} 行，一共 {total} 行，后面还有 {rest} 行',
  '{path} 先给你第 {start}-{end} 行，共 {total} 行，还有 {rest} 行没读',
];

/** 把模板里的占位符替换为实际值（未识别的占位符原样保留） */
export function renderReadHeader(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** 从池里随机取一条并渲染；池为空时回退 fallback 的第一条 */
export function pickAndRender(pool: string[], fallback: string[], vars: Record<string, string | number>): string {
  const list = pool && pool.length > 0 ? pool : fallback;
  const tpl = list[Math.floor(Math.random() * list.length)] || fallback[0] || '';
  return renderReadHeader(tpl, vars);
}

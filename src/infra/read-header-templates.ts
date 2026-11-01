/**
 * [261101-ym9l98] 工具输出格式模板池（read 首行 / read 结尾 / glob 结尾）
 *
 * 只改"给人看的话"，不改 AI 依赖的结构：
 *   - read 正文的「行号: 内容」保持固定（AI 靠它解析行号）
 *   - 续读指令里的 offset= 参数名保持英文原样（AI 要照着传）
 *
 * 五套池：
 *   - read 首行·完整：{path} {total}
 *   - read 首行·部分：{path} {start} {end} {total} {rest}
 *   - read 结尾·完整：{total}
 *   - read 结尾·部分：{start} {end} {total} {next}
 *   - read 结尾·字节截断：{start} {end} {next}
 *
 * {next} = 下一段起始行号（= end + 1），用户需自行包在 offset= 里。
 */

/** 完整文件首行池的键名 */
export const READ_HEADER_FULL_KEY = 'cuckoo-read-header-full';

/** 部分读取首行池的键名 */
export const READ_HEADER_PARTIAL_KEY = 'cuckoo-read-header-partial';

/** read 结尾·完整文件的键名 */
export const READ_FOOTER_FULL_KEY = 'cuckoo-read-footer-full';

/** read 结尾·部分读取的键名 */
export const READ_FOOTER_PARTIAL_KEY = 'cuckoo-read-footer-partial';

/** read 结尾·字节截断的键名 */
export const READ_FOOTER_CAPPED_KEY = 'cuckoo-read-footer-capped';

/** glob 结尾·未截断的键名 */
export const GLOB_FOOTER_FULL_KEY = 'cuckoo-glob-footer-full';

/** glob 结尾·截断的键名 */
export const GLOB_FOOTER_TRUNCATED_KEY = 'cuckoo-glob-footer-truncated';

/** 完整文件首行默认池 */
export const DEFAULT_READ_HEADER_FULL: string[] = [
  '{path}（一共 {total} 行），请查收：',
  '{path}（全 {total} 行），往下看：',
  '{path} 读完了，总共 {total} 行，给你看看：',
  '{path}，全文 {total} 行：',
  '{path}（全 {total} 行）',
  '{path} 已读完，全文 {total} 行，请查收：',
  '{path}，共 {total} 行：',
  '{path}，总共 {total} 行，请查收：',
  '{path} 已读完，全文 {total} 行，给你看看：',
  '{path} 读完了，共 {total} 行，内容如下：',
  '{path} 已读完，总共 {total} 行，往下看：',
  '{path} 读完了，共 {total} 行',
  '{path} 读完了，总共 {total} 行：',
  '{path} 已读完，共 {total} 行，都在这儿：',
  '{path}（全 {total} 行），都在这儿：',
  '{path} 读完了，全文 {total} 行，给你看看：',
  '{path} 全读完了，总共 {total} 行，请查收：',
  '{path} 读完了，全文 {total} 行',
  '{path}，全文 {total} 行',
  '{path}，共 {total} 行，请查收：',
  '{path} 已读完，总共 {total} 行，给你看看：',
  '{path} 已读完，一共 {total} 行，内容如下：',
  '{path} 读完了，一共 {total} 行，给你看看：',
  '{path} 读完了，全 {total} 行',
  '{path} 读完了，全文 {total} 行，往下看：',
  '{path}（共 {total} 行），都在这儿：',
  '{path} 已读完，共 {total} 行',
  '{path}（全 {total} 行）：',
  '{path} 全读完了，总共 {total} 行：',
  '{path} 已读完，一共 {total} 行，往下看：',
  '{path} 已读完，全文 {total} 行，都在这儿：',
  '{path} 已读完，一共 {total} 行',
  '{path} 全读完了，共 {total} 行，给你看看：',
  '{path}（总共 {total} 行），内容如下：',
  '{path}，总共 {total} 行：',
  '{path}（一共 {total} 行）',
  '{path} 全读完了，一共 {total} 行，请查收：',
  '{path}（全文 {total} 行），请查收：',
  '{path} 读完了，全 {total} 行，给你看看：',
  '{path} 读完了，共 {total} 行，给你看看：',
  '{path}，全文 {total} 行，给你看看：',
  '{path}（总共 {total} 行），往下看：',
  '{path}，总共 {total} 行，内容如下：',
  '{path} 读完了，一共 {total} 行，往下看：',
  '{path} 已读完，总共 {total} 行',
  '{path}（全文 {total} 行），给你看看：',
  '{path} 全读完了，全 {total} 行，给你看看：',
  '{path} 读完了，总共 {total} 行，都在这儿：',
  '{path}（总共 {total} 行），请查收：',
  '{path}，一共 {total} 行，往下看：',
  '{path} 全读完了，全文 {total} 行，请查收：',
  '{path} 全读完了，总共 {total} 行，内容如下：',
  '{path} 全读完了，总共 {total} 行，往下看：',
  '{path} 已读完，共 {total} 行，请查收：',
  '{path} 读完了，全 {total} 行，都在这儿：',
  '{path}，共 {total} 行，往下看：',
  '{path} 全读完了，共 {total} 行，内容如下：',
  '{path}，一共 {total} 行：',
  '{path}（一共 {total} 行）：',
  '{path}，全 {total} 行',
  '{path} 读完了，全文 {total} 行，请查收：',
  '{path} 读完了，全文 {total} 行，内容如下：',
  '{path}（共 {total} 行），请查收：',
  '{path}，一共 {total} 行，给你看看：',
  '{path}（一共 {total} 行），内容如下：',
  '{path} 已读完，全文 {total} 行，内容如下：',
  '{path} 已读完，总共 {total} 行，内容如下：',
  '{path} 读完了，一共 {total} 行',
  '{path} 全读完了，总共 {total} 行，都在这儿：',
  '{path} 全读完了，全 {total} 行，请查收：',
  '{path} 全读完了，全 {total} 行，内容如下：',
  '{path}（总共 {total} 行）：',
  '{path}，总共 {total} 行，都在这儿：',
  '{path} 全读完了，一共 {total} 行',
  '{path} 全读完了，全文 {total} 行',
  '{path} 已读完，共 {total} 行，往下看：',
  '{path} 已读完，一共 {total} 行：',
  '{path}（一共 {total} 行），都在这儿：',
  '{path} 全读完了，共 {total} 行，都在这儿：',
  '{path}（总共 {total} 行），给你看看：',
  '{path} 全读完了，一共 {total} 行，内容如下：',
  '{path} 读完了，总共 {total} 行，请查收：',
  '{path}，共 {total} 行，都在这儿：',
  '{path}（共 {total} 行），往下看：',
  '{path} 读完了，一共 {total} 行，内容如下：',
  '{path}，共 {total} 行',
  '{path} 已读完，全 {total} 行，请查收：',
  '{path} 读完了，总共 {total} 行',
  '{path}（全文 {total} 行）',
  '{path}（共 {total} 行）',
  '{path} 已读完，总共 {total} 行，请查收：',
  '{path}，一共 {total} 行，请查收：',
  '{path} 读完了，一共 {total} 行，都在这儿：',
  '{path} 读完了，全 {total} 行，往下看：',
  '{path}（全文 {total} 行），内容如下：',
  '{path}（全文 {total} 行），都在这儿：',
  '{path} 已读完，全文 {total} 行，往下看：',
  '{path} 已读完，全 {total} 行：',
  '{path} 读完了，共 {total} 行，都在这儿：',
  '{path} 全读完了，共 {total} 行，请查收：',
];

/** 部分读取首行默认池 */
export const DEFAULT_READ_HEADER_PARTIAL: string[] = [
  '{path}：第 {start}-{end} 行（全文件 {total} 行，还剩 {rest} 行）',
  '{path}（{start} 到 {end} 行，全文件 {total} 行，还剩 {rest} 行）',
  '{path} {start} 到 {end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path} 这次是 {start}-{end} 行，总共 {total} 行，还有 {rest} 行没读',
  '{path}：{start}-{end} 行（全文件 {total} 行，还剩 {rest} 行）',
  '{path} 这次是 第 {start}～{end} 行，全文件 {total} 行，还剩 {rest} 行',
  '{path} 读的是 第 {start}～{end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 第 {start}～{end} 行，总共 {total} 行，后面还有 {rest} 行',
  '{path}（第 {start} 到 {end} 行，共 {total} 行，后面还有 {rest} 行）',
  '{path}：第 {start}-{end} 行（总共 {total} 行，余 {rest} 行）',
  '{path} 这次是 {start}-{end} 行，全文件 {total} 行，余 {rest} 行',
  '{path}（第 {start}-{end} 行，总共 {total} 行，后面还有 {rest} 行）',
  '{path} 第 {start}-{end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path} 这次是 {start} 到 {end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path}（第 {start} 到 {end} 行，共 {total} 行，还有 {rest} 行没读）',
  '{path}（第 {start}～{end} 行，共 {total} 行，还有 {rest} 行没读）',
  '{path} 先看 {start}-{end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path}：{start} 到 {end} 行（共 {total} 行，还有 {rest} 行没读）',
  '{path}（第 {start} 到 {end} 行，全文件 {total} 行，还有 {rest} 行没读）',
  '{path}：第 {start}-{end} 行（总共 {total} 行，还剩 {rest} 行）',
  '{path}：第 {start}-{end} 行（共 {total} 行，还剩 {rest} 行）',
  '{path} 这次是 第 {start}-{end} 行，总共 {total} 行，还有 {rest} 行没读',
  '{path}：{start} 到 {end} 行（全文件 {total} 行，还有 {rest} 行没读）',
  '{path} 先看 {start} 到 {end} 行，共 {total} 行，余 {rest} 行',
  '{path} 先看 第 {start}-{end} 行，共 {total} 行，还剩 {rest} 行',
  '{path} {start}-{end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path}：第 {start} 到 {end} 行（总共 {total} 行，后面还有 {rest} 行）',
  '{path}（{start}-{end} 行，总共 {total} 行，后面还有 {rest} 行）',
  '{path} 第 {start}～{end} 行，共 {total} 行，还剩 {rest} 行',
  '{path} 读的是 第 {start} 到 {end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 先看 第 {start} 到 {end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 读的是 {start} 到 {end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path}：{start}-{end} 行（总共 {total} 行，还有 {rest} 行没读）',
  '{path} 读的是 第 {start}～{end} 行，共 {total} 行，余 {rest} 行',
  '{path} 这次是 第 {start}～{end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 先看 {start}-{end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path} 这次是 {start} 到 {end} 行，全文件 {total} 行，余 {rest} 行',
  '{path}（{start}-{end} 行，共 {total} 行，还有 {rest} 行没读）',
  '{path}：第 {start}～{end} 行（全文件 {total} 行，余 {rest} 行）',
  '{path} 读的是 第 {start} 到 {end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path} 读的是 {start}-{end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 先看 {start} 到 {end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path} 先看 第 {start}～{end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path} 读的是 {start} 到 {end} 行，全文件 {total} 行，余 {rest} 行',
  '{path} 读的是 {start} 到 {end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 这次是 第 {start} 到 {end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path} 先看 第 {start}～{end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path} 这次是 第 {start}～{end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path} 读的是 第 {start} 到 {end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path} 这次是 第 {start}～{end} 行，共 {total} 行，余 {rest} 行',
  '{path} 第 {start}～{end} 行，总共 {total} 行，还剩 {rest} 行',
  '{path} 先看 {start} 到 {end} 行，全文件 {total} 行，还有 {rest} 行没读',
  '{path} 读的是 {start} 到 {end} 行，总共 {total} 行，后面还有 {rest} 行',
  '{path} 第 {start} 到 {end} 行，总共 {total} 行，还剩 {rest} 行',
  '{path} 这次是 第 {start} 到 {end} 行，总共 {total} 行，还有 {rest} 行没读',
  '{path}（{start}-{end} 行，全文件 {total} 行，还剩 {rest} 行）',
  '{path} 先看 第 {start}～{end} 行，总共 {total} 行，还剩 {rest} 行',
  '{path} {start} 到 {end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path} 第 {start}～{end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path} 第 {start}～{end} 行，全文件 {total} 行，余 {rest} 行',
  '{path} 第 {start} 到 {end} 行，总共 {total} 行，还有 {rest} 行没读',
  '{path} 先看 {start} 到 {end} 行，总共 {total} 行，后面还有 {rest} 行',
  '{path} 读的是 {start} 到 {end} 行，共 {total} 行，余 {rest} 行',
  '{path} 先看 第 {start}-{end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path} 读的是 第 {start}-{end} 行，总共 {total} 行，还剩 {rest} 行',
  '{path}（{start}-{end} 行，总共 {total} 行，还剩 {rest} 行）',
  '{path}（第 {start} 到 {end} 行，共 {total} 行，余 {rest} 行）',
  '{path} 这次是 第 {start}-{end} 行，总共 {total} 行，还剩 {rest} 行',
  '{path} 第 {start}-{end} 行，总共 {total} 行，后面还有 {rest} 行',
  '{path} 第 {start} 到 {end} 行，共 {total} 行，还有 {rest} 行没读',
  '{path} 这次是 第 {start}-{end} 行，全文件 {total} 行，还有 {rest} 行没读',
  '{path} 第 {start}-{end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path} {start} 到 {end} 行，全文件 {total} 行，还剩 {rest} 行',
  '{path}：第 {start} 到 {end} 行（总共 {total} 行，还有 {rest} 行没读）',
  '{path} 先看 第 {start} 到 {end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path}：{start}-{end} 行（共 {total} 行，余 {rest} 行）',
  '{path} 先看 第 {start} 到 {end} 行，全文件 {total} 行，还有 {rest} 行没读',
  '{path} 第 {start}～{end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path} 这次是 第 {start}～{end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path}（第 {start}～{end} 行，共 {total} 行，后面还有 {rest} 行）',
  '{path} 第 {start}-{end} 行，共 {total} 行，还剩 {rest} 行',
  '{path} 读的是 第 {start} 到 {end} 行，共 {total} 行，还剩 {rest} 行',
  '{path} 先看 {start} 到 {end} 行，共 {total} 行，还剩 {rest} 行',
  '{path} {start}-{end} 行，总共 {total} 行，余 {rest} 行',
  '{path}：{start}-{end} 行（总共 {total} 行，余 {rest} 行）',
  '{path} 先看 {start}-{end} 行，总共 {total} 行，余 {rest} 行',
  '{path} 这次是 第 {start}～{end} 行，全文件 {total} 行，余 {rest} 行',
  '{path} 读的是 第 {start} 到 {end} 行，全文件 {total} 行，还剩 {rest} 行',
  '{path} 这次是 {start} 到 {end} 行，全文件 {total} 行，后面还有 {rest} 行',
  '{path}（第 {start}～{end} 行，全文件 {total} 行，后面还有 {rest} 行）',
  '{path} 读的是 第 {start}-{end} 行，全文件 {total} 行，余 {rest} 行',
  '{path} {start}-{end} 行，全文件 {total} 行，余 {rest} 行',
  '{path} 先看 第 {start}～{end} 行，总共 {total} 行，还有 {rest} 行没读',
  '{path} 第 {start}-{end} 行，全文件 {total} 行，还剩 {rest} 行',
  '{path} 第 {start} 到 {end} 行，全文件 {total} 行，还有 {rest} 行没读',
  '{path}：第 {start}～{end} 行（全文件 {total} 行，后面还有 {rest} 行）',
  '{path} {start} 到 {end} 行，全文件 {total} 行，还有 {rest} 行没读',
  '{path} 第 {start} 到 {end} 行，共 {total} 行，后面还有 {rest} 行',
  '{path}（第 {start} 到 {end} 行，总共 {total} 行，还剩 {rest} 行）',
  '{path}：{start}-{end} 行（全文件 {total} 行，还有 {rest} 行没读）',
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

/** read 结尾·完整文件默认池（{total}） */
export const DEFAULT_READ_FOOTER_FULL: string[] = [
  '(已到文件末尾，共 {total} 行)',
  '(读完啦，一共 {total} 行)',
  '(全文结束，总共 {total} 行)',
  '(已经到底了，共 {total} 行)',
  '(没有更多了，全 {total} 行)',
  '(文件读完，共 {total} 行)',
  '(到底啦，一共 {total} 行)',
  '(全文 {total} 行都在这儿了)',
];

/** read 结尾·部分读取默认池（{start} {end} {total} {next}） */
export const DEFAULT_READ_FOOTER_PARTIAL: string[] = [
  '(显示了第 {start}-{end} 行，共 {total} 行；要继续读就传 offset={next})',
  '(这次是第 {start}-{end} 行，全 {total} 行；接着读传 offset={next})',
  '(第 {start}-{end} 行，还剩 {total} 行里的后半段；继续读传 offset={next})',
  '(已给出第 {start}-{end} 行（共 {total} 行）；想往下看就传 offset={next})',
  '(第 {start}-{end} 行 / 共 {total} 行；下一段用 offset={next})',
  '(先给你第 {start}-{end} 行，全 {total} 行；继续读传 offset={next})',
];

/** read 结尾·字节截断默认池（{start} {end} {next}） */
export const DEFAULT_READ_FOOTER_CAPPED: string[] = [
  '(输出已达上限，只显示了第 {start}-{end} 行；要继续读就传 offset={next})',
  '(这次输出被截断了，只有第 {start}-{end} 行；接着读传 offset={next})',
  '(内容太多被截断，显示到第 {end} 行；继续读传 offset={next})',
  '(输出到上限了，只给了第 {start}-{end} 行；往下读传 offset={next})',
];

/** glob 结尾·未截断默认池（{count}） */
export const DEFAULT_GLOB_FOOTER_FULL: string[] = [
  '(共找到 {count} 个文件)',
  '(一共 {count} 个匹配)',
  '(找到 {count} 个文件)',
  '(共 {count} 个文件)',
  '({count} 个结果)',
  '(搜到 {count} 个文件)',
  '(共 {count} 个匹配文件)',
];

/** glob 结尾·截断默认池（{shown} {total}） */
export const DEFAULT_GLOB_FOOTER_TRUNCATED: string[] = [
  '(只列了 {total} 个路径里的前 {shown} 个，缩小 pattern 或指定 path 能看到更多)',
  '({total} 个里只显示前 {shown} 个；缩小 pattern 或指定 path 可看更多)',
  '(结果太多，只给了前 {shown} 个（共 {total} 个）；缩小范围可看更多)',
  '(共 {total} 个匹配，只列了前 {shown} 个；缩小 pattern 或指定 path 能看到更多)',
  '(截断了：{total} 个里只显示 {shown} 个；缩小范围能看到更多)',
  '(太多啦，{total} 个结果只显示前 {shown} 个；缩小范围能看更多)',
  '(命中 {total} 个，只展示前 {shown} 个，缩小 pattern 试试)',
  '({total} 个匹配太多，先给你前 {shown} 个；缩窄范围可看更多)',
  '(结果爆了：共 {total} 个，只列前 {shown} 个；缩小 pattern 或 path 看更多)',
  '({total} 个里挑了前 {shown} 个，剩下的缩小范围能看到)',
  '(只显示前 {shown} 个（共 {total} 个），缩小 pattern 可看全部)',
  '({total} 个匹配，先看前 {shown} 个；缩窄范围可看更多)',
  '(结果被截断：{total} 个里只给了 {shown} 个，缩小范围看更多)',
  '(太多了，{total} 个只列前 {shown} 个；缩小 pattern 或 path 可看全)',
  '(共命中 {total} 个，只展示了 {shown} 个；缩小范围试试)',
  '({total} 个结果太长，只显示前 {shown} 个；缩窄条件可看更多)',
  '(截断显示：{total} 个里只有前 {shown} 个；缩小 pattern 或 path 看更多)',
  '(总共 {total} 个，只列前 {shown} 个；缩窄搜索范围可看剩余)',
  '({total} 个匹配，这里只列了前 {shown} 个；缩小范围能看到更多)',
  '(太多了，只给了 {total} 个结果里的前 {shown} 个；缩窄范围看更多)',
  '(共 {total} 个，截断到前 {shown} 个；缩小 pattern 或 path 可看全)',
  '(结果过长，{total} 个只显示 {shown} 个；缩小范围试一下)',
  '({total} 个匹配太多，先给前 {shown} 个；缩窄 pattern 或 path 看更多)',
  '(截断：共 {total} 个，只列前 {shown} 个；缩小范围能看到其余)',
  '(命中 {total} 个，只展示前 {shown} 个；缩小 pattern 或指定 path 可看更多)',
  '(结果太多了，{total} 个只列 {shown} 个；缩小范围能看全)',
  '(共 {total} 个，先看前 {shown} 个；缩窄搜索范围可看剩余)',
  '({total} 个匹配，只显示 {shown} 个；缩小 pattern 或 path 看更多)',
  '(截断显示前 {shown} 个（共 {total} 个）；缩小范围可看全部)',
  '(太多了：{total} 个只给前 {shown} 个；缩小 pattern 或 path 可看更多)',
  '(结果过长，只列前 {shown} 个（共 {total} 个）；缩小范围能看到其余)',
  '(共命中 {total} 个，只展示前 {shown} 个；缩小范围试试)',
  '({total} 个里截断到前 {shown} 个；缩小 pattern 或 path 可看剩余)',
  '(结果被截断：{total} 个里只有 {shown} 个；缩小范围看更多)',
  '(匹配太多啦，{total} 个只列前 {shown} 个；缩窄范围可看全)',
  '({total} 个匹配，只给前 {shown} 个；缩窄 pattern 或 path 试试)',
  '(共 {total} 个，只展示前 {shown} 个；缩小搜索范围可看其余)',
  '(结果爆多：{total} 个只列 {shown} 个；缩小范围看更多)',
  '(截断：{total} 个里只显示 {shown} 个；缩小 pattern 或 path 能看到别的)',
  '({total} 个结果太多，只给前 {shown} 个；缩窄范围看更多)',
  '(共 {total} 个匹配，先展示前 {shown} 个；缩小 pattern 或 path 看其余)',
  '(太多了，{total} 个只列了前 {shown} 个；缩小范围能看到更多)',
  '(截断显示：前 {shown} 个（共 {total} 个）；缩小范围可看全)',
  '({total} 个匹配，只给了前 {shown} 个；缩小 pattern 或 path 可看更多)',
  '(结果太长，{total} 个里只展示 {shown} 个；缩窄范围能看更多)',
  '(共 {total} 个，截断到 {shown} 个；缩小搜索范围可看全部)',
  '({total} 个太多，只列前 {shown} 个；缩窄 pattern 或 path 看更多)',
  '(命中 {total} 个，只显示前 {shown} 个；缩小范围或加 path 看更多)',
  '(截断：共 {total} 个，只展示前 {shown} 个；缩小范围能看全)',
  '(共 {total} 个匹配，只列前 {shown} 个；缩窄搜索范围可看更多)',
];

/** write 结尾·新建文件的键名 */
export const WRITE_FOOTER_CREATE_KEY = 'cuckoo-write-footer-create';

/** write 结尾·覆盖更新文件的键名 */
export const WRITE_FOOTER_UPDATE_KEY = 'cuckoo-write-footer-update';

/** write 新建文件默认池（{path}） */
export const DEFAULT_WRITE_FOOTER_CREATE: string[] = [
  '已创建 {path}',
  '新建好了：{path}',
  '{path} 已创建',
  '文件已写好：{path}',
  '搞定，{path} 新建完成',
  '已生成 {path}',
  '{path} 创建完毕',
  '写好了，文件在 {path}',
  '好啦，{path} 建好了',
  '{path} 已就位～',
  '新建成功：{path}',
  '{path} 写好了',
  '文件建好了：{path}',
  '新的 {path} 已创建',
  '已经建好 {path} 了',
  '{path} 新鲜出炉',
  '搞定啦，{path} 已创建',
  '{path} 安排好了',
  '创建成功，见 {path}',
  '{path} 已生成完毕',
  '好嘞，{path} 建好了',
  '{path} 从无到有，建好了',
  '新建完成：{path}',
  '{path} 就绪',
  '文件已创建：{path}',
  '新的文件 {path} 已就位',
  '{path} 创建成功',
  '搞定，{path} 已经建好',
  '已新建 {path}',
  '{path} 已准备好',
  '建好了，{path}',
  '{path} 已写入',
  '成功创建 {path}',
  '{path} 落盘了',
  '新文件 {path} 已生成',
  '已经新建 {path}',
  '{path} 就位啦',
  '新建好啦：{path}',
  '搞定！{path} 建好了',
  '{path} 创建就绪',
  '已建好 {path}',
  '{path} 生成成功',
  '写好了新文件：{path}',
  '已创建好 {path}',
  '{path} 已新建完成',
  '好啦，{path} 创建好了',
  '新建文件成功：{path}',
  '{path} 已就绪，可以用了',
  '成功写入新文件 {path}',
  '创建完成：{path}',
];

/** write 覆盖更新默认池（{path}） */
export const DEFAULT_WRITE_FOOTER_UPDATE: string[] = [
  '已更新 {path}',
  '改好了：{path}',
  '{path} 已更新',
  '文件已覆盖：{path}',
  '搞定，{path} 更新完成',
  '已重写 {path}',
  '{path} 更新完毕',
  '写完了，文件在 {path}',
];

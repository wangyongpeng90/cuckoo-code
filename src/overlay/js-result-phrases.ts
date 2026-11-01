/**
 * [261101-ym9l98] 工具结果回传文案池（头部文案 + 脚本标题模板）
 *
 * 工具结果回复语（头部文案）池
 *
 * 用途：sendCombinedJsResultsToChat 发送 JS 工具结果前，从这里随机取一条
 * 作为消息头（替换旧版固定文案「【JS 执行结果汇总】(共 N 个脚本)」）。
 *
 * 数据来源优先级：
 *   localStorage['cuckoo-js-result-phrases']（用户在设置页自定义，一行一条）
 *   → 为空时回退本文件的 DEFAULT_JS_RESULT_PHRASES
 *
 * 占位符：{n} 会被替换为本次执行的脚本总数。
 *
 * ⚠️ 本文件会被两处消费：
 *   1. AI 页面（overlay/chat-input.ts、overlay/panels/settings.ts）—— tsc 编译
 *   2. 壳页面（ui/shell/scripts/pages/settings-react.tsx）—— esbuild 打进 shell.html
 * 因此这里只能放纯数据 + 纯函数（不 import electron/node，不碰 DOM 以外的东西）。
 */

/** 内置默认文案池（后续会扩展到 1000 条；当前先放示例） */
export const DEFAULT_JS_RESULT_PHRASES: string[] = [
  '刚跑完 {n} 段脚本，结果都在这儿了：',
  '这 {n} 段代码我执行完了，你看看结果：',
  '跑好了，{n} 段脚本的结果如下——',
  '{n} 段脚本都执行完毕，下面是它们的输出：',
  '{n} 段脚本跑完了，详情如下——',
  '执行结果来了（共 {n} 段脚本）：',
  '{n} 段脚本执行完毕，具体结果：',
  '搞定，{n} 段脚本的结果都在这儿：',
  '代码跑完了，这是 {n} 段脚本交回来的结果：',
  '{n} 段脚本已经跑过一轮，结果汇总如下：',
];

/** 内置默认脚本标题模板（整行即最终输出，{i} = 序号，{r} = 成功/失败） */
export const DEFAULT_JS_RESULT_ITEM_TEMPLATES: string[] = [
  '当前第 {i} 条代码块处理完了，成功，你看下结果|当前第 {i} 条代码块没跑通，失败，得改一下',
  '这是第 {i} 块代码，成功，结果是|这是第 {i} 块代码，失败，再来看看',
  '第 {i} 个命令跑完了，成功，结果在下面|第 {i} 个命令跑完了，失败，看看哪里不对',
  '第 {i} 个片段执行完毕，成功，你看下|第 {i} 个片段执行完毕，失败，需要再处理下',
  '第 {i} 段代码有结果了，成功，搞定|第 {i} 段代码有结果了，失败，还没成',
  '当前第 {i} 块代码跑完啦，成功，请查收|当前第 {i} 块代码跑完啦，失败，得再调调',
  '这是第 {i} 个操作，成功，结果如下|这是第 {i} 个操作，失败，没成功',
  '第 {i} 个任务的结果，成功，往下看|第 {i} 个任务的结果，失败，需要修正',
  '第 {i} 条代码块处理完了，{r}，你看下结果',
  '这是第 {i} 条代码块，{r}，结果在下面',
];

/** localStorage 键名（头部文案池） */
export const JS_RESULT_PHRASES_KEY = 'cuckoo-js-result-phrases';

/** localStorage 键名（脚本标题模板池） */
export const JS_RESULT_ITEM_TEMPLATES_KEY = 'cuckoo-js-result-item-templates';

/** 读取一个「一行一条」的池；空则回退给定默认 */
function readPool(key: string, fallback: string[]): string[] {
  let raw = '';
  try { raw = localStorage.getItem(key) || ''; } catch (_) { /* ignore */ }
  const list = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

/** 读取头部文案池 */
function readPhrases(): string[] {
  return readPool(JS_RESULT_PHRASES_KEY, DEFAULT_JS_RESULT_PHRASES);
}

/**
 * 随机取一条工具结果回复语，并把 {n} 替换为脚本总数。
 * @param n 本次执行的脚本总数
 */
export function pickJsResultPhrase(n: number): string {
  const list = readPhrases();
  const idx = Math.floor(Math.random() * list.length);
  const picked = list[idx] || DEFAULT_JS_RESULT_PHRASES[0];
  return picked.replace(/\{n\}/g, String(n));
}

/**
 * 随机取一条脚本标题模板（整条消息只抽一次，同一批脚本共用同一风格）。
 * 返回的模板中 {i} 尚未替换，由调用方按当前序号填充。
 */
export function pickJsResultItemTemplate(): string {
  const list = readPool(JS_RESULT_ITEM_TEMPLATES_KEY, DEFAULT_JS_RESULT_ITEM_TEMPLATES);
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] || DEFAULT_JS_RESULT_ITEM_TEMPLATES[0];
}

/**
 * 渲染脚本标题模板。两种写法：
 *  1. 成对写法 "成功侧|失败侧" —— 按成败取对应一侧，整行即最终输出（侧内 {r} 也会替换）
 *  2. 单句写法 —— {i} 替换序号、{r} 替换「成功」/「失败」；漏写 {r} 时末尾自动追加结果
 * @param template 模板行
 * @param i 当前序号（1 起）
 * @param success 本次是否成功
 */
export function formatJsResultItemTitle(template: string, i: number, success: boolean): string {
  const word = success ? '成功' : '失败';
  const bar = template.indexOf('|');
  // 成对写法：取对应一侧
  if (bar >= 0) {
    const left = template.slice(0, bar).trim();
    const right = template.slice(bar + 1).trim();
    const side = success ? left : right;
    // 该侧为空（畸形数据）：退化为单句写法，末尾补成败，保证不丢结果
    if (!side) {
      const single = (left || right).replace(/\{i\}/g, String(i));
      return single.indexOf('{r}') >= 0 ? single.replace(/\{r\}/g, word) : single + ' ' + word;
    }
    return side.replace(/\{i\}/g, String(i)).replace(/\{r\}/g, word);
  }
  // 单句写法：{i} + {r}；漏写 {r} 时末尾追加
  const out = template.replace(/\{i\}/g, String(i));
  return out.indexOf('{r}') >= 0 ? out.replace(/\{r\}/g, word) : out + ' ' + word;
}

/** 模板行是否写成 "成功侧|失败侧" 成对形式 */
export function isPairedTemplate(template: string): boolean {
  return template.indexOf('|') >= 0;
}

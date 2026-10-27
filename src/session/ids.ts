/**
 * Session ID 的 Branded Type（编译期区分两套 ID）。
 *
 * - `WebId`：网页 AI 生成的会话 ID（URL 里的 `.../s/xxx`）—— Cuckoo 内部用
 * - `LogicId`：插件生成的会话 ID（如 dsh-tasks 的 `session-xxx`）—— 插件边界用
 *
 * 为什么单独一个文件：store.ts 等内部模块只需要类型，不需要翻译层的文件 I/O。
 */

/** 网页 ID（URL 里的 `.../s/xxx`）—— Cuckoo 内部用 */
type WebId = string & { readonly __brand: 'WebId' };
/** 逻辑 ID（插件给的 `session-xxx`）—— 插件边界用 */
type LogicId = string & { readonly __brand: 'LogicId' };

export type { WebId, LogicId };

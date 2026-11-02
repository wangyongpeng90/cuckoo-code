import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { windowManager } from './browser-window-manager.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 14,
    category: 'WebFetch',
    name: 'injectJS',
    usage: '使用 injectJS(windowId, code) 向指定窗口注入 JS。code 可以是任意 JS：单个表达式（如 `(() => ({a:1}))()`）、或一段语句（如 `const a=1; return a;`、`if (x) return y;`，顶层 await 亦可用）。内部优先按表达式解析，失败则按 async 函数体解析；返回值（return 的值 / 表达式结果）会返回给 AI。执行出错会抛出异常。',
    doc: '向指定窗口注入 JS 代码并返回执行结果（支持 async/await）。 如果需要可以使用js模拟点击等任何操作.',
    params: 'windowId: string, code: string',
    returns: 'Promise<any>',
    paramDocs: {
      windowId: '目标窗口 ID',
      code: '要注入的 JS 代码（支持 await，返回值会被返回）',
    },
    returnsDoc: 'JS 执行结果',
  },
];

class InjectJSTool extends Tool {
  constructor() {
    super(
      'injectJS',
      '向指定窗口注入 JS 代码并返回执行结果（代码自动包装为 async，支持 await 和 return）',
      {
        type: 'object',
        properties: {
          windowId: { type: 'string', description: '目标窗口 ID' },
          code: { type: 'string', description: '要注入的 JS 代码（支持 await/return，返回值会返回给 AI）' }
        },
        required: ['windowId', 'code'],
        additionalProperties: false
      },
      'injectJS(windowId, code)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const { windowId, code } = params;
    const result = await windowManager.injectJS(windowId, code);
    return ToolResult.success(result);
  }
}

/** JsRunner 沙箱注入：定义 globalThis.injectJS。 */
export function bootstrap(__call: any): void {
  (globalThis as any).injectJS = async function (windowId: any, code: any) {
    return await __call('injectJS', { windowId: windowId, code: code });
  };
}

export { InjectJSTool };

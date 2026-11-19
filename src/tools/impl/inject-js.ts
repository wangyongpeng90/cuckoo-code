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
    doc: '向指定窗口注入 JS 并返回执行结果（支持表达式或 async 函数体，顶层 await 可用）；执行出错抛异常。',
    params: 'windowId: string, code: string',
    returns: 'Promise<any>',
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

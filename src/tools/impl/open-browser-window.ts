import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import { windowManager } from './browser-window-manager.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 13,
    category: 'WebFetch',
    name: 'openBrowserWindow',
    usage: '使用 openBrowserWindow 打开 Electron 浏览器窗口。返回 windowId，后续用 injectJS(windowId, code) 注入 JS 并获取返回值。可传自定义 id 便于语义化管理。',
    doc: '打开一个 Electron 浏览器窗口并返回窗口 ID。 打开浏览器后可以使用 injectJS 工具对窗口内容注入js , 以具备操控网页能力',
    params: 'url: string, options?: { id?: string; width?: number; height?: number }',
    returns: 'Promise<any>',
    paramDocs: {
      url: '要打开的网页 URL',
      options: '可选，{ id?: string, width?: number, height?: number }',
    },
    returnsDoc: '返回 { windowId: string, message: string }，用返回的 windowId 传给 injectJS',
  },
];

class OpenBrowserWindowTool extends Tool {
  constructor() {
    super(
      'openBrowserWindow',
      '打开一个 Electron 浏览器窗口，返回 { windowId, message }，用返回的 windowId 传给 injectJS(windowId, code) 注入 JS 调试',
      {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要打开的网页 URL' },
          id: { type: 'string', description: '自定义窗口 ID（可选），不提供则自动生成' },
          width: { type: 'number', description: '窗口宽度（像素），默认 1200' },
          height: { type: 'number', description: '窗口高度（像素），默认 800' }
        },
        required: ['url'],
        additionalProperties: false
      },
      'openBrowserWindow(url, options?)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const { url, id, width, height } = params;
    const options: { width?: number; height?: number } = {};
    if (width) options.width = width;
    if (height) options.height = height;
    const windowId = windowManager.openWindow(id || null, url, options);
    return ToolResult.success({ windowId, message: `窗口已打开，ID: ${windowId}，URL: ${url}` });
  }
}

/** JsRunner 沙箱注入：定义 globalThis.openBrowserWindow。 */
export function bootstrap(__call: any): void {
  (globalThis as any).openBrowserWindow = async function (url: any, options: any) {
    options = options || {};
    return await __call('openBrowserWindow', {
      url: url,
      id: options.id,
      width: options.width,
      height: options.height,
    });
  };
}

export { OpenBrowserWindowTool };

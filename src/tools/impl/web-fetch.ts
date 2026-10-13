import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { assertUrlAllowed } from '../../infra/ssrf-guard.js';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 12,
    category: 'WebFetch',
    name: 'webFetch',
    doc: [
      '获取指定 HTTP(S) URL 的内容并解码为文本。',
      'HTML 会转换为 Markdown（turndown + GFM）。',
      '返回纯文本：Fetched <url> (HTTP <status>) + 正文。',
      '内容超过上限（约 20000 字符）会截断并附 footer。',
      '出于安全考虑，可在设置里开启"拒绝访问内网地址"（默认关闭）。',
    ].join('\n'),
    params: 'url: string',
    returns: 'Promise<string>',
    paramDocs: {
      url: '要获取的 HTTP(S) URL',
    },
    throws: 'URL 为空、非 http/https、指向内网/保留地址、请求超时或失败时抛出异常',
  },
];

// 内部固定上限，不暴露给模型
const FETCH_TIMEOUT_MS = 15000;
const FETCH_MAX_OUTPUT_CHARS = 20000;

/**
 * HTML → Markdown 转换器（对齐 dsh）。
 * - atx 标题、fenced 代码块、- 列表
 * - GFM 插件支持表格/删除线
 * - 移除 script/style/noscript（不保留其文本）
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.use(gfm);
turndown.remove(['script', 'style', 'noscript']);

/**
 * 对齐 dsh parseFetchArgs：url trim 非空。
 */
function parseFetchArgs(url: any): { url: string } {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('url must be a non-empty string');
  }
  return { url };
}

/**
 * 对齐 dsh renderBody：根据 body kind 处理。
 */
function renderBody(kind: string, content: string): { text: string; sourceTruncated: boolean } {
  // 注意：必须先"全文转 Markdown"，再截断。
  // 若先截断原始 HTML：很多网站（如 Bing）头部有大段 <script>/<head>，
  // 截断后全是脚本，turndown 移除 script/style 后正文为空（表现为"只返回标题"）。
  if (kind === 'html') {
    let md: string;
    try {
      md = turndown.turndown(content);
    } catch (e) {
      // 转换失败降级为原始 HTML
      md = content;
    }
    const sliced = md.slice(0, FETCH_MAX_OUTPUT_CHARS);
    return { text: sliced, sourceTruncated: sliced.length !== md.length };
  }
  // text
  const sliced = content.slice(0, FETCH_MAX_OUTPUT_CHARS);
  return { text: sliced, sourceTruncated: sliced.length !== content.length };
}

/**
 * 对齐 dsh formatFetchOutput：
 * Fetched <url> (HTTP <status>)

<正文>
 * 截断时加 footer。
 */
function formatFetchOutput(url: string, statusCode: number, bodyKind: string, bodyContent: string, truncated: boolean): string {
  const rendered = renderBody(bodyKind, bodyContent);
  const effectiveTruncated = truncated || rendered.sourceTruncated || rendered.text.length > FETCH_MAX_OUTPUT_CHARS;
  const header = 'Fetched ' + url + ' (HTTP ' + statusCode + ')\n\n';
  const footer = effectiveTruncated ? '\n\n(Content truncated. Fetch a more specific URL or section for the full text.)' : '';
  let full = header + rendered.text + footer;
  if (full.length > FETCH_MAX_OUTPUT_CHARS) {
    full = full.slice(0, FETCH_MAX_OUTPUT_CHARS) + footer;
  }
  return full;
}

/**
 * 手动跟随重定向（替代 fetch 默认 redirect:'follow'）：
 * SSRF 防护开启时逐跳调用 assertUrlAllowed——否则公网 URL 302 跳到
 * http://127.0.0.1 / 169.254.169.254（云元数据）可轻松绕过首跳校验。
 * 每跳同样校验协议（http/https），相对 Location 以当前 URL 为基准解析。
 */
const MAX_REDIRECTS = 5;
async function fetchWithRedirectGuard(startUrl: string, guardOn: boolean, signal: AbortSignal): Promise<Response> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (guardOn) {
      await assertUrlAllowed(currentUrl); // 违规地址直接抛错（由调用方统一转为 ToolResult.error）
    } else {
      const protocol = new URL(currentUrl).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error('仅支持 http/https 协议');
      }
    }
    const response = await fetch(currentUrl, { method: 'GET', redirect: 'manual', signal });
    const status = response.status;
    const location = response.headers.get('location');
    if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && location) {
      // 释放重定向响应体（极小的提示页），避免连接挂起
      try { await response.body?.cancel(); } catch (_) { /* ignore */ }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error('重定向次数过多（超过 ' + MAX_REDIRECTS + ' 次）');
}

/**
 * web_fetch 工具 - 对齐 dsh。
 * 只接受 url 参数，返回转 Markdown 后的纯文本。
 */
class WebFetchTool extends Tool {
  constructor() {
    super(
      'webFetch',
      '获取指定 HTTP(S) URL 的内容并解码为文本。HTML 会转换为 Markdown（turndown + GFM）。返回纯文本：Fetched <url> (HTTP <status>) + 正文。内容超过上限（约 20000 字符）会截断并附 footer。出于安全考虑，可在设置里开启"拒绝访问内网地址"（默认关闭）。',
      {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要获取的 HTTP(S) URL'
          }
        },
        required: ['url'],
        additionalProperties: false
      },
      'webFetch(url)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:webFetch',
      order: 111,
      text: '使用 webFetch 工具获取指定 HTTP(S) URL 的内容。返回解码为文本的页面内容（HTML 转 Markdown）。内容超过约 20000 字符会截断并附 footer。使用其内容时，请以 markdown 链接形式引用 URL。'
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const { url, ssrfGuard } = params;

    try {
      const input = parseFetchArgs(url);
      const guardOn = ssrfGuard === true;

      // 安全限制（**默认关闭**，需在设置里开启）：
      // 仅 http/https，且拒绝内网/回环/链路本地/保留地址（防 SSRF）。
      // 关闭时保留原行为（可访问任意 http/https URL，含本地项目）。
      // 注意：重定向逐跳校验在 fetchWithRedirectGuard 内完成——
      // 否则攻击者可用公网 URL 302 跳到 http://127.0.0.1 / 云元数据地址绕过首跳校验。
      if (!guardOn) {
        const protocol = new URL(input.url).protocol;
        if (protocol !== 'http:' && protocol !== 'https:') {
          return ToolResult.error('仅支持 http/https 协议');
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetchWithRedirectGuard(input.url, guardOn, controller.signal);

        // 流式读取，限制大小
        const reader = response.body ? response.body.getReader() : null;
        let receivedBytes = 0;
        const chunks: Uint8Array[] = [];
        let truncated = false;
        const MAX_BYTES = 512000;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value!.byteLength;
            if (receivedBytes > MAX_BYTES) {
              const remaining = MAX_BYTES - (receivedBytes - value!.byteLength);
              if (remaining > 0) chunks.push(value!.slice(0, remaining));
              truncated = true;
              try { await reader.cancel(); } catch (_) {}
              break;
            }
            chunks.push(value!);
          }
        }

        clearTimeout(timeoutId);

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        const rawText = buffer.toString('utf8');

        // 判断 body kind：content-type 含 html 则为 html，否则 text
        const contentType = response.headers.get('content-type') || '';
        const bodyKind = contentType.includes('text/html') || contentType.includes('application/xhtml') ? 'html' : 'text';

        console.log('[WebFetchTool] 抓取完成:', input.url, 'HTTP', response.status, 'kind=' + bodyKind);

        return ToolResult.success(formatFetchOutput(response.url || input.url, response.status, bodyKind, rawText, truncated));
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return ToolResult.error('请求超时 (超过 ' + FETCH_TIMEOUT_MS + 'ms)');
        }
        return ToolResult.error('请求失败: ' + err.message);
      }
    } catch (err: any) {
      return ToolResult.error('web_fetch 失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入：定义 globalThis.webFetch。 */
export function bootstrap(__call: any): void {
  (globalThis as any).webFetch = async function (url: any) {
    return await __call('webFetch', { url: url });
  };
}

export { WebFetchTool, parseFetchArgs, formatFetchOutput };

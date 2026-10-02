/**
 * 插件模块的 HTTP 传输层（**唯一依赖 electron 的插件文件**）
 *
 * 为什么必须用 Electron `net` 而不是 Node 原生 `fetch`（实测结论）：
 *  - 在开启系统代理（MITM 形态）的环境下，Node 自带 CA 列表不认代理证书，
 *    访问 https://api.github.com 直接抛 UNABLE_TO_VERIFY_LEAF_SIGNATURE；
 *  - Electron `net` 走 Chromium 网络栈，自动继承**系统代理**与**系统证书库**，
 *    与用户浏览器行为一致。
 *
 * 响应体是 **Buffer**（不是 string）：市场接口是 JSON 文本，但 tarball 是二进制
 * gzip —— 按 utf-8 解码会直接损坏数据。文本消费方自行 `.toString('utf-8')`。
 *
 * market/installer 通过注入 `HttpGet` 使用本层，因此它们的逻辑可在 vitest 直接测，
 * 不需要 mock electron。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** 请求参数 */
export interface HttpRequest {
  url: string;
  headers?: Record<string, string>;
  /** 超时毫秒（默认 20s） */
  timeoutMs?: number;
  /** 响应体上限字节数（超出即中断，防大仓库把内存吃满） */
  maxBytes?: number;
}

/** 响应（headers 的 key 统一为小写；body 为原始字节） */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** 传输函数签名（可注入，便于测试） */
export type HttpGet = (req: HttpRequest) => Promise<HttpResponse>;

const DEFAULT_TIMEOUT_MS = 20000;

/** 默认响应体上限：50 MB */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** 默认 UA。GitHub API 对无 UA 的请求直接返回 403，不能省。 */
const DEFAULT_UA = 'cuckoo-code-plugin-market';

/**
 * 基于 Electron `net` 的 GET 实现。
 * 只支持 GET（插件市场查询与 tarball 下载都只需要 GET）。
 */
export function createElectronHttpGet(): HttpGet {
  return function electronHttpGet(req: HttpRequest): Promise<HttpResponse> {
    const { net } = require('electron');
    const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT_MS;
    const maxBytes = req.maxBytes && req.maxBytes > 0 ? req.maxBytes : DEFAULT_MAX_BYTES;

    return new Promise<HttpResponse>((resolve, reject) => {
      let settled = false;
      let request: any;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        done(() => reject(new Error('请求超时（' + timeoutMs + 'ms）')));
        try { request && request.abort(); } catch { /* ignore */ }
      }, timeoutMs);

      try {
        request = net.request({ method: 'GET', url: req.url, redirect: 'follow' });
      } catch (err: any) {
        done(() => reject(err));
        return;
      }

      const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA, ...(req.headers || {}) };
      for (const [k, v] of Object.entries(headers)) {
        try { request.setHeader(k, v); } catch { /* 非法头名忽略 */ }
      }

      request.on('response', (response: any) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let overflow = false;

        response.on('data', (chunk: Buffer) => {
          if (overflow) return;
          const buf = Buffer.from(chunk);
          received += buf.byteLength;
          if (received > maxBytes) {
            overflow = true;
            done(() => reject(new Error('响应体超过上限（' + maxBytes + ' 字节）')));
            try { request.abort(); } catch { /* ignore */ }
            return;
          }
          chunks.push(buf);
        });

        response.on('end', () => {
          if (overflow) return;
          const raw = response.headers || {};
          const lower: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            lower[String(k).toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
          }
          done(() => resolve({
            status: response.statusCode,
            headers: lower,
            body: Buffer.concat(chunks),
          }));
        });

        response.on('error', (err: any) => done(() => reject(err)));
      });

      request.on('error', (err: any) => done(() => reject(err)));
      request.end();
    });
  };
}

export { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES, DEFAULT_UA };

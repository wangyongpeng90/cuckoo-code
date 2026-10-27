/**
 * 插件本地 HTTP 服务（ctx.webServer · 静态资源版）
 *
 * 给插件一个「能被访问的 HTTP 端点」——插件把目录暴露成 URL。
 * 监听 127.0.0.1 随机端口；请求 /plugins/<pluginId>/<prefix>/<path> → 读插件目录文件返回。
 *
 * 安全：只绑 127.0.0.1；只允许已启用插件；路径防穿越。
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listInstalledPlugins, isPluginEnabled } from '../../plugins/index.js';

// electron 特殊：其 index.js 导出字符串，须用 createRequire（见 P3a 手册 1.5；
// 与本目录其它 IPC 模块一致——ESM 直连 import 会绕过测试对 createRequire 的打桩）。
const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

interface ServeRoute {
  pluginId: string;
  /** URL 前缀，如 /assets */
  prefix: string;
  /** 相对插件目录的物理目录，如 assets */
  dir: string;
}

/** 动态路由（插件注册的 HTTP 处理器，DSH ctx.webServer.register 语义） */
interface DynamicRoute {
  pluginId: string;
  /** 'exact' = 精确匹配 path；'prefix' = 前缀匹配 */
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: any, res: any) => any;
}

const routes: ServeRoute[] = [];
const dynamicRoutes: DynamicRoute[] = [];

/**
 * 壳页面令牌（方案 B）：
 * 壳页面是 file:// 协议，fetch 到 http://127.0.0.1 时浏览器标 "Sec-Fetch-Site: cross-site"
 * → 插件（如 dsh-market）的同源检查会拒绝（误判为"外部网页"）。
 *
 * 解法：主进程启动时生成随机令牌，只存内存；
 *  - 壳页面通过 IPC 拿到令牌，fetch 时带 X-Cuckoo-Shell 头
 *  - 本服务器见到正确令牌 → 删掉 sec-fetch-site/origin 头再转发（模拟同源）
 *  - 外部网页拿不到令牌（浏览器禁止跨站自定义头）→ 照旧被插件拒绝
 */
const SHELL_TOKEN = require('node:crypto').randomBytes(24).toString('hex');

/** 暴露给 preload（壳页面取令牌用） */
function getShellToken(): string { return SHELL_TOKEN; }

/** 列出当前所有动态路由的 path（壳页面 fetch 拦截器用：动态判断"哪些 URL 是插件 API"） */
function listDynamicRoutes(): Array<{ path: string; kind: 'exact' | 'prefix' }> {
  return dynamicRoutes.map((r) => ({ path: r.path, kind: r.kind }));
}

/** 注册一个动态路由（返回 disposer）。插件宿主侧在主进程执行，handler 直接挂进 http server。 */
function registerDynamicRoute(pluginId: string, spec: { kind?: string; path: string; handler: (req: any, res: any) => any }): () => void {
  const kind = spec && spec.kind === 'prefix' ? 'prefix' : 'exact';
  const p = spec && typeof spec.path === 'string' ? spec.path : '';
  const handler = spec && spec.handler;
  if (!p || typeof handler !== 'function') return () => {};
  const rec: DynamicRoute = { pluginId, kind, path: p, handler };
  dynamicRoutes.push(rec);
  // 懒启动服务器（第一次注册时）
  ensureServer().catch(() => {});
  return () => {
    const i = dynamicRoutes.indexOf(rec);
    if (i >= 0) dynamicRoutes.splice(i, 1);
  };
}
let server: http.Server | null = null;
let port = 0;

const MIME: Record<string, string> = {
  '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.html': 'text/html',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.moc3': 'application/octet-stream', '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
function guessMime(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** 启动服务（懒加载，第一次注册路由时启动） */
function ensureServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server && port) return resolve(port);
    server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        // 方案 B：壳页面带的令牌 → 删掉"跨站"标记（模拟同源，让插件放行）
        if (req.headers['x-cuckoo-shell'] === SHELL_TOKEN) {
          delete req.headers['sec-fetch-site'];
          delete req.headers['sec-fetch-mode'];
          delete req.headers['sec-fetch-dest'];
          delete req.headers.origin;
          delete req.headers.referer;
        }
        // 跨域预检（OPTIONS）直接放行：file:// 页面带自定义头 X-Cuckoo-Shell 时会触发预检
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cuckoo-Shell',
            'Access-Control-Max-Age': '86400',
          });
          res.end();
          return;
        }

        // 全局注入 CORS 头（对动态路由和静态资源都生效），防止浏览器直接报 Failed to fetch
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cuckoo-Shell');

        // 1) 动态路由优先（插件注册的 HTTP 处理器）
        const dyn = dynamicRoutes.find((r) => r.kind === 'exact' ? url.pathname === r.path : url.pathname.startsWith(r.path));
        if (dyn) {
          try {
            const out = dyn.handler(req, res);
            if (out && typeof out.then === 'function') out.catch((e: any) => { try { if (!res.headersSent) { res.writeHead(500); } res.end('handler error: ' + String(e && e.message ? e.message : e)); } catch (_) {} });
          } catch (e: any) {
            try { if (!res.headersSent) { res.writeHead(500); } res.end('handler error: ' + String(e && e.message ? e.message : e)); } catch (_) {}
          }
          return;
        }
        // 2) 静态资源（/plugins/<id>/<prefix>/...）
        const m = url.pathname.match(/^\/plugins\/([^/]+)(\/.*)?$/);
        if (!m) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
          return;
        }
        const pluginId = decodeURIComponent(m[1]);
        const rest = m[2] || '/';
        const route = routes.find(r => r.pluginId === pluginId && (rest === r.prefix || rest.startsWith(r.prefix + '/')));
        if (!route) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'no route', pluginId, path: url.pathname }));
          return;
        }
        const relInDir = rest.slice(route.prefix.length).replace(/^\//, '');
        // 找插件目录
        const plugins = listInstalledPlugins();
        const target = plugins.find((p: any) => p.manifest && p.manifest.id === pluginId);
        if (!target) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'plugin not found', pluginId }));
          return;
        }
        const root = path.resolve(target.dir, route.dir);
        const abs = path.resolve(root, relInDir || 'index.html');
        const prefix = root.endsWith(path.sep) ? root : root + path.sep;
        if (abs !== root && !abs.startsWith(prefix)) { res.writeHead(403); res.end('forbidden'); return; }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'file not found', path: url.pathname }));
          return;
        }
        const buf = fs.readFileSync(abs);
        res.writeHead(200, { 'Content-Type': guessMime(abs), 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(buf);
      } catch (err: any) {
        res.writeHead(500); res.end(String(err && err.message ? err.message : err));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(port);
    });
    server.on('error', reject);
  });
}

function registerWebServerIpc(): void {
  // 列出所有动态路由（壳页面 fetch 拦截器用）
  ipcMain.handle('plugin-web-routes', async () => {
    try { return { success: true, routes: listDynamicRoutes() }; }
    catch (err: any) { return { success: false, routes: [], error: err && err.message ? err.message : String(err) }; }
  });
  // 插件注册一个静态路由
  ipcMain.handle('plugin-webserver-serve', async (_event: any, { pluginId, prefix, dir }: any = {}) => {
    try {
      if (typeof pluginId !== 'string' || !pluginId) return { success: false, error: '缺少 pluginId' };
      if (typeof prefix !== 'string' || !prefix.startsWith('/')) return { success: false, error: 'prefix 必须以 / 开头' };
      if (typeof dir !== 'string' || !dir) return { success: false, error: '缺少 dir' };
      const plugins = listInstalledPlugins();
      const target = plugins.find((p: any) => p.manifest && p.manifest.id === pluginId);
      if (!target) return { success: false, error: '插件不存在: ' + pluginId };
      if (!isPluginEnabled(pluginId)) return { success: false, error: '插件未启用: ' + pluginId };
      // 已存在则更新
      const exist = routes.find(r => r.pluginId === pluginId && r.prefix === prefix);
      if (exist) { exist.dir = dir; } else { routes.push({ pluginId, prefix, dir }); }
      const p = await ensureServer();
      const base = 'http://127.0.0.1:' + p + '/plugins/' + encodeURIComponent(pluginId) + prefix;
      return { success: true, port: p, url: base, base };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // 取壳页面令牌（壳页面 fetch 时带 X-Cuckoo-Shell 头）
  ipcMain.handle('shell-token', async () => ({ token: SHELL_TOKEN }));

  // 取服务端口/基础 URL
  ipcMain.handle('plugin-webserver-info', async () => {
    try {
      const p = await ensureServer();
      return { success: true, port: p, base: 'http://127.0.0.1:' + p };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

export { registerWebServerIpc, registerDynamicRoute, listDynamicRoutes };

/**
 * 插件本地 HTTP 服务（ctx.webServer · 静态资源版）
 *
 * 给插件一个「能被访问的 HTTP 端点」——插件把目录暴露成 URL。
 * 监听 127.0.0.1 随机端口；请求 /plugins/<pluginId>/<prefix>/<path> → 读插件目录文件返回。
 *
 * 安全：只绑 127.0.0.1；只允许已启用插件；路径防穿越。
 */
import { ipcMain } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listInstalledPlugins, isPluginEnabled } from '../../plugins/index.js';

interface ServeRoute {
  pluginId: string;
  /** URL 前缀，如 /assets */
  prefix: string;
  /** 相对插件目录的物理目录，如 assets */
  dir: string;
}

const routes: ServeRoute[] = [];
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
        const m = url.pathname.match(/^\/plugins\/([^/]+)(\/.*)?$/);
        if (!m) { res.writeHead(404); res.end('not found'); return; }
        const pluginId = decodeURIComponent(m[1]);
        const rest = m[2] || '/';
        const route = routes.find(r => r.pluginId === pluginId && (rest === r.prefix || rest.startsWith(r.prefix + '/')));
        if (!route) { res.writeHead(404); res.end('no route'); return; }
        const relInDir = rest.slice(route.prefix.length).replace(/^\//, '');
        // 找插件目录
        const plugins = listInstalledPlugins();
        const target = plugins.find((p: any) => p.manifest && p.manifest.id === pluginId);
        if (!target) { res.writeHead(404); res.end('plugin not found'); return; }
        const root = path.resolve(target.dir, route.dir);
        const abs = path.resolve(root, relInDir || 'index.html');
        const prefix = root.endsWith(path.sep) ? root : root + path.sep;
        if (abs !== root && !abs.startsWith(prefix)) { res.writeHead(403); res.end('forbidden'); return; }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); res.end('file not found'); return; }
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

export { registerWebServerIpc };

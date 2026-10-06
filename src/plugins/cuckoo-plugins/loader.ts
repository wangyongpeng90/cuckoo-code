/**
 * Cuckoo 插件加载器（DSH 兼容）。
 *
 * 链路：插件目录（npm 包）→ 找入口 → esbuild 打包（@deepseek-ai/* 映射到 shim）
 *      → 执行产物 → apply(ctx) → 收集注册的工具
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** 我们自己的 DSH 兼容 shim：开发/测试用 .ts，打包后用 .js */
function shimPath(): string {
  const base = path.join(import.meta.dirname, '..', 'dsh-compat', 'shim');
  if (fs.existsSync(base + '.ts')) return base + '.ts';
  return base + '.js';
}

/** 找插件入口文件：package.json 的 main/module，否则 index.js */
function resolveEntry(pluginDir: string): string | null {
  let pkg: any = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8'));
  } catch (_) { /* ignore */ }
  const candidates = [
    pkg && pkg.module,
    pkg && pkg.main,
    'index.js',
    'lib/index.js',
    'dist/index.js',
  ].filter((x: any) => typeof x === 'string' && x);
  for (const rel of candidates) {
    const abs = path.join(pluginDir, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/** 万能空接口模块（CJS）：任何属性/调用/构造都返回 stub，永不抛错 */
const STUB_MODULE_CODE = [
  "const __makeStub = (name) => {",
  "  const fn = function () { return p; };",
  "  const p = new Proxy(fn, {",
  "    get(t, prop) {",
  "      if (prop === 'then') return undefined;",
  "      if (prop === '__esModule') return false;",
  "      if (prop === 'default') return p;",
  "      if (prop === 'toString') return () => '[dsh-stub ' + name + ']';",
  "      return __makeStub(name + '.' + String(prop));",
  "    },",
  "    apply() { return p; },",
  "    construct() { return p; },",
  "  });",
  "  return p;",
  "};",
  "module.exports = __makeStub('@deepseek-ai/stub');",
].join('\n');

/** 用 esbuild 打包插件：把 @deepseek-ai/* 映射到我们的 shim */
async function bundlePlugin(entryFile: string): Promise<string> {
  const esbuild = require(path.join(process.cwd(), 'node_modules', 'esbuild', 'lib', 'main.js'));
  const shim = shimPath();
  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
    plugins: [{
      name: 'cuckoo-dsh-shim',
      setup(build: any) {
        // @deepseek-ai/cordis / dsh-tools → 我们的 shim（真实现）
        build.onResolve({ filter: /^@deepseek-ai\/(cordis|dsh-tools)$/ }, () => ({ path: shim }));
        // 其他（含 schemastery）→ 万能空接口（CJS 虚拟模块，支持 default import）
        build.onResolve({ filter: /^@deepseek-ai\// }, (args: any) => ({ path: args.path, namespace: 'dsh-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'dsh-stub' }, () => ({ contents: STUB_MODULE_CODE, loader: 'js' }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

/** 万能 stub（与 shim 同款）：任意属性/调用/构造不抛错 */
function makeStub(name: string): any {
  const fn: any = function () { return p; };
  const p: any = new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === '__esModule') return false;
      if (prop === 'default') return p;
      if (prop === 'toString') return () => '[dsh-stub ' + name + ']';
      return makeStub(name + '.' + String(prop));
    },
    apply() { return p; },
    construct() { return p; },
  });
  return p;
}

/** 一个"假 ctx"——收集插件注册的工具；未知属性用 stub 兜底（够用空接口） */
function createCollectorCtx(pluginName: string): { ctx: any; tools: any[] } {
  const tools: any[] = [];
  const base: any = {
    name: pluginName,
    log: (...args: any[]) => console.log('[DSHPlugin:' + pluginName + ']', ...args),
    tools: {
      register(tool: any) { tools.push(tool); return () => {}; },
      list() { return tools.map((t) => t.name); },
    },
    on() { return () => {}; },
    once() { return () => {}; },
    off() {},
    emit() {},
    effect(fn: any) { try { const c = fn(); return typeof c === 'function' ? c : () => {}; } catch (_) { return () => {}; } },
    scope() { return { effect: () => () => {}, on: () => () => {}, dispose() {}, disposed: false }; },
    provide() { return () => {}; },
    get() { return undefined; },
    // inject 回调传 ctx 自身（带 stub 兜底），插件拿到 projectionCtx.sessionProjections 等不报错
    inject(_names: any, cb: any) { if (typeof cb === 'function') { try { cb(ctx); } catch (_) { /* 空转 */ } } return () => {}; },
  };
  // 未知属性 → stub 兜底
  const ctx: any = new Proxy(base, {
    get(t, prop) {
      if (prop in t) return (t as any)[prop];
      if (typeof prop === 'symbol') return undefined;
      return makeStub('ctx.' + String(prop));
    },
  });
  return { ctx, tools };
}

/** 从插件目录加载，返回 { pluginName, tools } */
async function loadCuckooPlugin(pluginDir: string): Promise<{ pluginName: string; tools: any[] }> {
  const entry = resolveEntry(pluginDir);
  if (!entry) throw new Error('未找到插件入口（package.json main / index.js）');
  const code = await bundlePlugin(entry);
  const moduleObj: any = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code + '\n;return module.exports;');
  const mod = fn(moduleObj, moduleObj.exports, require);
  const plugin = (mod && mod.default && typeof mod.default === 'object') ? mod.default : mod;
  const pluginName = (plugin && typeof plugin.name === 'string' && plugin.name) ? plugin.name : path.basename(pluginDir);
  const { ctx, tools } = createCollectorCtx(pluginName);
  if (plugin && typeof plugin.apply === 'function') {
    await plugin.apply(ctx, {});
  }
  return { pluginName, tools };
}

export { loadCuckooPlugin, resolveEntry, bundlePlugin };

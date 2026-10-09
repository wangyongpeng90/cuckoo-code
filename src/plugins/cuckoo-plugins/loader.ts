/**
 * Cuckoo 插件加载器（DSH 兼容）。
 *
 * 链路：插件目录（npm 包）→ 找入口 → esbuild 打包（@deepseek-ai/* 映射到 shim）
 *      → 执行产物 → apply(ctx) → 收集注册的工具
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DshRuntime } from '../dsh-compat/runtime.js';
import { setDshSession } from '../dsh-compat/shim.js';
import { EventBus } from '../runtime/events.js';
import { registerBus, unregisterBus } from './event-bridge.js';
import { registerPromptSection, getPromptSections } from '../dsh-compat/prompt-sections.js';
import { createFs } from '../dsh-compat/fs-service.js';
import { createAgents } from '../dsh-compat/agents-service.js';
import { PluginStorage } from './plugin-storage.js';
import { createC6Services } from '../dsh-compat/c6-services.js';

const require = createRequire(import.meta.url);

/** 我们自己的 DSH 兼容 shim：开发/测试用 .ts，打包后用 .js */
function shimPath(): string {
  const base = path.join(import.meta.dirname, '..', 'dsh-compat', 'shim');
  if (fs.existsSync(base + '.ts')) return base + '.ts';
  return base + '.js';
}

/** 在某目录里找入口文件：package.json 的 main/module，否则 index.js 等 */
function findEntryIn(dir: string): string | null {
  let pkg: any = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  } catch (_) { /* ignore */ }
  const candidates = [
    pkg && pkg.module,
    pkg && pkg.main,
    'index.js',
    'lib/index.js',
    'dist/index.js',
  ].filter((x: any) => typeof x === 'string' && x);
  for (const rel of candidates) {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

/**
 * 找插件入口。
 * 1) 先找插件目录自身（package.json main / index.js）；
 * 2) 找不到 → 它是"npm 安装的壳目录"（只写了 dependencies），
 *    去 node_modules/<每个依赖> 里找（真正的插件包在那）。
 */
function resolveEntry(pluginDir: string): string | null {
  const direct = findEntryIn(pluginDir);
  if (direct) return direct;
  // 壳目录：遍历 dependencies，去 node_modules 里找
  let pkg: any = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8'));
  } catch (_) { /* ignore */ }
  const deps = (pkg && pkg.dependencies) || {};
  for (const depName of Object.keys(deps)) {
    const depDir = path.join(pluginDir, 'node_modules', depName);
    const entry = findEntryIn(depDir);
    if (entry) return entry;
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

/** 宿主能力：由 app 层注入（plugins 层不能直接依赖 app/session） */
interface CuckooHost {
  /** 工具名列表（真·registry） */
  getToolNames?: () => string[];
  /** 读插件自己的配置（plugins-config） */
  getPluginConfig?: (pluginId: string, defaults?: any) => Record<string, any>;
  /** 写插件自己的配置 */
  setPluginConfig?: (pluginId: string, values: Record<string, any>) => boolean;
  /** 当前会话（id + 项目目录） */
  getCurrentSession?: () => { id: string | null; projectDir: string | null };
  /** 所有会话列表 */
  listSessions?: () => Array<{ id: string; title?: string }>;
  /** 某会话 */
  getSession?: (id: string) => { id: string; title?: string } | null;
  // ===== C6 =====
  listSkills?: () => Array<{ name: string; description?: string; source?: string }>;
  listCommands?: () => Array<{ id: string; title: string }>;
  registerCommand?: (cmd: { id: string; title: string; run: () => any }) => () => void;
  getGoal?: () => { active: boolean; text?: string } | null;
  triggerCompaction?: () => Promise<boolean>;
  listWorkspaceFiles?: () => Array<{ path: string; type: string }>;
  getSessionTitle?: () => string | null;
  setSessionTitle?: (title: string) => boolean;
  getTokens?: () => { context: number; cumulative: number; today: number; windowCumulative: number; total: number };
}

/** 一个"假 ctx"——收集插件注册的工具；未知属性用 stub 兜底（够用空接口） */
function createCollectorCtx(pluginName: string, host?: CuckooHost, runtime?: any): { ctx: any; tools: any[]; bus: EventBus } {
  const tools: any[] = [];
  // 插件专属事件总线（C3）：ctx.on/emit 接真；注册到桥以接收 Cuckoo 事件
  const bus = new EventBus();
  registerBus(bus);
  const base: any = {
    // 会话投影注册表（C2）：插件 register 的投影，能驱动、能读回
    sessionProjections: runtime ? runtime.projections : undefined,
    name: pluginName,
    log: (...args: any[]) => console.log('[DSHPlugin:' + pluginName + ']', ...args),
    tools: {
      register(tool: any) { tools.push(tool); return () => {}; },
      // 真·列出工具（宿主注入；无则退回本插件注册的）
      list() { return host && host.getToolNames ? host.getToolNames() : tools.map((t) => t.name); },
    },
    // 真·设置（接 plugins-config：插件自己的配置）
    settings: {
      get(key: string) {
        if (!host || !host.getPluginConfig) return undefined;
        return host.getPluginConfig(pluginName)[key];
      },
      set(key: string, value: any) {
        if (!host || !host.setPluginConfig || !host.getPluginConfig) return;
        const cur = host.getPluginConfig(pluginName);
        cur[key] = value;
        host.setPluginConfig(pluginName, cur);
      },
    },
    // 文件服务（C4-B）：接真（node:fs，项目根由宿主提供）
    fs: createFs(() => (host && host.getCurrentSession ? host.getCurrentSession().projectDir : null)),
    // 子代理服务（C4-C）：会话 → agent 视图
    agents: createAgents(host),
    // C6：skills/commands/goals/compaction/workspaceFiles/sessionTitle/tokenMeter
    ...createC6Services(host),
    // 提示词段（C4）：插件 ctx.systemPrompt.section(...) 注册进全局表
    systemPrompt: {
      section(sec: any) { return registerPromptSection(sec, pluginName); },
      /** 取已注册段（DSH 有的读面） */
      sections() { return getPromptSections(); },
    },
    // 真·会话（宿主注入）
    sessions: {
      current() { return host && host.getCurrentSession ? host.getCurrentSession() : { id: null, projectDir: null }; },
      list() { return host && host.listSessions ? host.listSessions() : []; },
      get(id: string) { return host && host.getSession ? host.getSession(id) : null; },
    },
    // 事件总线（C3）：接真 EventBus
    on: (event: string, listener: any) => bus.on(event, listener),
    once: (event: string, listener: any) => bus.once(event, listener),
    off: (event: string, listener: any) => bus.off(event, listener),
    emit: (event: string, ...args: any[]) => bus.emit(event, ...args),
    parallel: (event: string, ...args: any[]) => bus.parallel(event, ...args),
    serial: (event: string, ...args: any[]) => bus.serial(event, ...args),
    bail: (event: string, ...args: any[]) => bus.bail(event, ...args),
    waterfall: (event: string, value: any, ...args: any[]) => bus.waterfall(event, value, ...args),
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
  return { ctx, tools, bus };
}

/** 从插件目录加载，返回 { pluginName, tools, runtime, bus } */
async function loadCuckooPlugin(pluginDir: string, host?: CuckooHost): Promise<{ pluginName: string; tools: any[]; runtime: any; bus: any }> {
  const entry = resolveEntry(pluginDir);
  if (!entry) throw new Error('未找到插件入口（package.json main / index.js）');
  // 创建"最小 DSH 运行时"（内存会话 + 投影注册表），注入给插件（C2）
  const runtime = new DshRuntime();
  // C5：接持久化（JSONL 落盘 + 启动重放），按插件 id 隔离
  try { runtime.session.attachStorage(new PluginStorage(path.basename(pluginDir))); } catch (_) { /* ignore */ }
  setDshSession(runtime.session);
  const code = await bundlePlugin(entry);
  const moduleObj: any = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code + '\n;return module.exports;');
  const mod = fn(moduleObj, moduleObj.exports, require);
  const plugin = (mod && mod.default && typeof mod.default === 'object') ? mod.default : mod;
  const pluginName = (plugin && typeof plugin.name === 'string' && plugin.name) ? plugin.name : path.basename(pluginDir);
  const { ctx, tools, bus } = createCollectorCtx(pluginName, host, runtime);
  if (plugin && typeof plugin.apply === 'function') {
    await plugin.apply(ctx, {});
  }
  return { pluginName, tools, runtime, bus };
}

export { loadCuckooPlugin, resolveEntry, bundlePlugin };
export type { CuckooHost };

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
import { createC7Services } from '../dsh-compat/c7-services.js';
import { createC8Services } from '../dsh-compat/c8-services.js';
import { createStorageDomain, createConnection } from '../dsh-compat/storage-service.js';
import { createWorkspaceRegistry } from '../../session/workspace-registry.js';
import { createLlm, createAgentDefaultModelFromWindow } from '../dsh-compat/llm-service.js';
import { CHILD_PROCESS_SHIM_CODE } from '../dsh-compat/cp-shim-code.js';
import { getProfileDir, getProfilePatchPath, ensureProfile, DEFAULT_PROFILE, listProfilePluginEntries } from '../profile/index.js';
import { getPnpmInvocation } from '../profile/pnpm.js';

const require = createRequire(import.meta.url);
const { app } = require('electron');

/** 应用根目录：开发=项目根，打包=asar 根（用于定位 node_modules/esbuild 等内置依赖） */
function getAppRoot(): string {
  try { return app.getAppPath(); } catch (_) { return process.cwd(); }
}

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

/**
 * DSH CLI 兼容 shim（child_process）—— CJS 源码
 *
 * 作用：插件 spawn/exec "dsh" 命令时截住它，翻译成 pnpm（在 profile 目录跑）。
 * 环境（profileDir/pnpm 路径/env）通过 globalThis.__CUCKOO_DSH__ 注入。
 *
 * ⚠️ 必须【具名导出】（spawn/spawnSync/exec/execSync）——插件用
 *    import { spawn } from 'node:child_process'（具名导入）。
 */

/** 用 esbuild 打包插件：把 @deepseek-ai/* 映射到我们的 shim */
async function bundlePlugin(entryFile: string): Promise<string> {
  const esbuild = require(path.join(getAppRoot(), 'node_modules', 'esbuild', 'lib', 'main.js'));
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
        // node:child_process → 我们的 shim（拦截 dsh 命令 → 翻译成 pnpm）
        // ⚠️ shim 自身要 real 模块（否则递归）——用 namespace 标记
        build.onResolve({ filter: /^(node:)?child_process$/ }, (args: any) => {
          if (args.namespace === 'ck-dsh-cp') return { external: true };  // shim 内部 → 真模块
          return { path: 'child_process', namespace: 'ck-dsh-cp' };
        });
        build.onLoad({ filter: /.*/, namespace: 'ck-dsh-cp' }, () => ({ contents: CHILD_PROCESS_SHIM_CODE, loader: 'js' }));
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
  /** 所有会话列表（带 projectDir） */
  listSessions?: () => Array<{ id: string; title?: string; projectDir?: string | null }>;
  /** 某会话 */
  getSession?: (id: string) => { id: string; title?: string } | null;
  /** 所有窗口（DSH llm 服务用：provider=平台, model=窗口） */
  listWindows?: () => Array<{ id: string; name: string; providerId: string }>;
  /** 逻辑 ID 翻译层（logicId ↔ webId） */
  logicIdMap?: { webIdOf(logicId: any): any; logicIdOf(webId: any): any; bind(logicId: any, webId: any): void; ensureLogicId(webId: any): any; has(logicId: any): boolean };
  /** DSH agents.create 用：把会话窗口导航到首页并等页面就绪（按 profileId 找窗口） */
  navigateWindowToHome?: (logicId: string, profileId: string | null, providerId: string | null) => Promise<boolean>;
  /** DSH agents.create 用：构建系统提示词（providerId 决定模板） */
  buildSystemPrompt?: (projectDir: string, providerId: string) => string;
  /** DSH agents.create 用：往会话窗口发用户消息（按 profileId 找窗口） */
  sendUserMessage?: (logicId: string, profileId: string | null, text: string) => boolean;
  /** DSH agents.create 用：保存"会话 → 目录"映射（profileId 决定会话归属哪个窗口） */
  saveSessionDirMapping?: (logicId: string, projectDir: string, profileId?: string | null) => boolean;
  /** 按 logicId 设置会话标题 */
  setSessionTitleForId?: (logicId: string, title: string) => void;
  /** 广播 session/event.turn/end（dsh-tasks 监听） */
  broadcastTurnEnd?: (logicId: string, reason: 'completed' | 'error' | 'max-tokens' | 'aborted') => void;
  /** 读会话的待发消息队列 */
  getSessionQueue?: (logicId: string) => any[];
  /** 写会话的待发消息队列 */
  setSessionQueue?: (logicId: string, queue: any[]) => void;
  /** [022] SQLite 连接（workspace-registry 用；由 app 层注入） */
  db?: any;
  /** 当前窗口（DSH agentDefaultModel 用） */
  getCurrentWindow?: () => { id: string; name: string; providerId: string } | null;
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
  // ===== C7 =====
  listSubagents?: () => Array<{ name: string; description?: string }>;
  runSubagent?: (name: string, task: string) => Promise<string>;
  runCommand?: (command: string, opts?: { cwd?: string; timeoutMs?: number }) => Promise<{ stdout: string; stderr?: string; exitCode: number }>;
  querySession?: (sessionId: string) => { id: string; title?: string; projectDir?: string | null } | null;
  // ===== C8 =====
  mcpCall?: (server: string, tool: string, args?: any) => Promise<any>;
  mcpListServers?: () => Promise<any>;
  mcpGetTools?: (server: string) => Promise<any>;
  webFetch?: (url: string) => Promise<string>;
  openBrowserWindow?: (url: string, opts?: any) => Promise<any>;
  injectJS?: (windowId: string, code: string) => Promise<any>;
  attachFile?: (filePath: string) => Promise<any>;
  runTerminal?: (command: string, opts?: any) => Promise<{ stdout: string; exitCode: number }>;
  // ===== UI 槽位（对标 DSH slots）=====
  /** 注册一个 UI 槽位（返回 disposer） */
  registerSlot?: (spec: { pluginId: string; slot: string; id: string; order?: number; spec?: any }) => () => void;
  // ===== 宿主服务：webServer（DSH ctx.webServer.register）=====
  /** 注册一个动态 HTTP 路由（返回 disposer） */
  registerHttpRoute?: (spec: { pluginId: string; kind?: string; path: string; handler: (req: any, res: any) => any }) => () => void;
}

/** 一个"假 ctx"——收集插件注册的工具；未知属性用 stub 兜底（够用空接口） */
function createCollectorCtx(pluginName: string, host?: CuckooHost, runtime?: any): { ctx: any; tools: any[]; bus: EventBus; disposers: Array<() => void> } {
  const tools: any[] = [];
  // HMR：收集所有"卸载"函数（effect 返回 / 工具注销 / 插槽注销 / 路由注销）
  const disposers: Array<() => void> = [];
  const addDisposer = (d: any) => { if (typeof d === 'function') disposers.push(d); return d || (() => {}); };
  // 插件专属事件总线（C3）：ctx.on/emit 接真；注册到桥以接收 Cuckoo 事件
  const bus = new EventBus();
  registerBus(bus);
  const base: any = {
    // 会话投影注册表（C2）：插件 register 的投影，能驱动、能读回
    sessionProjections: runtime ? runtime.projections : undefined,
    name: pluginName,
    log: (...args: any[]) => dbg('log @' + pluginName + ': ' + args.map(String).join(' ')),
    // ⚠️ DSH 插件用【属性访问】（host.webServer.register）——不是只有 ctx.get()
    // 这里把常用服务同时挂成属性，避免走 Proxy stub（静默失败）
    get webServer() { return (ctx as any).get ? (ctx as any).get('webServer') : undefined; },
    // [022] workspaceRegistry 也必须走属性访问——dsh-tasks 用 ctx.workspaceRegistry.get(id)
    // 漏了这行会导致属性访问走 Proxy stub，workspace.path 变成函数，create 报 "meta.cwd got function"
    get workspaceRegistry() { return (ctx as any).get ? (ctx as any).get('workspaceRegistry') : undefined; },
    get loader() {
      // dsh-market 调 host.loader.entries() —— 返回 profile 里已装的插件清单
      return {
        entries: () => {
          try {
            return listProfilePluginEntries().map((e: any) => ({ id: e.id, name: e.name, dir: e.dir, enabled: e.enabled }));
          } catch (_) { return []; }
        },
      };
    },
    // dsh-market 的 /status 用 host.version + host.directory
    version: 'cuckoo-0.8.13',
    directory: (() => { try { return ensureProfile(DEFAULT_PROFILE); } catch (_) { return ''; } })(),
    logger: {
      warn: (...a: any[]) => dbg('warn @' + pluginName + ': ' + a.map(String).join(' ')),
      info: (...a: any[]) => dbg('info @' + pluginName + ': ' + a.map(String).join(' ')),
      error: (...a: any[]) => dbg('error @' + pluginName + ': ' + a.map(String).join(' ')),
    },
    tools: {
      register(tool: any) {
        tools.push(tool);
        // HMR：注销工具（从 host 卸载）
        return addDisposer(() => {
          try {
            if (host && typeof (host as any).unregisterTool === 'function') (host as any).unregisterTool(tool.name);
          } catch (_) {}
          const i = tools.indexOf(tool); if (i >= 0) tools.splice(i, 1);
        });
      },
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
    // C7：subagents / shell / sessionQuery
    ...createC7Services(host),
    // C8：mcpResources / web / browserUse / attachments / terminals / computerUse / ssh / lsp
    ...createC8Services(host),
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
    effect(fn: any) {
      // ⚠️ 加错误日志——dsh-market 的 mountMarketRoutes throw 会藏在这里
      try {
        const c = fn();
        // HMR：收集 disposer（卸载时调用）
        return addDisposer(typeof c === 'function' ? c : () => {});
      } catch (e: any) {
        dbg('effect 执行失败 @' + pluginName + ': ' + (e && e.message ? e.message : String(e)));
        console.error('[cuckoo-plugin] effect 执行失败 @' + pluginName, e);
        if (e && e.stack) dbg(String(e.stack).slice(0, 800));
        return () => {};
      }
    },
    scope() { return { effect: () => () => {}, on: () => () => {}, dispose() {}, disposed: false }; },
    provide() { return () => {}; },
    // 服务查找（DSH ctx.get(服务名)）：把已有服务 + 补齐的方法暴露出来
    get(key: string) {
      // webServer：动态 HTTP 路由
      if (key === 'webServer') {
        return {
          register: (spec: any) => {
            if (!host || typeof host.registerHttpRoute !== 'function') return () => {};
            try { return host.registerHttpRoute({ pluginId: pluginName, kind: spec && spec.kind, path: spec && spec.path, handler: spec && spec.handler }) || (() => {}); }
            catch (_) { return () => {}; }
          },
        };
      }
      // agents：会话映射的 agent（已有）
      if (key === 'agents') return base.agents;
      // sessions：会话查询（已有）
      if (key === 'sessions') return base.sessions;
      // tools：工具注册表（补 schemas）
      if (key === 'tools') {
        return {
          register: base.tools.register,
          list: base.tools.list,
          schemas: (_scope?: any) => {
            const names = (host && host.getToolNames) ? host.getToolNames() : tools.map((t: any) => t.name);
            return names.map((n: string) => ({ name: n, description: '' }));
          },
        };
      }
      // sessionPersistence：会话持久化
      if (key === 'sessionPersistence') {
        return {
          list: () => (host && host.listSessions ? host.listSessions().map((s: any) => ({ id: s.id, title: s.title })) : []),
        };
      }
      // workspaceRegistry：持久化的工作区注册表
      // [022] 决策 9.5：从"从 session.projectDir 动态聚合"升级为 SQLite 持久化注册表
      // 详见 docs/requirements/022-dsh-plugin-compat.md C4-D + docs/dsh-compat-decisions.md 9.5
      // [022] 决策 B：host.db 缺失时返回空壳（静默降级，避免破坏其他插件加载）
      if (key === 'workspaceRegistry') {
        if (!host || !host.db) {
          dbg('workspaceRegistry: host.db 缺失，返回空壳');
          return {
            create: async () => { throw new Error('workspaceRegistry: db not available'); },
            get: () => undefined,
            list: () => [],
            resolveByPath: () => undefined,
          };
        }
        return createWorkspaceRegistry(host.db);
      }
      // agentPresets：DSH 的 Agent 预设服务（C-light 简化版）
      // [022] 决策 9.4：C-light——诚实映射 Cuckoo 现状（默认=全量工具）
      //   - resolve(id?) → { id: id ?? 'default' }（永不 throw、永不带 broken）
      //   - mount(ctx, id?) → { id: id ?? 'default' }（空操作，Cuckoo 无 preset 概念）
      //   - 详见 docs/dsh-compat-decisions.md 9.4
      //   为什么够用：dsh-tasks 永远 resolve(undefined)，从不指定自定义 preset
      if (key === 'agentPresets') {
        return {
          resolve: async (id?: string) => ({ id: id ?? 'default' }),
          mount: async (_ctx: any, id?: string) => ({ id: id ?? 'default' }),
        };
      }
      // ===== profileContext：DSH profile 上下文（对齐 DSH 的 ProfileContext）=====
      // dsh-market 用它拿"profile 目录"（装插件的位置）+ packageManager（pnpm 命令）
      if (key === 'profileContext') {
        try {
          const profileDir = ensureProfile(DEFAULT_PROFILE);
          const home = require('node:os').homedir();
          return {
            name: DEFAULT_PROFILE,
            dir: profileDir,
            patchPath: getProfilePatchPath(profileDir),
            installAnchor: profileDir,
            cwd: getAppRoot(),
            home,
            packageManager: getPnpmInvocation(),
            startedBundles: [],
            overlays: [],
            telemetryDisabledEnv: undefined,
          };
        } catch (e: any) {
          dbg('profileContext 构造失败 @' + pluginName + ': ' + (e && e.message ? e.message : String(e)));
          return undefined;
        }
      }
      // sessionProjectionCache：DSH 内部缓存，暂不提供
      if (key === 'sessionProjectionCache') return undefined;
      // C9：storageDomain / agentDefaultModel / connection / llm
      if (key === 'storageDomain') return base.storageDomain;
      if (key === 'agentDefaultModel') return base.agentDefaultModel;
      if (key === 'connection') return base.connection;
      if (key === 'llm') return base.llm;
      return undefined;
    },
    // inject 回调传 ctx 自身（带 stub 兜底），插件拿到 projectionCtx.sessionProjections 等不报错
    // ⚠️ 不静默吞错误——打印出来（诊断宿主插件为何没挂路由/没生效）
    inject(_names: any, cb: any) {
      if (typeof cb !== 'function') return () => {};
      const names = Array.isArray(_names) ? _names.join(',') : String(_names);
      dbg('inject(' + names + ') 开始 @' + pluginName);
      try {
        const ret = cb(ctx);
        dbg('inject(' + names + ') 完成 @' + pluginName);
        // HMR：收集 inject 回调的 disposer
        return addDisposer(typeof ret === 'function' ? ret : () => {});
      } catch (e: any) {
        dbg('inject(' + names + ') 回调失败 @' + pluginName + ': ' + (e && e.message ? e.message : String(e)));
        if (e && e.stack) dbg(String(e.stack).slice(0, 800));
      }
      return () => {};
    },
    // C9：storageDomain / agentDefaultModel / connection（dsh-tasks 等用）
    storageDomain: createStorageDomain(pluginName),
    // agentDefaultModel：= 当前窗口（provider=平台, model=窗口 id）
    agentDefaultModel: createAgentDefaultModelFromWindow(() => (host && typeof host.getCurrentWindow === 'function' ? host.getCurrentWindow() : null)),
    // llm：一级=provider，二级=窗口（通用，任何插件都能用）
    llm: createLlm(() => (host && typeof host.listWindows === 'function' ? host.listWindows() : [])),
    connection: createConnection(),
    // UI 槽位（对标 DSH slots）：ctx.ui.slot.register({ slot, id, order, ...内容 })
    ui: {
      slot: {
        register(spec: any) {
          const s = spec || {};
          if (!host || typeof host.registerSlot !== 'function') return () => {};
          try { return host.registerSlot({ pluginId: pluginName, slot: s.slot, id: s.id, order: s.order, spec: s }) || (() => {}); }
          catch (_) { return () => {}; }
        },
      },
      // DSH 兼容：ctx.slots（复数）也常见，指向同一套
      slots: {
        register(spec: any) { return (base.ui as any).slot.register(spec); },
        unregister() {},
      },
    },
  };
  // 未知属性 → stub 兜底
  const ctx: any = new Proxy(base, {
    get(t, prop) {
      if (prop in t) return (t as any)[prop];
      if (typeof prop === 'symbol') return undefined;
      return makeStub('ctx.' + String(prop));
    },
  });
  return { ctx, tools, bus, disposers };
}

/** 从插件目录加载，返回 { pluginName, tools, runtime, bus } */
/** 调试日志：写 ~/.cuckoo/cuckoo-plugins-debug.log（主进程 console 看不到） */
function dbg(msg: string): void {
  try {
    const fs = require('node:fs');
    const os = require('node:os');
    const p = require('node:path');
    const file = p.join(os.homedir(), '.cuckoo', 'cuckoo-plugins-debug.log');
    fs.appendFileSync(file, new Date().toISOString() + ' ' + msg + String.fromCharCode(10), 'utf-8');
  } catch (_) { /* ignore */ }
  try { console.log('[cuckoo-plugin] ' + msg); } catch (_) {}
}

async function loadCuckooPlugin(pluginDir: string, host?: CuckooHost): Promise<{ pluginName: string; tools: any[]; runtime: any; bus: any; disposers: Array<() => void> }> {
  const entry = resolveEntry(pluginDir);
  if (!entry) throw new Error('未找到插件入口（package.json main / index.js）');
  // 创建"最小 DSH 运行时"（内存会话 + 投影注册表），注入给插件（C2）
  const runtime = new DshRuntime();
  // C5：接持久化（JSONL 落盘 + 启动重放），按插件 id 隔离
  try { runtime.session.attachStorage(new PluginStorage(path.basename(pluginDir))); } catch (_) { /* ignore */ }
  setDshSession(runtime.session);
  const code = await bundlePlugin(entry);
  // 注入 DSH CLI 兼容环境（child-process-shim 用：把 spawn('dsh') 翻译成 pnpm）
  try {
    const profileDir = ensureProfile(DEFAULT_PROFILE);
    const inv = getPnpmInvocation();
    if (inv) {
      (globalThis as any).__CUCKOO_DSH__ = {
        profileDir,
        pnpmCommand: inv.command,
        pnpmArgs: inv.args,
        env: inv.env,
      };
    }
  } catch (e: any) {
    dbg('注入 __CUCKOO_DSH__ 失败: ' + (e && e.message ? e.message : String(e)));
  }
  const moduleObj: any = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code + '\n;return module.exports;');
  const mod = fn(moduleObj, moduleObj.exports, require);
  const plugin = (mod && mod.default && typeof mod.default === 'object') ? mod.default : mod;
  const pluginName = (plugin && typeof plugin.name === 'string' && plugin.name) ? plugin.name : path.basename(pluginDir);
  const { ctx, tools, bus, disposers } = createCollectorCtx(pluginName, host, runtime);
  dbg('开始 apply @' + pluginName + ' (entry=' + entry + ')');
  if (plugin && typeof plugin.apply === 'function') {
    try {
      await plugin.apply(ctx, {});
      dbg('apply 完成 @' + pluginName);
    } catch (e: any) {
      dbg('apply 失败 @' + pluginName + ': ' + (e && e.message ? e.message : String(e)));
      if (e && e.stack) dbg(String(e.stack).slice(0, 800));
    }
  } else {
    dbg('插件无 apply 函数 @' + pluginName);
  }
  return { pluginName, tools, runtime, bus, disposers };
}

/** 在某目录里找"客户端入口"：package.json 的 exports['./client'] */
function findClientIn(dir: string): string | null {
  let pkg: any = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  } catch (_) { return null; }
  const ex = pkg && pkg.exports;
  let rel: string | null = null;
  if (ex && typeof ex === 'object') {
    const c = ex['./client'];
    if (typeof c === 'string') rel = c;
    else if (c && typeof c === 'object' && typeof c.default === 'string') rel = c.default;
  }
  if (!rel) {
    // 回退：lib/client.js
    rel = 'lib/client.js';
  }
  const abs = path.join(dir, rel);
  return (fs.existsSync(abs) && fs.statSync(abs).isFile()) ? abs : null;
}

/**
 * 找插件的"客户端入口"（DSH 的 ./client）。
 * 与 resolveEntry 同样处理"壳目录"：直接目录找不到 → 去 dependencies 里找。
 */
function resolveClientEntry(pluginDir: string): { file: string; pkgName: string } | null {
  const direct = findClientIn(pluginDir);
  if (direct) {
    // 优先读 package.json 的真名（@scope/name）；读不到才用目录名（短名）
    let realName = '';
    try { realName = String(JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8')).name || ''); } catch (_) { /* ignore */ }
    return { file: direct, pkgName: realName || path.basename(pluginDir) };
  }
  let pkg: any = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8')); } catch (_) { /* ignore */ }
  const deps = (pkg && pkg.dependencies) || {};
  for (const depName of Object.keys(deps)) {
    const depDir = path.join(pluginDir, 'node_modules', depName);
    const entry = findClientIn(depDir);
    if (entry) return { file: entry, pkgName: depName };
  }
  return null;
}

export { loadCuckooPlugin, resolveEntry, bundlePlugin, resolveClientEntry };
export type { CuckooHost };

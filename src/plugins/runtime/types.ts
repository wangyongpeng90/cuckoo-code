/**
 * Cuckoo 插件系统 - 类型定义
 *
 * 目标：在 Cuckoo 里模拟 DSH（DeepSeek Harness）的插件标准，
 * 让 DSH 风格插件（export const name / inject / apply(ctx)）能简单迁移过来。
 *
 * 参考 DSH 标准：
 *  - 入口契约：命名导出 name + inject + apply(ctx, config)
 *  - 服务：ctx.agents / ctx.tools / ctx.sessions ...
 *  - 事件：5 种派发模式 emit / parallel / serial / bail / waterfall
 *  - 事件域：session/event、agent/*、功能事件
 */

/** 插件可消费/提供的服务名 */
export type ServiceName = 'agents' | 'tools' | 'sessions' | 'settings' | 'logs';

/** 插件入口：函数式 */
export type PluginFn = (ctx: PluginContext, config?: any) => void | Promise<void>;

/** 插件入口：对象式 */
export interface PluginObject {
  name: string;
  inject?: ServiceName[];
  apply: PluginFn;
}

/** 插件模块（一个插件文件导出这些） */
export interface PluginModule {
  name?: string;
  inject?: ServiceName[];
  apply?: PluginFn;
  default?: PluginFn;
  [key: string]: any;
}

// ===== 兼容别名（历史命名，保留以免破坏外部引用）=====
/** @deprecated 用 PluginFn */
export type DshPluginFn = PluginFn;
/** @deprecated 用 PluginObject */
export type DshPluginObject = PluginObject;
/** @deprecated 用 PluginModule */
export type DshPluginModule = PluginModule;
/** @deprecated 用 PluginContext */
export type DshContext = PluginContext;
/** @deprecated 用 PluginScope */
export type DshScope = PluginScope;

/** 事件监听器 */
export type EventListener = (...args: any[]) => any;

/** 事件派发模式 */
export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall';

/** agent 服务（对应 DSH 的 ctx.agents） */
export interface AgentsService {
  /** 取当前会话的 agent 句柄 */
  get(sessionId?: string): AgentHandle | null;
  /** 取当前 agent 句柄（无参快捷方式） */
  current(): AgentHandle | null;
  /** 列出所有会话 */
  list(): Array<{ id: string; title?: string }>;
}

/** agent 句柄（对齐 DSH 的 Agent 核心能力） */
export interface AgentHandle {
  id: string;
  /** 生命周期状态（简化：'idle' | 'running' | 'unknown'） */
  status: string;
  /** 当前会话信息 */
  session: { id: string | null; projectDir: string | null };
  /** 向该 agent 追加一条用户消息（对应 DSH 的 followup） */
  followup(msg: { role: 'user'; content: string }): Promise<boolean>;
  /** followup 的别名（对齐 DSH 的 send） */
  send(msg: { role: 'user'; content: string }): Promise<boolean>;
}

/** 工具定义（插件注册用，对齐 DSH 的 ToolDefinition 精神） */
export interface PluginToolDefinition {
  /** 工具名（唯一） */
  name: string;
  /** 描述（发给 AI） */
  description: string;
  /** 参数 JSON Schema */
  parameters?: any;
  /** JS 调用签名（可选，用于提示词） */
  jsApi?: string;
  /** 执行函数 */
  execute(args: any): Promise<any> | any;
}

/** tools 服务（对应 DSH 的 ctx.tools） */
export interface ToolsService {
  /** 列出可用工具名 */
  list(): string[];
  /** 注册一个工具（对齐 DSH 的 ctx.tools.register） */
  register(tool: PluginToolDefinition): () => void;
}

/** sessions 服务 */
export interface SessionsService {
  current(): { id: string | null; projectDir: string | null };
  list(): Array<{ id: string; title?: string }>;
  /** 按 id 取会话（找不到返回 null） */
  get(id: string): { id: string; title?: string } | null;
}

/** settings 服务 */
export interface SettingsService {
  get(key: string): any;
  set(key: string, value: any): void;
}

/** 插件上下文（传给 apply 的 ctx） */
export interface PluginContext {
  /** 插件名 */
  readonly name: string;
  /** 记录日志 */
  log(...args: any[]): void;

  // ===== 服务 =====
  agents: AgentsService;
  tools: ToolsService;
  sessions: SessionsService;
  settings: SettingsService;

  // ===== 事件 =====
  on(event: string, listener: EventListener): () => void;
  once(event: string, listener: EventListener): () => void;
  off(event: string, listener: EventListener): void;

  emit(event: string, ...args: any[]): void;
  parallel(event: string, ...args: any[]): Promise<any[]>;
  serial(event: string, ...args: any[]): Promise<any>;
  bail(event: string, ...args: any[]): any;
  waterfall(event: string, ...args: any[]): Promise<any>;

  // ===== 可逆副作用（DSH 核心）=====
  /** 注册一个可逆副作用；返回 disposer。卸载时自动调用。 */
  effect(fn: () => void | (() => void)): () => void;
  /** 创建子作用域：隔离的 effect 生命周期 */
  scope(): PluginScope;

  // ===== 服务提供 / 消费（DSH 核心）=====
  /** 向本上下文注册一个服务（供依赖方注入） */
  provide(name: string, impl: any): () => void;
  /** 取一个服务（自己 provide 的，或注入的） */
  get(name: string): any;
  /** 声明依赖某服务：就绪时回调，返回 disposer */
  inject(names: string[], callback: () => void): () => void;

  /** UI 能力（仅 UI 插件有）：挂载 DOM、注入样式/脚本 */
  ui?: {
    mount(el: any): void;
    root(): any;
    css(text: string): void;
    onResize(cb: (w: number, h: number) => void): () => void;
    injectScript(text: string): void;
    injectScriptSrc(src: string): void;
    /** 注入代码到主世界（AI 页面，contextIsolation 下的正确层） */
    injectMainWorld(code: string): void;
    /**
     * 覆盖层：Cuckoo 自己的透明置顶视图，浮在 AI 页面之上。
     * 插件 UI（如桌宠）推荐住这里——不碰 AI 页面，页面保持干净。
     */
    overlay?: {
      /** 初始化/创建覆盖层（懒加载） */
      init(): Promise<any>;
      /** 在覆盖层内执行 JS（异步，返回结果） */
      eval(code: string): Promise<any>;
      /** 设置覆盖层 HTML */
      html(html: string): Promise<any>;
    };
  };
  /** 插件资源访问（仅 UI 插件有）：读插件目录文件 / blob URL */
  assets?: {
    read(relPath: string): Promise<Uint8Array>;
    url(relPath: string): Promise<string>;
  };
  /**
   * Cuckoo 界面挂载：插件 UI 集成进 Cuckoo 壳页面（侧边栏/状态栏/工具栏）。
   */
  shell?: {
    /** 侧边栏加一页 */
    addSidebarPanel(spec: { id: string; title: string; icon?: string; html?: string }): Promise<any>;
    /** 状态栏加一项 */
    addStatusItem(spec: { id: string; text: string; title?: string }): Promise<any>;
    /** 工具栏加按钮 */
    addToolbarButton(spec: { id: string; label: string; title?: string }): Promise<any>;
    /**
     * 往 Cuckoo 壳页面注入任意 CSS（壁纸/字体/布局）。
     * 对标 DSH 的 styles.insert(css)。只作用于 Cuckoo 自己的界面，不碰 AI 页面。
     * @returns disposer（移除本插件注入的 CSS）
     */
    addStyle(css: string): () => void;
    /** 控制 AI 视图（DS 页面）显隐（纯 Electron 层，不碰页面） */
    setWebViewVisible(visible: boolean): Promise<any>;
    /** 设主窗口材质（Win11 亚克力/Mica；'acrylic'|'mica'|'tabbed'|'none'） */
    setWindowMaterial(material: string): Promise<any>;
    /** 通用槽位注册（对标 DSH slots）：往具名槽位加内容，按 order 排序 */
    slot: { register(spec: any): () => void };

  };
  /**
   * 本地 HTTP 服务：把插件目录暴露成 URL（"厚插件"的门槛）。
   * 例：ctx.webServer.serve('/assets', 'assets') → http://127.0.0.1:<port>/plugins/<id>/assets/*
   */
  webServer?: {
    /** 注册静态路由；返回 base URL */
    serve(prefix: string, dir: string): Promise<{ success: boolean; url?: string; base?: string; port?: number; error?: string }>;
    /** 取服务基础 URL（不含插件路径） */
    info(): Promise<{ success: boolean; base?: string; port?: number; error?: string }>;
  };
  /** 注册命令（对齐 DSH 的命令/快捷操作能力） */
  command?: {
    /** 注册一个命令，返回注销函数 */
    register(cmd: { id: string; title: string; run: () => any }): () => void;
  };
  /** token 统计（对齐 Cuckoo 状态栏口径） */
  tokens?: {
    /** 当前上下文 token */
    context(): number;
    /** 对话累计 token */
    cumulative(): number;
    /** 今日累计 token */
    today(): number;
    /** 窗口累计 token */
    windowCumulative(): number;
    /** 系统总累计 token */
    total(): number;
  };
  /**
   * 主题服务（对标 DSH ctx.theme）：注册/切换主题、叠加 token 覆盖层。
   * 全应用共享一份注册表；变化时所有插件的 ctx.on('theme/change') 都会收到。
   */
  theme: import('./theme-runtime.js').ThemeService;
}

/** 子作用域：隔离的 effect 生命周期 */
export interface PluginScope {
  /** 注册副作用（在本作用域内） */
  effect(fn: () => void | (() => void)): () => void;
  /** 监听事件（在本作用域内，dispose 时自动移除） */
  on(event: string, listener: EventListener): () => void;
  /** 销毁本作用域，清理所有 effect 和监听 */
  dispose(): void;
  /** 是否已销毁 */
  readonly disposed: boolean;
}

/** 服务注册表（跨插件共享） */
export interface ServiceRegistry {
  provide(name: string, impl: any): () => void;
  get(name: string): any;
  has(name: string): boolean;
  onReady(name: string, cb: () => void): () => void;
}

/** 加载结果 */
export interface LoadResult {
  ok: boolean;
  pluginName?: string;
  error?: string;
}

export {};

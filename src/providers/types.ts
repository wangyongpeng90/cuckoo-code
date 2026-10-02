/**
 * Provider 接口定义
 * 内置与自定义 provider 统一实现此接口；加载时用 validate.ts 做运行时校验
 * （TS 类型运行时被擦除，强制靠校验函数 —— D14）。
 */

/** 输入框元素 */
export interface InputElement {
  tagName?: string;
  isContentEditable?: boolean;
  disabled?: boolean;
  focus?: () => void;
  click?: () => void;
}

/** 平台 Provider 接口 */
export interface Provider {
  /** 平台唯一标识，如 'my-platform' */
  id: string;
  /** 显示名称 */
  name: string;
  /** 首页地址 */
  homeUrl: string;
  /** 会话 URL 前缀 */
  sessionUrlBase: string;

  /** 输入框查找选择器（按优先级排序） */
  inputSelectors?: string[];
  /** 发送按钮查找选择器 */
  sendButtonSelectors?: string[];
  /** 用户信息选择器 */
  userInfoSelector?: string;
  /** 首页判断正则 */
  homeUrlPattern?: RegExp;
  /** 输入框关键词兜底 */
  inputKeywords?: string[];

  /** 从 URL 提取会话 ID */
  extractSessionId(url: string): string | null;
  /** 判断 URL 是否属于本平台 */
  matchesUrl(url: string): boolean;

  /**
   * 可选的「会话列表抓取」实现（供侧栏「对话」分页使用）。
   * 该函数会被序列化后注入 AI 网页主世界执行，因此**必须自包含**
   * （只使用 doc/win/base 三个入参与浏览器全局，不得引用闭包变量）。
   * 返回 [{ title, href, active }]。
   * 未提供时回退到 shell 内置的 a[href] 抓取；侧栏不是 <a href> 结构
   * （如 SPA 用 div + 点击事件）的平台可在此自定义。
   */
  getSessionListFn?(): (doc: any, win: any, base: string) => Array<{ title: string; href: string; active: boolean }>;

  /**
   * 可选的「停止生成按钮定位」实现（供 harness「暂停」使用）。
   * 核心内置的启发式定位只覆盖部分站点（如 DeepSeek 的设计系统类名），
   * 其它平台可在此返回自定义定位函数：同样被序列化注入 AI 页面主世界执行，
   * **必须自包含**，签名 (doc, win) => { found, x, y, ... }（视口坐标，由主进程派发真实点击）。
   * 未提供或未命中时回退到内置启发式。
   */
  getStopFn?(): (doc: any, win: any) => { found: boolean; x?: number; y?: number; [k: string]: any };

  /**
   * 可选的「附件上传入口探测」实现（供 harness 的 CDP 上传通道使用）。
   * 返回**探测函数的源码字符串**（非函数本身），核心会拼成
   * `(<源码>)(document, window)` 注入 AI 页面主世界执行，**必须自包含**；
   * 返回 { found, x, y } 视口坐标，核心据此用 CDP 派发真实点击并拦截文件选择框。
   * 未提供或未命中时回退到核心的通用关键词探测（仅覆盖类名含
   * attach/upload/file/image 等词的站点；纯图标上传键的平台需自行实现）。
   */
  getAttachProbeSource?(): string;

  /** 是否使用网络拦截模式（默认 false = DOM 抓取） */
  useIntercept?: boolean;
  /** 返回注入主世界的网络拦截器源码（拦截模式使用，必须自包含） */
  getHookSource?(): string;
  /** 返回自定义提示词模板（优先级最高；返回空则回退到文件模板） */
  getPromptTemplate?(): string;

  findInput?(): InputElement | null;
  findSendButton?(): InputElement | null;
  extractUserInfo?(): string;
  isElementVisible?(el: Element): boolean;
}

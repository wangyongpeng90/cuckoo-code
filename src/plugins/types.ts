/**
 * 插件（Plugin）相关类型定义
 *
 * 定位：插件是**分发容器**，不是新的运行时。
 * 它把一个 GitHub 仓库里的技能/代理/规则/MCP 配置/provider 打成一个包，
 * 安装后由既有扫描器识别 —— 复用 skills/agents/rules/mcp/providers 五套机制，
 * 不引入任何新的执行引擎。
 *
 * 目录约定（**纯约定，清单不描述路径**）：
 *   <pluginDir>/
 *   ├── plugin.json          # 清单（唯一必需文件）
 *   ├── skills/<name>/SKILL.md
 *   ├── agents/<name>.md
 *   ├── rules/<name>.md
 *   ├── mcp.json
 *   └── providers/<id>.js    # 可执行，需显式授权
 *
 * 为什么清单里不做路径映射：插件若能自述路径，就多出一类路径逃逸面，
 * 且与 skills/agents/rules 既有的"纯约定"风格不一致。
 * 贡献项一律**由安装目录实际内容派生**，插件无法虚报。
 */

/** 插件清单（plugin.json） */
export interface PluginManifest {
  /** 唯一标识；小写 kebab-case；同时是安装目录名与去重键 */
  id: string;
  /** 展示名 */
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** 声明兼容的最低应用版本（仅提示，v1 不强制拦截） */
  minAppVersion?: string;
}

/** 安装后扫描出的实际贡献项（派生，非声明） */
export interface PluginContributes {
  skills: string[];
  agents: string[];
  rules: string[];
  /** 是否带 mcp.json */
  mcp: boolean;
  /** 可执行文件相对路径列表（风险项，需授权） */
  providers: string[];
}

/** 已安装插件 */
export interface InstalledPlugin {
  manifest: PluginManifest;
  /** 插件根目录绝对路径 */
  dir: string;
  contributes: PluginContributes;
  /** 安装来源（读 `.install-meta.json`；手工放进目录的插件没有，为 undefined） */
  origin?: PluginOrigin;
}

/** 插件来源（安装时记录，供审计、更新比对与卸载溯源） */
export interface PluginOrigin {
  /** 形如 owner/repo */
  repo: string;
  url: string;
  /** 安装时该仓库的默认分支 */
  branch: string;
  installedAt: string;
  /** 安装时的插件版本（用于与远端比对判断是否有更新） */
  version?: string;
}

/** 市场条目（GitHub 搜索结果归一化） */
export interface MarketItem {
  /** owner/repo —— 唯一键 */
  id: string;
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  /** 最近更新时间（ISO 字符串，GitHub 原样） */
  updatedAt: string;
  /** 最近代码推送时间；比 updatedAt 更能反映"真的改了东西" */
  pushedAt: string;
  url: string;
  defaultBranch: string;
  /** 主语言，如 JavaScript */
  language: string;
  /** 许可证 SPDX id，如 MIT；无则空串 */
  license: string;
  /** 已归档的仓库不该被推荐 */
  archived: boolean;
  topics: string[];
}

/**
 * 远端 plugin.json 的解读结果。
 * GitHub 搜索接口**不返回**插件的版本与兼容要求 —— 它们在 plugin.json 里，
 * 必须单独拉取（走 raw.githubusercontent，不消耗 API 配额）。
 */
export interface RemotePluginInfo {
  repo: string;
  ok: boolean;
  /** 插件版本（plugin.json 的 version） */
  version: string;
  /** 最低应用版本要求（plugin.json 的 minAppVersion） */
  minAppVersion: string;
  name: string;
  description: string;
  /** 失败原因（ok=false 时） */
  error?: string;
}


/**
 * 已安装插件的状态（`plugins-state.json`）
 *
 * **插件总开关**：`enabled` 为 true 时，该插件的全部贡献才生效 ——
 * 技能 / 代理 / 规则被扫描、`mcp.json` 被读取、`providers/*.js` 被加载。
 *
 * 安装后默认 **false**（不生效）。这是刻意的：装一个插件不该顺带执行第三方代码，
 * 启用必须是用户的显式动作。
 */
export interface PluginState {
  enabled?: boolean;
  /** @deprecated 旧字段名（仅"可执行部分"开关）；读取时向后兼容，新写入一律用 enabled */
  execEnabled?: boolean;
}

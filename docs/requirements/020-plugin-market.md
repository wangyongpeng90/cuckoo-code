---
id: 020
type: feature
title: 插件市场（GitHub topic 自动发现与安装）
status: review
branch: feat/020-plugin-market
created: 2026-10-02
updated: 2026-10-02
---

## 背景

Cuckoo Code 目前有四条**互相独立**的扩展线，用户各自手工维护：

| 扩展线 | 目录约定 | 形态 |
|---|---|---|
| Skill | `<base>/.cuckoo/skills/<name>/SKILL.md` | 带 frontmatter 的 Markdown |
| Agent | `<base>/.cuckoo/agents/<name>.md` | 带 frontmatter 的 Markdown |
| Rule | `<base>/.cuckoo/rules/<name>.md` | 带 frontmatter 的 Markdown |
| MCP | `<base>/.cuckoo/mcp.json` | JSON 配置 |
| Custom Provider | `userData/custom-providers/*.js` | CommonJS 模块 |

用户要装一个别人做好的能力包，得自己找仓库、读文档、把文件手工放到对的目录。
**缺失的是"分发层"**：没有统一的发现入口，也没有一键安装。

本需求做第一块：**插件市场**——以 GitHub 为搜索源，自动发现打了 `cuckoo-plugin` topic 的仓库。

---

## 目标

- 壳页面新增「插件」页，自动列出 GitHub 上所有 `topic:cuckoo-plugin` 的仓库
- 展示：名称、简介、star、更新时间、来源链接
- 一键安装 → 落到本地插件目录 → 被现有 scanner 识别 → 生效
- 已安装插件可查看 / 卸载
- **不引入新的运行时执行引擎**：插件是"分发容器"，复用现有五套加载机制

---

## 实测证据（2026-10-02，未认证）

方案建立在以下**实测**结论上，非推测：

| # | 探测项 | 结果 | 影响 |
|---|---|---|---|
| 1 | `GET /search/repositories?q=topic:cuckoo-plugin` | **`total_count = 0`** | 当前生态为空 → **如实展示空状态**（见「2. 单一真相源」） |
| 2 | `q=topic:electron` 同参数 | `total_count = 27887` | 证明 topic 限定符本身工作正常，0 是真实结果 |
| 3 | `q=topic:cuckoo` | `total_count = 82`，头部为 `docker-cuckoo` / `Bold-Falcon` / `Panda-Sandbox` | **`cuckoo` 命名已被 Cuckoo Sandbox（恶意软件沙箱）占据** |
| 4 | Search API 未认证限流 | `limit = 10`，窗口 **1 分钟** | 每次刷新都会烧配额 → 必须缓存 |
| 5 | Core API 未认证限流 | `limit = 60`，窗口 1 小时 | 详情/README 拉取要克制 |
| 6 | `codeload.github.com/.../tar.gz/refs/heads/{branch}` | **HTTP 200**，`application/x-gzip`，2.31 MB | 下载 tarball **不消耗 API 配额** |
| 7 | 仓库默认分支 | `master`（非 `main`） | 不能硬编码分支名 |
| 8 | tarball 内部格式 | `typeflag='g'`（`pax_global_header`）+ `'x'` 扩展头 | **PAX 格式**；朴素 512 字节块解析会错位 |
| 9 | 朴素解析实测 | 2231 条条目 typeflag 变成乱码（`?` 占 634 条） | **自研 tar 解析不可行** |
| 10 | `npm ls tar --omit=dev` | `(empty)`；`tar@7.5.22` 仅来自 `electron-builder` → `app-builder-lib` | **生产依赖里没有 tar**，打包后不可用 |
| 11 | `api.github.com` DNS | 解析到 `127.0.0.1`（hosts 劫持） | 需容错 |
| 12 | Node 原生 `fetch` 访问 `api.github.com` | **`UNABLE_TO_VERIFY_LEAF_SIGNATURE`**（系统代理 MITM，Node 不认系统 CA） | **不能用 Node fetch 做市场请求** |
| 13 | Node 原生 `fetch` 访问 `codeload.github.com` | **HTTP 200**（未被劫持） | 下载可直连，但请求层仍要统一 |

> 第 12 条是决定性发现：本机走 `127.0.0.1:7890` 系统代理，PowerShell（.NET，走系统证书库）能通，
> 而 Node 自带 CA 列表不认代理的 MITM 证书 → 直接失败。**Electron 应用必须用 Chromium 网络栈。**

---

## 方案

### 决策表

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| 1 | 插件是什么 | **分发容器**，不是新运行时 | 复用 skills/agents/rules/mcp/providers 五套既有机制，零新执行引擎 |
| 2 | 唯一标识 | `topic:cuckoo-plugin` | 用户指定；精确限定符，不受 `cuckoo` 命名污染影响 |
| 3 | 搜索为空怎么办 | **诚实空状态**，不引入任何非 topic 来源 | topic 是唯一真相源；空是真实状态，不是待粉饰的缺陷 |
| 4 | HTTP 层 | **Electron `net` 模块**，不用 Node `fetch` | 走 Chromium 网络栈 → 自动继承系统代理与系统 CA（实测 Node fetch 失败） |
| 5 | 限流应对 | 本地缓存 TTL 10 min + 可选 `GITHUB_TOKEN` | Search 未认证仅 10/min；带 token 升至 30/min |
| 6 | 下载通道 | `codeload.github.com` tarball | **不消耗 API 配额**（实测 #6），且本机可直连（#13） |
| 7 | 分支名 | 从 repo 元数据读 `default_branch` | 实测默认分支是 `master`（#7），硬编码 `main` 必 404 |
| 8 | 解压 | **把 `tar` 提升为生产依赖** | PAX 格式（#8/#9）；`tar` 已在 node_modules，纯 JS 跨平台，零新下载 |
| 9 | 安装位置 | `~/.cuckoo/plugins/<id>/` | 对齐既有 `~/.cuckoo/` 约定；`CUCKOO_HOME` 可覆盖 |
| 10 | 生效方式 | scanner 加**可选额外扫描根**入参，由 `session` 层传入 | 插件目录作为额外扫描根；**不让 scanner 反向 import `plugins/`**，避免成环 |
| 11 | 可执行内容 | 允许，但**默认关闭 + 显式授权** | `providers/*.js` 会进 `require`，风险等级不同于 Markdown；能力保留，权限显式 |
| 12 | 签名校验 | v1 不做，但记录来源 URL | 保留可审计性；签名留待生态成形 |
| 13 | UI 落点 | `src/ui/shell.html` 新增 tab | **overlay 的面板已是死代码**（见下） |

### ⚠️ UI 落点勘误

实测：`src/overlay/events.ts` 引用 31 个 DOM id，其中 **29 个在 `overlay.html` 中已不存在**
（提交 `92c5abc` "移除旧注入面板/悬浮球"）。`overlay/panels/mcp-manager.ts` 已无实际宿主。

**结论**：插件页面必须落在 `src/ui/shell.html`（现有 9 个 tab 的侧边栏）+ `shellAPI`，
**不要**挂到 overlay。现有 tab 清单：
`snippets / skills / conversations / mcp / windows / token / about / feishu / settings`。

### 1. 插件包结构（约定）

```
<repo>/
├── plugin.json           # 清单（唯一必需文件）
├── skills/<name>/SKILL.md
├── agents/<name>.md
├── rules/<name>.md
├── mcp.json
└── providers/<id>.js     # 可执行，需显式授权
```

`plugin.json`：
```json
{
  "id": "my-plugin",
  "name": "示例插件",
  "version": "1.0.0",
  "description": "一句话说明",
  "author": "someone",
  "minAppVersion": "0.8.0"
}
```
- `id` 必填，小写 kebab-case（`^[a-z0-9][a-z0-9-]{0,63}$`），作为安装目录名与去重键
- `name` 必填；其余可选
- 清单缺失/非法 → 拒绝安装并报明确原因

> **实现偏离（原设计 → 实际）**：初稿让清单用 `contributes` 声明路径映射
> （`"skills": ["skills/"]`），**实现时删除**。改为**纯目录约定 + 派生**：
> 贡献项由安装目录的实际内容算出（`deriveContributes`），不信插件自述。
> 理由：① 路径映射凭空多出一类逃逸面；② 与 skills/agents/rules 既有的"纯约定"风格一致；
> ③ 派生可防虚报。**代价**：插件无法把资源放在非约定目录——这是有意收紧。

### 2. 单一真相源与空状态

**`topic:cuckoo-plugin` 是唯一权威来源。**

```
GET /search/repositories?q=topic:cuckoo-plugin&sort=updated
```

实测该查询当前返回 0 —— 空就是空的，**如实展示空状态，不做任何来源补偿**。

空状态文案需给出可执行的下一步，而不是把空白藏起来：
> 暂无插件。给你的仓库打上 `cuckoo-plugin` topic，它就会出现在这里。

#### 为什么不做回退（两次设计否决，留痕）

初稿曾设计"三级回退"（topic 主源 + 关键词兜底 + 官方精选清单），评审否决：

| 被否决项 | 否决理由 |
|---|---|
| **官方精选清单** | 精选清单**不是** `topic:cuckoo-plugin` 的匹配结果，却会被当作搜索结果展示 → 违背"以 topic 为搜索源"的定义。更严重的是它造出一条**不受 topic 协议管理的隐藏分发通道**：作者以为打 topic 即可上架，实际还有一份官方白名单在分发别的仓库。协议污染，且需长期维护（谁维护、过期怎么办、与 topic 冲突时听谁的，全是无主成本） |
| **关键词兜底** | 实测 `q=cuckoo-plugin in:name,description,topics` 返回 15 条，**100% 是 Cuckoo Sandbox 生态**（`JPCERTCC/MalConfScan-with-Cuckoo`、`somikdatta/cuckoo`、`kill-9-me/Cuckoo-Xenserver`），与 cuckoo-code 插件无关。且 `in:topics` 与主源语义重叠 → 不补漏，只制造误报（点进去是恶意软件沙箱） |

**核心判断**：空态是生态冷启动的**真实状态**，不是需要粉饰的缺陷。
派生的回退清单会在用户和事实之间插一层假象——用户以为市场里有东西，实际那是我替他挑的。
代价是信任，收益是零。**宁可诚实地空，不要虚假地满。**

> 作者忘了打 topic → 那是作者的问题，解法是"去打 topic"，不是让客户端猜。
> 谁维护精选清单 → 没有人。所以不要有精选清单。

### 3. 模块划分（遵守 `02-dependency.md`）

新建 `src/plugins/`，定位为**底层共享模块**（同 `skills/`、`agents/` 层级，只依赖 node 内置 + `infra`）：

| 文件 | 职责 |
|---|---|
| `types.ts` | `PluginManifest` / `PluginMeta` / `MarketItem` |
| `manifest.ts` | 解析 + 校验 `plugin.json`（**纯 JSON.parse**，零依赖；容错策略对齐 `skills/scanner` 的"非法则跳过并报因"） |
| `paths.ts` | 插件根目录解析（`CUCKOO_HOME` 可覆盖） |
| `market.ts` | GitHub 搜索（Electron `net`）+ 缓存 |
| `installer.ts` | tarball 下载 / 解压 / 落盘 / 卸载 |
| `scanner.ts` | 扫描已安装插件，产出各扩展线的**额外扫描根** |
| `index.ts` | 模块入口 |

**依赖方向**：`plugins/` 只依赖 `infra/` + node 内置 + `tar`。
`session/prompt-builder`（组装提示词）与 `app/ipc/*` 依赖它，**方向单向，不反向**。

> ⚠️ 实现约束：**`skills/`、`agents/`、`rules/` 不得 import `plugins/`**。
> 否则 `skills ← plugins` 与 `plugins → skills` 会成环，违反 `02-dependency.md`。
> 正确做法见「5. 生效集成」——由上层（`session`）计算扫描根后**作为参数传入**。

### 4. 数据流

```
shell.html「插件」tab
  → shellAPI.marketSearch(query)          // src/app/shell-preload.ts
  → ipcMain 'plugin-market-search'        // 新增 src/app/ipc/plugin.ts
  → plugins/market.ts
      ├── 缓存命中？→ 直接返回
      └── Electron net 请求 GitHub Search API → 归一化 → 写缓存
  → 返回 [{ id, name, description, stars, updatedAt, url, source }]

安装：
  → ipcMain 'plugin-install' { owner, repo }
  → plugins/installer.ts
      1. 读 default_branch（core API，1 次）
      2. GET codeload tarball（不计配额）
      3. tar 解压到临时目录
      4. 校验 plugin.json
      5. 移入 ~/.cuckoo/plugins/<id>/
      6. 记录来源 URL 到 <id>/.install-meta.json
      7. 可执行部分（providers/）不落盘，除非用户在确认框显式勾选；
         落盘后仍为禁用，须在插件页二次开启（见「7. 安全」）
```

### 5. 生效集成

**关键：不改 scanner 的依赖方向，只给它们加一个可选入参。**

各 scanner 的 `scanXxx(projectDir)` 增加可选的**额外扫描根**参数：

```ts
scanSkills(projectDir: string | null, extraSkillDirs?: string[]): SkillMeta[]
```

扫描根由 **`session/prompt-builder`** 计算后传入（它是上层，可同时依赖 `plugins/` 与 `skills/`）：

| 扩展线 | 追加的插件扫描根 |
|---|---|
| Skill | `~/.cuckoo/plugins/*/skills/` |
| Agent | `~/.cuckoo/plugins/*/agents/` |
| Rule | `~/.cuckoo/plugins/*/rules/` |
| MCP | 插件 `mcp.json` 的 server 以 **`<插件id>:<server名>`** 前缀并入配置读取 |
| Custom Provider | `providers/*.js` 经 `getEnabledPluginProviderFiles()` 进入 `providers/custom/loader` |

**以上全部以"插件已启用"为前提**。`plugins-state.json` 的 `enabled` 是**插件总开关**：
关闭时（**安装后的默认值**）技能/代理/规则不被扫描、`mcp.json` 不被读取、`providers/*.js` 不被加载。

为什么合成一个开关：MCP server 定义会 spawn 子进程，安全等级与 `providers/*.js` **同级**
（都是"在本机运行第三方代码"），而技能/代理/规则只是数据。用一个开关表达"这个插件的全部内容"，
比"部分内容单独授权"更不容易被误点，也更符合直觉。

**可执行内容始终落盘**（不再"不授权就不落盘"）：否则用户事后打开开关也加载不到任何东西。
落盘 ≠ 执行 —— 未启用时文件在磁盘上但不被 `require`。

**provider 的加载通路（实现细节）**：插件 provider 不是"另起一套加载器"，而是并入既有的
`loadCustomProviders()` —— 用户自己配置的自定义 provider **优先**，同 id 的插件版本被跳过
（避免出现两个同名 provider）。授权状态变化后由 IPC 层调 `invalidateCustomProvidersCache()`，
否则要重启才生效。

- 插件贡献的条目 `source` 标为 `'plugin'`（需扩展 `SkillSource` / `AgentSource` / `RuleSource` 联合类型）
- 优先级：`项目级 > 用户级 > 插件级`（插件最低，避免覆盖用户手写内容）

### 6. 缓存与限流

- 缓存文件：`~/.cuckoo/plugin-market-cache.json`
- TTL：10 分钟（Search 未认证 10/min，实测 #4）
- 强制刷新：UI「刷新」按钮（受 TTL 下限保护，30 秒内不重复打）
- 可选 `GITHUB_TOKEN` 存 `~/.cuckoo/plugin-market.json`，配则请求头带 `Authorization: Bearer`
- 命中 403/429 → 读 `x-ratelimit-reset` 回显"限流，X 秒后重试"，**不静默失败**

### 7. 安全

市场**无上架门槛**：任何打了 topic 的公开仓库都会出现。防线只有三道 —— 安装确认、默认禁用、启用确认。

**默认禁用是第一道也是最强的一道**：插件装完 `enabled=false`，
技能/代理/规则不扫描、`mcp.json` 不读取、`providers/*.js` 不加载。
**装一个插件不该顺带执行第三方代码。**

**启用时的确认框**：仅当插件含可执行内容（`providers/*.js` 或 `mcp.json`）才弹出，
逐条列出会执行的东西：

```
· providers/thing.js（会被 require 执行）
· mcp.json 里的 MCP server（会启动子进程）
```

纯声明式插件（只有技能/代理/规则）启用时不弹窗 —— 那只是数据，没有执行面。

其余防护：
- 解压防穿越：`tar` 的 `filter` 钩子拒绝绝对路径、`..` 段、符号链接与硬链接
- 落盘前校验 `plugin.json`，`id` 必须匹配 `^[a-z0-9][a-z0-9-]{0,63}$`（防目录逃逸）
- `repo` 的 owner 段**不允许点号**（见「实现记录」第 11 条）
- 来源记录 `<id>/.install-meta.json`：repo / branch / 安装时间 / 版本，供审计、更新比对与卸载溯源
- 卸载 = 删目录 + 清 `plugins-state.json` 中该 `id` 的状态
- 提示词注入面：技能/代理/规则会进系统提示词，安装确认框展示名称与简介

---

## 实施顺序

1. `src/plugins/` 骨架（types / paths / manifest）+ 单测
2. `plugins/market.ts`（Electron net + 缓存 + 空状态）+ 单测
3. `plugins/installer.ts`（tarball + tar 解压 + 卸载）+ 单测
   - `npm i tar` 提升为生产依赖
4. IPC `plugin.ts` + `shell-preload.ts` 暴露 + `shell.html` 新增 tab
5. 各 scanner 接入插件扫描根
6. 更新 `docs/arch/*` 与 `Roadmap.md`

---

## 实现记录（2026-10-02）

### 交付物

**新增 `src/plugins/`（8 个文件）**

| 文件 | 说明 |
|---|---|
| `types.ts` | 类型定义 |
| `paths.ts` | 路径解析 + id 校验（纯 node） |
| `manifest.ts` | 清单解析/校验 + `deriveContributes` 派生贡献项 |
| `market.ts` | topic 搜索 + 10 分钟缓存 + 限流提示（HTTP 注入） |
| `installer.ts` | 下载/解压/校验/落盘/卸载 + `safeEntryFilter` |
| `roots.ts` | `getPluginScanRoots()` |
| `http.ts` | Electron `net` 适配（唯一依赖 electron 的插件文件） |
| `index.ts` | 模块入口 |

**接线**：`app/ipc/plugin.ts`（新增 6 个 IPC）、`app/ipc/index.ts`、`app/shell-preload.ts`、`src/ui/shell.html`（新增「插件」tab）

**扫描根接入**：`skills/scanner.ts`、`agents/scanner.ts`、`rules/scanner.ts` 各加可选额外扫描根参数；`session/prompt-builder.ts`、`app/ipc/project.ts`、`app/ipc/harness.ts`、`tools/impl/run-agent.ts`、`tools/runtime/JsRunner.ts` 传入

**测试**：`test/plugins/`（manifest / market / installer / roots）+ skills/agents/rules 的扫描根用例

### 与设计的偏离（逐条留痕）

| # | 原设计 | 实际实现 | 原因 |
|---|---|---|---|
| 1 | 清单 `contributes` 声明路径映射 | **删除**，改为目录约定 + 派生 | 少一类逃逸面；防虚报；风格与既有 scanner 一致 |
| 2 | `HttpGet` 返回 `body: string` | 改为 **`body: Buffer`** | tarball 是二进制 gzip，按 utf-8 解码会**直接损坏数据**（实现中发现） |
| 3 | `tools/` 不依赖 `plugins/` | **`tools/` 依赖 `plugins/`** | `JsRunner` 的作用域规则注入、`run-agent` 的代理查找也要能看到插件贡献。`plugins/` 是底层模块，此依赖向下，不违规；已同步 `02-dependency.md` 依赖表 |
| 4 | 未明确 scanner 如何拿到插件目录 | 新增 `plugins/roots.ts` + **扫描根作参数传入** | 若让 scanner import `plugins/`，会与 `plugins → skills` 成环 |
| 5 | `SkillSource` 等只有两值 | 增加 `'plugin'` | 需要区分来源与优先级（项目 > 用户 > 插件） |
| 6 | 未提依赖变更 | `tar` 提升为**生产依赖** | 原仅为 `electron-builder` 的开发期传递依赖，打包后不存在（实测 `npm ls tar --omit=dev` 为空） |
| 7 | 设计文档只写"需显式开启"，**未说明开启后谁去加载** | 补 `getEnabledPluginProviderFiles()` + 并入 `loadCustomProviders()` | 初版实现只记录了 `execEnabled` 状态，**没有任何代码消费它**——插件 provider 装进去永远不会生效。做第一个真实插件（zhipu）时暴露，属实现缺口而非设计缺口 |
| 8 | 状态函数在 `installer.ts` 内 | 抽出 `plugins/state.ts` | `roots.ts` 要读状态，而 `installer.ts` 依赖 `tar`；不该让只读状态的一方把 tar 拖进模块图 |
| 9 | MCP 行写着"并入配置读取" | 首版**只算了 `mcpFiles` 没有消费方**，后补 `getEnabledPluginMcpFiles()` + 并入 `mcp/config.getServers()` | **UI 会显示「MCP」徽标但实际不生效 —— 是假象，比缺口更糟**。provider 那个至少还有开关提示用户要开，MCP 连开关都没有却显示成已提供 |
| 10 | 命名空间写 `plugin:<id>` | 实际用 **`<插件id>:<server名>`** | server 名会出现在 `mcpCall(server, tool, args)` 里，前缀越短越好用；`plugin:` 前缀对使用者无信息量 |

### 第二轮改动（依评审反馈）

| # | 原实现 | 改为 | 原因 |
|---|---|---|---|
| 11 | `repo` 校验用 `[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+` | owner 段改为 `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$` | **真实安全缺陷**：旧正则里 `..` 能匹配 `[A-Za-z0-9._-]+`，于是 `isValidRepo('../evil')` 返回 **true**，owner 成了 `..`，拼出的 URL 会被规范化到完全不同的路径。由新测试捕获 |
| 12 | 两段授权（安装时问一次、启用时再问一次） | **单一总开关**（`enabled`）+ 启用时确认 | 用户要求"启用就是启用所有的"。两个开关既啰嗦又容易被误点；一个开关语义清晰 |
| 13 | 可执行内容"不授权就不落盘" | **始终落盘，默认不加载** | 旧做法有硬伤：用户事后打开开关也加载不到任何东西（文件不存在）。落盘 ≠ 执行 |
| 14 | 安装后声明式内容立即可用 | **安装后整个插件不生效**，需显式启用 | 与 12 配套。安全上更强：装一个插件不该顺带执行第三方代码 |
| 15 | 已安装插件在市场页仍显示"安装"按钮 | 显示「已安装」徽标，**有更新才显示「更新」** | 用户反馈。重复安装会覆盖用户已改过的内容，按钮不该一直挂着 |
| 16 | 市场卡片只有名字 + 单行截断的简介 | 完整简介（可换行）+ 语言 / star / 许可证 / 日期 + **插件版本与最低应用版本** | 用户反馈"没显示简介、版本要求"。旧卡片复用了 `.ck-snip-preview`（单行截断），简介根本看不全 |
| 17 | 无升级能力（重复安装直接拒绝） | `installPlugin({ upgrade: true })` 覆盖安装 | 支撑「更新」按钮。覆盖时**先备份旧目录**，落盘失败会挪回来，不留残缺插件；并**保留用户的启用选择** |
| 18 | 市场卡片的操作按钮包在 `.ck-snip-actions` 里 | 改用新的 `.ck-plugin-actions` | **真机 bug：按钮看不见也点不到。** `.ck-snip-actions` 是给 snippet 卡片设计的**悬停才显形**样式（`opacity: 0` + `pointer-events: none`），且显示规则绑定在 `.ck-snip-item:hover` 上；卡片本身是 `.ck-plugin-item`，选择器不匹配 → 按钮永远隐藏。卸载按钮未包容器所以可见，只有安装/更新被藏住 —— 表现为"卸载完再也装不上" |

**新增能力：远端 `plugin.json` 拉取**（`fetchRemoteManifests`）。GitHub 搜索接口**不返回**
插件的版本与兼容要求 —— 它们在 `plugin.json` 里。走 `raw.githubusercontent`（CDN，**不消耗 API 配额**）
单独拉取，带 30 分钟缓存、并发上限 4、**逐条降级**（单条失败只影响该条）。
这样即使某台机器访问 raw 受限（例如被 hosts 劫持），市场列表本身仍能正常显示。

### 实现中修正的两个自身错误（测试捕获）

1. **三种扩展线的目录结构并不相同**：初版 `deriveContributes` 对 skills/agents/rules 一律按"子目录"处理。
   实际约定是 skills = `<name>/SKILL.md`（子目录），agents/rules = `<name>.md`（**扁平文件**）。
   由单测 `deriveContributes: 按约定识别各项` 捕获并修正。
2. **`skills/` 里无 `SKILL.md` 的目录不该计数**：scanner 会跳过它，派生结果也应一致。已补测。

### 验证

```
npm run typecheck   # 0 错误
npm test            # 686 passed (64 files)
npm run lint        # 0 problems
npm run compile     # 通过
```
另：`src/ui/shell.html` 不在构建校验范围内，已单独用 `node --check` 验证其 script 块语法通过。

**并为此补了回归防护**（`test/ui/shell-plugins.test.js`）：解析 shell.html 的插件区段，
断言其用到的每个 class 的基础 CSS 规则都**不含 `opacity: 0` / `pointer-events: none`**。
这条防护经过验证有效 —— 把第 18 条的 bug 放回去后，它会失败（2 项）。
语法检查、类型检查、单测都拦不住"用了悬停才显形的 class"这类问题，只能靠这种针对性检查。

### 插件总开关的端到端验证

装一个同时带 `providers/`、`mcp.json`、`skills/` 的插件，走真实 `mcp/config` 与 `scanSkills` 路径：

| 阶段 | 技能扫描根 | 扫到的技能 | provider 文件 | mcp.json | MCP server |
|---|---|---|---|---|---|
| 装完（默认） | 0 | 无 | 0 | 0 | 无 |
| 启用后 | 1 | `helper` | 1 | 1 | `demo:fs` |
| 更新到 2.0.0 | 1 | `helper` | 1 | 1 | `demo:fs` |
| 卸载后 | 0 | 无 | 0 | 0 | 无 |

关键两行：**装完什么都不生效**（但 `providers/thing.js` 已落盘 —— 这样开关才有效），
**更新后启用状态保留**（用户信任过这个插件，不该因为更新就被重置）。

### 用真实插件验证（首个插件：zhipu）

插件格式不是靠合成测试自证的——已用真实插件
（`cuckoo_plugins/cuckoo-plugin-zhipu`，含 57 KB 的 `providers/zhipu.js`）走通全链路：

| 环节 | 结果 |
|---|---|
| 打包成 GitHub 形态 tarball → 安装 | `success=true`，`id=zhipu`，`providers=['zhipu.js']` |
| 授权门禁 | 初始 `execEnabled=false` → 可加载 provider **0 个**；开启后 **1 个** |
| 真实 `require` 并 `validateProvider` | 通过 |
| `matchesUrl` | `chatglm.cn/`、`/?lang=zh`、`/main/alltoolsdetail?...&cid=` 全部命中 |
| `extractSessionId` | 正确提取 `abc123` |
| `getHookSource()` | 返回 24528 字节字符串 |
| 卸载 | 目录与授权记录均清理干净 |

这条验证同时暴露了上面第 7 条缺口（`execEnabled` 无消费者）——**合成测试覆盖不到，只有接真实插件才会暴露**。

### 三类贡献的端到端验证（provider + mcp + skill 混合插件）

装一个同时带 `providers/*.js`、`mcp.json`、`skills/` 的插件，走**真实 `mcp/config` 路径**：

| 检查项 | 未授权 | 授权后 |
|---|---|---|
| 可加载 provider 文件 | 0 | 1 |
| 可读取 mcp.json | 0 | 1 |
| MCP server 列表 | 空（不出现） | `demo:filesystem`（`source=plugin`, `enabled=true`） |
| 会被真正连接的 server | 空 | 含 `demo:filesystem` |
| **skill 扫描根** | **1（照常可用）** | 1 |

最后一行是关键语义：**授权门禁只管可执行内容，声明式内容（skills/agents/rules）不受影响**。

另验证了与用户自有 server 并存：`filesystem(user, my-own)` 与 `demo:filesystem(plugin, npx)`
同时存在，互不覆盖。

---

## 验收标准

- [x] 「插件」页列出全部 `topic:cuckoo-plugin` 仓库
- [x] **空结果显示明确空状态 + 上架指引（打 `cuckoo-plugin` topic），不伪装非空、不白屏**
- [x] **不存在任何非 topic 的自动来源**（无精选清单、无关键词兜底）
- [x] 搜索结果 10 分钟内走缓存，不重复消耗配额
- [x] 未认证限流（10/min）下不报错崩溃，给出可读提示
- [x] 市场卡片显示完整简介 + 语言 / star / 许可证 / 日期 + 插件版本与最低应用版本
- [x] **已安装条目不再显示安装按钮**；有更新时显示「更新」，点击覆盖安装
- [x] 覆盖安装：先备份旧目录，失败可回滚；并保留用户的启用选择
- [x] 一键安装：自动读 `default_branch`，tarball 下载 + PAX 解压 + 校验 + 落盘
- [x] **安装后整个插件默认不生效**（技能/代理/规则/MCP/provider 全部不加载）
- [x] **启用后全部生效**：skill/agent/rule 被既有 scanner 识别、`mcp.json` 并入 MCP 配置、`providers/*.js` 被 provider 加载器读到
- [x] 启用含可执行内容的插件时弹确认框，逐条列出会执行的东西；纯声明式插件不弹
- [x] 插件 `mcp.json` 的 server 带 `<插件id>:` 前缀，与用户自有 server 并存不覆盖
- [x] 可卸载，且目录与启用状态都清理干净
- [x] 解压拒绝路径穿越（`../`、绝对路径、符号链接）；`repo` 的 owner 不允许点号
- [x] `typecheck` / `test` / `lint` / `compile` 全绿
- [ ] HTTP 层用 Electron `net`，在系统代理环境下可正常访问 `api.github.com` —— **代码已实现，真机待验**
- [ ] 真机验证（含代理开启场景）—— **未做**（自动化测试覆盖了纯逻辑层；`http.ts` 与 UI 交互需真机跑 `npm start`）

---

## 遗留 / 后续

- **真机验证未做**：`http.ts`（Electron `net` 实际连通性，尤其代理开启场景）与 shell.html 的交互
  需要跑 `npm start` 手动验。自动化测试只覆盖到注入假传输层为止
- **启用/禁用技能类内容的生效时机**：provider 与 MCP 在开关变动后立即生效（IPC 里主动失效缓存 /
  重连 server），但**技能、代理、规则**是初始化项目时组装进系统提示词的 ——
  开关变动后需要**重新初始化项目**（或新开对话）才反映到提示词里。v1 未做热更新
- **无更新通知**：只在打开插件页时比对版本，不会主动提醒。远端 `plugin.json` 读取失败时
  回退到"仓库在安装之后推送过"的启发式判断，可能误报「更新」（点一下重装即可，无副作用）
- **能力边界：插件不能提供新工具（tool）**。`src/tools/index.ts` 是静态注册，给 AI 的契约
  `api.d.ts` 与沙箱注入 `bootstrap.generated.ts` 都是**构建期**从各工具的 `apiMetas` / `bootstrap()`
  生成。运行时 `registry.register()` 的工具会出现在提示词的工具列表里，但 AI **在 JS 沙箱里调不动**
  （bootstrap 没注入该函数，契约里也没有它）——"列表里有、实际调不动"，比不支持更坏。
  要支持需把契约生成与沙箱注入改成运行时可扩展，属另一个量级的改动。
  **插件提供工具的现有可行路径**：① 走 MCP（server 工具经 `mcpCall` 暴露，AI 能正常调）；
  ② skill 带 `scripts/`，AI 用 `bash`/`pwsh` 跑
- **生态冷启动**：`topic:cuckoo-plugin` 实测为 0。市场内容**完全取决于社区是否打 topic**——客户端不做任何补偿。
  要让它有内容，项目方需先发布 2~3 个官方插件并在 README 写明 topic 约定。**这是生态问题，不是客户端该用回退清单掩盖的问题**
- **无上架门槛**：任何打了 topic 的公开仓库都会出现在市场。当前无审核、无签名 →
  防线是"默认禁用 + 启用时确认 + 来源溯源"三道
- **命名语境**：`cuckoo` 一词已被 Cuckoo Sandbox（恶意软件分析沙箱）占据，实测 `topic:cuckoo` 有 82 个仓库。
  `topic:cuckoo-plugin` 是精确匹配、**不受污染**，但对外介绍本市场时需说清与沙箱生态无关
- **topic 拼写容错**：`cuckoo-plugin` / `cuckoo-code-plugin` 等近似 topic 不会互相匹配（实测后者也是 0）。
  约定必须写进 README，且**只能有一个**正确拼写
- **签名与信任**：v1 不做签名；生态成形后考虑
- **私有仓库 / GitLab**：v1 只支持公开 GitHub 仓库
- **升级只做整体覆盖**：不比对文件差异，不支持部分更新或版本回退
- **本需求只做"市场"**；插件体系本身（清单规范、权限模型、生命周期）在本档案中确立约定，后续需求细化

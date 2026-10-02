# 02 依赖方向（铁律）

> **新增 import 前必看**。

## 单向依赖

```
infra ← providers ← tools ← bridge ← session ← app
                    ↑          ↑
                 overlay ──────┘

skills ← agents          （底层共享，供 session/tools 使用）
plugins                  （底层共享：扫描根由上层计算后传给 scanner）
```

箭头读作"被依赖"。即：

| 层 | 可依赖 | 不可依赖 |
|---|---|---|
| `infra/` | 无（最底层） | 一切上层 |
| `skills/` | 无（仅 node 内置） | 一切上层 |
| `agents/` | `skills`（仅用其 frontmatter 解析） | 一切上层 |
| `plugins/` | 无（仅 node 内置 + `tar`） | 一切上层 |
| `providers/` | `infra`、`plugins` | tools/bridge/overlay/session/app |
| `tools/` | `infra`、`providers`、`skills`、`agents`、`plugins` | bridge/overlay/session/app |
| `mcp/` | `infra`、`plugins` | tools/bridge/overlay/session/app |
| `bridge/` | `infra`、`providers`、`tools`、**`overlay`** | session/app |
| `overlay/` | `infra`、`providers`、`tools` | **bridge/session/app**（见下） |
| `session/` | `infra`、`providers`、`tools`、`bridge`、`skills`、`agents` | overlay/app |
| `app/` | 全部 | 无 |

**记忆法**：`infra` / `skills` 最底层，`app` 最顶层；`overlay` 与 `bridge` 是 UI 侧的"兄弟"，但 **bridge 可依赖 overlay，overlay 不可依赖 bridge**。

**关于 `skills/` 与 `agents/`**：两者是**底层共享模块**（纯文件扫描 + 解析，只依赖 node 内置；`agents/` 额外用 `skills/frontmatter`）。被 `session/prompt-builder`（组装提示词）、`tools/impl/run-agent`（执行子代理）等引用。**它们不得反向依赖任何上层**（如 app/bridge/session）。

**关于 `plugins/`**：同为**底层共享模块**（node 内置 + `tar`；`http.ts` 是唯一依赖 electron 的薄适配层，且 electron 只在函数内懒 require）。

已安装插件贡献的技能/代理/规则，**不是让 scanner 去 import `plugins/`**——那会形成
`skills ← plugins` 与 `plugins → skills` 的环。正确做法：

```
session / tools（依赖序在上）
   └── 调 plugins/roots.ts 的 getPluginScanRoots()
        └── 把绝对目录**作为参数**传给 scanSkills / scanAgents / scanRules
```

即 scanner 只多收一个可选入参（`extraSkillDirs` 等），**两边互不认识**，由上层居中传递。

`providers/` 也依赖 `plugins/`，但只调 `roots.ts` 的 `getEnabledPluginProviderFiles()`——
它只返回**插件总开关已打开**（`plugins-state.json` 的 `enabled`）的 provider 文件。
该函数只依赖 `paths` / `manifest` / `state`（全为纯 node），
不会把 `installer` 的 `tar` 拖进模块图。

`mcp/` 同理，只调 `getEnabledPluginMcpFiles()`（同一套开关）。

**为什么 MCP 与 provider 共用一个开关**：MCP server 定义会 spawn 子进程（`command` + `args`），
安全等级与 `providers/*.js` **同级**——都是"在本机运行第三方代码"。
而技能/代理/规则只是数据，所以开关统一控制"这个插件的全部内容"，
语义上比"部分内容单独授权"更不容易被误点。
未启用时三者**全部不生效**，且插件安装后**默认就是未启用**。

## 两个关键约束

### 1. overlay 不依赖 bridge / session

overlay 是纯 UI，**不知道** bridge/session 的存在。需要下层能力时，用**回调注入**：

```ts
// overlay/chat-input.ts —— 不 import bridge，改为"接线"
let hooks: { onMessageSent?: () => void } = {};
export function wireChatInput(h: typeof hooks) { hooks = h; }
// 内部：hooks.onMessageSent?.()

// bridge/entry.ts —— 初始化时注入
import { wireChatInput } from '../overlay/chat-input.js';
import { onMessageSent } from './loop/watchdog.js';
wireChatInput({ onMessageSent });
```

已有两个注入点：`wireChatInput`（chat-input）、`wireEvents`（events）。

### 2. bridge/session 不依赖 overlay 的 state

数据经**回调推送**，不共享状态：

```ts
// bridge/intercept/observer.ts —— 不写 overlay/state，改为回调传 meta
const meta = { tokenUsage: detail.tokenUsage, msgIds: detail.msgIds };
for (const cb of responseListeners) cb(text, meta);

// overlay/events.ts —— 接收方自己存局部变量
let serverTokenUsage: any = null;
hooks.onInterceptedResponse?.((_t, meta) => { serverTokenUsage = meta.tokenUsage; });
```

`overlay/state.ts` **只承载 overlay 内部**共享（发送延迟、项目目录、初始提示内容）。

## 特殊情况

| 情况 | 处理 |
|---|---|
| 需要 Electron 的 `app`/`dialog` 等 | 用 `createRequire(import.meta.url)` 动态 require（见下） |
| bridge 需要找当前 AI 页面 | 用 `windowState.getContextByWebContents`（**app 层**提供）；bridge 通过 IPC，不直接访问 |
| tools 需要窗口上下文 | 由 IPC 传入 `currentWindowId`，tools 用 `BrowserWindow.fromId` + `contentView.children` 找 view |

## Electron 的 createRequire 惯用法

Electron 的 `index.js` 导出的是字符串（不是模块），**静态 import 会失败**。必须：

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { app, ipcMain } = require('electron');
```

（这是 P3a ESM 转换的核心教训，详见归档手册 `P3a-esm-conversion-guide.md`。）

## 强制手段

`eslint.config.js` 里有自定义规则 `no-restricted-requires`（`eslint-rules/`）。因 D22（typescript-eslint 与 TS7 不兼容），**当前只检查 .js 文件**，.ts 尚未覆盖。所以**约束主要靠自觉 + 评审**，别指望 lint 全兜住。

## 为什么这样定

见归档 `docs/archive/refactor-2026/01-architecture.md` 第 3 节，以及 `03-decisions.md` 的 D8。

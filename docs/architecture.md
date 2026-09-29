# Cuckoo Code 架构与开发指南

> **面向读者**：接手本项目的 AI 助手 / 开发者。
> **性质**：描述**重构后的实际实现**（2026-09 完成），不是规划稿。
> **权威性**：以本目录文档 + 代码为准；历史规划稿在 `docs/archive/refactor-2026/`（已过时，仅供追溯）。

---

## 一、这是什么

Cuckoo Code 是一个**零 Token 成本**的 AI Agent 桌面应用：

- 用 Electron 把 AI 网页版（DeepSeek / Claude / ChatGPT）嵌入本地窗口
- 常驻界面由壳页面承担（左侧图标栏 + 侧面板 + 顶部地址栏）；AI 页面内只注入瞬态 UI（工具遮罩 / toast / 重试倒计时）与"网络拦截 hook"，捕获 AI 的完整回复
- 引导 AI 输出 `cuckoo` 代码块（JavaScript 工具调用）
- 在受限 vm 沙箱执行，结果回传 AI，形成 Agent 循环
- **不需要 API Key**，复用网页版账号

---

## 二、快速索引

| 文档 | 内容 | 何时看 |
|---|---|---|
| [01-结构.md](./arch/01-structure.md) | 目录结构与每个文件的职责 | 找"某个功能在哪个文件" |
| [02-依赖.md](./arch/02-dependency.md) | 依赖方向铁律 + ESLint 强制 | 新增 import 前必看 |
| [03-构建.md](./arch/03-build.md) | 构建流程、自动生成物清单 | 改构建 / 困惑于"生成文件" |
| [04-运行时.md](./arch/04-runtime.md) | 主进程 / 壳窗口 / AI 页面 / preload 数据流 | 理解整体如何跑起来 |
| [05-任务.md](./arch/05-tasks.md) | **常见任务手册**（加工具/加平台/改 UI） | **做新需求时最先看** |
| [06-测试.md](./arch/06-testing.md) | 测试与验证命令 | 提交前 |

---

## 三、技术栈

| 项 | 版本 / 说明 |
|---|---|
| 运行时 | Electron 44 |
| 语言 | TypeScript 7（主应用 `strict`） |
| 模块 | 纯 ESM（`"type": "module"`） |
| 构建 | `tsc` 编译到 `out/`；esbuild 打包 hook |
| 测试 | Vitest 5 |
| Lint | ESLint 10（含自定义依赖护栏规则） |
| 打包 | electron-builder |

---

## 四、30 秒鸟瞰

```
┌─────────────────────────────────────────────────────────┐
│ Electron BrowserWindow（每个 profile 一个）              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ webContents = 壳页面（src/ui/shell.html）          │   │
│  │   左侧图标栏 + 侧面板 + 顶部地址栏（浅色主题）       │   │
│  │   preload: src/app/shell-preload.ts               │   │
│  │   ↑ shellAPI: navigate/back/forward/reload/home   │   │
│  │   ↑ 面板状态：setPanelOpen / onPanelRestore        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ WebContentsView = AI 网页（deepseek.com 等）       │   │
│  │   preload: src/bridge/entry.ts                    │   │
│  │   ↑ 注入 hook（拦截 fetch/XHR 抓回复）             │   │
│  │   ↑ 注入瞬态 UI（overlay/：工具遮罩/toast/倒计时）  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │ IPC（contextBridge electronAPI）
         ▼
┌─────────────────────────────────────────────────────────┐
│ 主进程（src/app/entry.ts）                                │
│  ├── IPC 处理器（src/app/ipc/*）                          │
│  ├── 工具系统（src/tools/*）→ 沙箱执行 AI 生成的 JS        │
│  ├── 会话/项目（src/session/*）                            │
│  └── MCP 客户端（src/mcp/*）                               │
└─────────────────────────────────────────────────────────┘
```

**关键点**：AI 网页在一个 **WebContentsView** 里，窗口自身的 `webContents` 是壳页面（图标栏 / 顶栏 / 侧面板，浅色主题）。因此**任何"对当前 AI 页面操作"的代码，都要通过 `windowState.getContextByWebContents(...)` 拿到 `ctx.view`，而不是 `ctx.win.webContents`**。原覆盖层的面板/悬浮球/快捷键已删除或迁入 shell：面板状态存 `ctx.panelId`（主进程），`setPanelOpen` IPC 驱动布局重排；设置改由主进程 `settings-store.ts`（`userData/settings.json`）全局共享，工具活动历史在 `tool-activity.ts`（内存，按窗口隔离）。

---

## 四·五、任务提示词（docs/prompts/）

开新 AI 对话做任务时，把对应提示词发给它：

| 任务 | 提示词 |
|---|---|
| 做一个新需求（建分支+档案） | [new-requirement.md](./prompts/new-requirement.md) |
| 补全单元测试 | [write-unit-tests.md](./prompts/write-unit-tests.md) |

需求档案规则见 [docs/requirements/README.md](./requirements/README.md)，总览见 [INDEX.md](./requirements/INDEX.md)。

---

## 五、三条必记规则

1. **依赖方向单向**（见 [02-依赖.md](./arch/02-dependency.md)）：`infra ← providers ← tools ← bridge ← session ← app`，overlay 不依赖 bridge/session。
2. **别手改生成文件**（见 [03-构建.md](./arch/03-build.md)）：`*.generated.ts`、`src/tools/api.d.ts` 由构建脚本产出。
3. **改工具只改一处**（见 [05-任务.md](./arch/05-tasks.md)）：工具的 API 契约、沙箱注入、提示词章节全自动同步。

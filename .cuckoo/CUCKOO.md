# Cuckoo Code 项目说明

> 这份文件在初始化项目时随系统提示词一起发给 AI。动手改任何东西前，先读完它。
> 它相当于 Claude Code 的 CLAUDE.md，只不过写的是 Cuckoo Code 自己。

## 这是个什么项目

Cuckoo Code 是一个零 Token 成本的 AI Agent 桌面应用。

做法有点取巧：用 Electron 把 AI 网页版（DeepSeek、Claude、ChatGPT）套进本地窗口，注入一层覆盖 UI 和网络拦截 hook，抓到 AI 的完整回复。然后引导它输出 `cuckoo` 代码块——本质是 JavaScript 工具调用——丢进受限 vm 沙箱跑，结果再喂回 AI。就这样"想一步、做一步、看一步"，转成 Agent 循环。

不用 API Key，复用你网页版的账号，也就不按 Token 计费。

## 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 44 |
| 语言 | TypeScript 7，主应用开 strict |
| 模块 | 纯 ESM（`"type": "module"`） |
| 包管理 | npm |
| 测试 | Vitest |
| 打包 | electron-builder，Windows 只出 NSIS 安装版 |
| Node | >= 16，建议 18+ |

## 目录结构（对齐 v0.8.6）

```
src/
├── app/        主进程外壳：入口、窗口、IPC
│   └── ipc/    IPC 处理器，按领域拆开，index.ts 负责编排
│               command / session / tool / renderer / shell / subagent /
│               harness / snippets / settings / feishu / project
├── session/    会话和项目上下文：拼提示词、初始化、压缩
├── bridge/     与 AI 网页桥接（preload）：拦截、解析、跑执行循环
│   ├── intercept/  网络拦截观察器
│   ├── loop/       执行循环（executor / retry / watchdog）
│   ├── parser/     JS / JSON 工具调用解析
│   ├── harness-bridge.ts  纯净模式上报（v0.8.6 起）
│   └── feishu-bridge.ts   飞书同步上报（v0.8.6 起）
├── overlay/    覆盖层 UI，跑在 AI 页面里
│   └── panels/ mcp-manager / settings / window-manager
├── tools/      工具系统，唯一真相源（见 D12）
├── providers/  平台适配（DeepSeek / Claude / ChatGPT）
├── skills/     技能机制（scanner / config / market / prompt）
├── agents/     子代理机制（scanner / config / prompt）
├── mcp/        MCP 客户端与配置
├── feishu/     飞书同步（v0.8.6 起）
├── rules/      规则匹配，用 picomatch
├── updater/    自动更新，用 electron-updater
├── infra/      基础设施，最底层（paths / markdown / eol / dangerous-commands）
├── prompt/     各平台系统提示词模板
└── ui/         壳页面（shell.html / harness.html / platform-select.html）
scripts/        构建脚本（build-hooks / build-tool-api / fetch-runtime）
test/           单元测试
docs/           架构文档和需求档案
```

## 依赖方向（别乱来）

```
infra ← providers ← tools ← bridge ← session ← app
                    ↑          ↑
                 overlay ──────┘
skills ← agents   （底层共享）
```

几条不能破的：

- `overlay` 不依赖 bridge 和 session。要通消息就用回调注入，比如 `wireEvents`。
- `bridge` 和 `session` 不碰 overlay 的 state，数据走回调推过去。
- `tools` 不依赖 bridge / overlay / session / app。真需要下层能力，用注入，比如 `injectAgentRunner`。
- 细节看 `docs/arch/02-dependency.md`。

## 两套 UI 模式

| 模式 | 说明 |
|---|---|
| 网页模式（默认） | 直接显示 AI 网页（DeepSeek 等），加一层 overlay 面板 |
| 纯净对话模式（Harness） | 自绘的类 Codex UI，在 `src/ui/harness.html`。工具调用自带卡片折叠、实时渲染。按 `Ctrl+Shift+H` 或走菜单切换 |

Harness 靠三块配合：`harness-bridge.ts`（AI 页面上报）、`ipc/harness.ts`（转发）、`harness-preload.ts`（页面 API）。

## 动手之前，先读这些

1. `docs/architecture.md` 和 `docs/arch/` 的分册
   - `01-structure.md` 讲文件职责，`02-dependency.md` 讲依赖铁律，`03-build.md` 讲构建和生成物
   - `05-tasks.md` 是常见任务手册，`06-testing.md` 讲测试哲学
2. 有对应任务提示词（`docs/prompts/*.md`）就整篇读完，一条条执行。
3. `docs/requirements/INDEX.md` 能看到已有的需求。

## 常见任务

| 任务 | 关键点 |
|---|---|
| 加工具 | 改 `src/tools/impl/*.ts` 的 `apiMetas` 和 `bootstrap()`，再注册。名字四处要对齐。`npm run compile` 会生成契约 |
| 加平台 | 新建 `src/providers/<id>.ts` 和对应 hook，注册进 `build-hooks.mjs` 和 `registry.ts` |
| 改 UI | 覆盖层改 `src/overlay/template/overlay.{html,css}`，改完 `npm run compile`。壳页面改 `src/ui/shell.html` |
| 加设置项 | `overlay/panels/settings.ts` 的 open / save / reset 三处，加 `overlay.html` |
| 加 IPC | 主进程 `src/app/ipc/*.ts`，在 `ipc/index.ts` 注册，再从 `bridge/api.ts` 或 `shell-preload.ts` 暴露出去 |

## 构建和验证

```bash
npm start          # 编译并启动 Electron，日志进 wyp/log/
npm run compile    # 三步构建：build-hooks → tsc → build-tool-api
npm run typecheck  # 两套 tsconfig（主应用 + hooks），要 0 错误
npm test           # Vitest 全绿
npm run lint       # 0 problems
npm run build:win:nsis:local   # 本地打 Windows NSIS 安装包
```

提交前，typecheck、test、lint、compile 四样都得过。

改了运行时行为——IPC、hook、工具、UI 这些——必须真机 `npm start` 跑一遍确认。

## 关键约定

- **D12 工具契约**：工具是唯一真相源。改 `apiMetas` 和 `bootstrap()`，`api.d.ts` 和 `bootstrap.generated.ts` 会自己生成。
  - 名字四处一致：`apiMetas.name` = `super()` 首参 = `bootstrap` 里 `__call` 首参 = `globalThis.xxx`
  - 生成物别手改：`*.generated.ts`、`src/tools/api.d.ts`
- **窗口结构**：地址栏在 `win.webContents`（壳页面），AI 页面在 `ctx.view`（WebContentsView），纯净模式在 `ctx.harnessView`。要操作 AI 页面用 `ctx.view.webContents`，别顺手写成 `ctx.win.webContents`。
- **Electron 惯用法**：主进程模块用 `createRequire(import.meta.url)` 动态 require，别静态 import 'electron'。
- **需求流程**：新功能、行为变更、多文件改动，先建需求档案（`docs/requirements/<id>-<slug>.md`）和分支（`<type>/<id>-<slug>`）。单文件单行的纯文案改动可以跳过。
- **测试哲学**：只写真集成测试，不写深 mock 的；失败路径优先覆盖。

## 做事的规矩

- 任务列了清单（P0/P1/P2，或者步骤 1~7），就一项项做完，别跳。
- 多步任务先用 todoWrite 列出来，做完一项勾一项。
- 实在做不了的，立刻说清楚原因，别闷声略过。
- 每完成一项就 typecheck + test + lint，全绿再往下走。
- 收尾交一份报告：做了什么、没做什么及原因、验证结果、后续建议。别"默默少做"。

## 子代理和技能

代理在 `.cuckoo/agents/`（项目级）和 `~/.cuckoo/agents/`（用户级），用 `runAgent(name, task)` 委派。
技能在 `.cuckoo/skills/` 和 `<userData>/skills/`（应用级，走界面「技能」页管理，也能从 SkillHub 市场装）。

## 其它

- 有疑问先问，别猜。
- 相关文档：`docs/architecture.md`、`docs/backlog.md`（待办）、`docs/tool-errors-analysis.md`（工具错误分析）。

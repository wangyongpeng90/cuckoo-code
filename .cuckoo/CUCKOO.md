# Cuckoo Code 项目说明

> 本文件在初始化项目时随系统提示词发送给 AI。**做任何改动前先读它。**
> （类似 Claude Code 的 CLAUDE.md，但对象是 Cuckoo Code 自身。）

## 一、这是什么

**Cuckoo Code** 是一个**零 Token 成本**的 AI Agent 桌面应用：

- 用 Electron 把 AI 网页版（DeepSeek / Claude / ChatGPT / 智谱）嵌入本地窗口
- 注入覆盖层 UI + "网络拦截 hook"，捕获 AI 的完整回复
- 引导 AI 输出 `cuckoo` 代码块（JavaScript 工具调用）
- 在受限 vm 沙箱执行，结果回传 AI，形成"思考→行动→观察→再行动"的 Agent 循环
- **不需要 API Key**，复用网页版账号（不按 Token 计费）

## 二、技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 44 |
| 语言 | TypeScript 7（主应用 strict） |
| 模块 | 纯 ESM（`"type": "module"`） |
| 包管理 | npm |
| 测试 | Vitest |
| 打包 | electron-builder |
| Node | >= 16（建议 18+） |

## 三、目录结构（顶层）

```
src/
├── app/        应用外壳（主进程）：入口、窗口、IPC、壳页面
├── session/    会话与项目上下文：提示词组装、初始化、压缩
├── bridge/     与 AI 网页桥接（preload）：拦截、解析、执行循环
├── overlay/    覆盖层 UI（运行在 AI 页面）
├── tools/      工具系统（唯一真相源，D12）
├── providers/  平台适配（DeepSeek/Claude/ChatGPT）
├── skills/     技能机制（底层共享）
├── agents/     子代理机制（底层共享）
├── mcp/        MCP 客户端与配置
├── infra/      基础设施（最底层）
├── prompt/     各平台系统提示词模板
└── ui/         壳页面（shell.html 等）
scripts/        构建脚本
test/           单元测试
docs/           架构文档 + 需求档案
```

详见 `docs/arch/01-structure.md`。

## 四、依赖方向（铁律）

```
infra ← providers ← tools ← bridge ← session ← app
                    ↑          ↑
                 overlay ──────┘
skills ← agents   （底层共享）
```

- `overlay` **不依赖** bridge / session（用回调注入，如 `wireEvents`）
- `bridge` / `session` **不依赖** overlay 的 state（数据经回调推送）
- `tools` **不依赖** bridge/overlay/session/app（需要下层能力用**注入**，如 `injectAgentRunner`）
- 详见 `docs/arch/02-dependency.md`

## 五、开工前：先读文档

1. 读 `docs/architecture.md`（及 `docs/arch/` 分册）：
   - `01-structure.md` 文件职责 ／ `02-dependency.md` 依赖铁律 ／ `03-build.md` 构建与生成物
   - `05-tasks.md` 常见任务手册 ／ `06-testing.md` 测试哲学
2. 若有对应任务提示词（`docs/prompts/*.md`），**完整读它，逐项执行**。
3. 读 `docs/requirements/INDEX.md` 了解已有需求。

## 六、常见任务（详见 docs/arch/05-tasks.md）

| 任务 | 关键点 |
|---|---|
| **加工具** | 改 `src/tools/impl/*.ts` 的 `apiMetas` + `bootstrap()` + 注册；**名字四处一致**；`npm run compile` 自动生成契约 |
| **加平台** | 新建 `src/providers/<id>.ts` + hook；注册到 `build-hooks.mjs` 和 `registry.ts` |
| **改 UI** | 页面内瞬态元素：`src/overlay/template/overlay.{html,css}` → `npm run compile`；shell 侧栏面板：`src/ui/shell.{html,css}` + `src/ui/panels.js` |
| **加设置项** | `app/settings-store.ts`（默认值/校验）+ shell 设置面板（`src/ui/shell.html` + `src/ui/panels.js`） |
| **加 IPC** | 主进程 `src/app/ipc/*.ts` + `bridge/api.ts` 暴露 |

## 七、构建与验证

```bash
npm start          # 编译 + 启动 Electron（日志进 wyp/log/）
npm run compile    # 三步构建：build-hooks → tsc → build-tool-api
npm run typecheck  # 两套 tsconfig（主应用 + hooks），0 错误
npm test           # Vitest 全绿
npm run lint       # 0 problems
npm run build:win:local   # 本地打 Windows 包
```

**提交前必做**：typecheck / test / lint / compile **全绿**。
**改了运行时行为（IPC / hook / 工具 / UI）→ 必须真机 `npm start` 验证。**

## 八、关键约定

- **D12 工具契约**：工具是唯一真相源。改 `apiMetas` + `bootstrap()`，`api.d.ts` 与 `bootstrap.generated.ts` **自动生成**。
  - 名字四处一致：`apiMetas.name` = `super()` 首参 = `bootstrap` 里 `__call` 首参 = `globalThis.xxx`
  - **别手改生成物**：`*.generated.ts`、`src/tools/api.d.ts`
- **窗口结构**：地址栏在 `win.webContents`（壳页面），AI 页面在 `ctx.view`（WebContentsView）。
  操作 AI 页面用 `ctx.view.webContents`，**不是** `ctx.win.webContents`。
- **Electron 惯用法**：主进程模块用 `createRequire(import.meta.url)` 动态 require，**不可**静态 import 'electron'。
- **需求流程**：新功能/行为变更/多文件 → 建需求档案（`docs/requirements/<id>-<slug>.md`）+ 分支（`<type>/<id>-<slug>`）。
  小改动（单文件单行/纯文案）→ 免档案，直接改。
  改需求文档后 INDEX 自动更新（pre-commit 钩子）；也可手动 `npm run docs:index`。
- **测试哲学**：只写**真实集成测试**，不写深 mock 测试；优先覆盖**失败路径**。

## 九、任务纪律（硬要求）

- **逐项完成**：任务列了清单（P0/P1/P2、步骤 1~7），**每项都做，不许跳**。
- **用 todoWrite 跟踪**：多步任务先列 todo，做一项勾一项。
- **做不了就明说**：无法完成的项，**立即说明原因**，不许默默跳过。
- **边做边验**：每完成一项，立即 typecheck + test + lint，全绿再继续。
- **收尾必须交付报告**：做了什么 / 没做什么（及原因） / 验证结果 / 后续建议。**不许"默默少做"**。

## 十、可用子代理（Agents）

本项目的专用子代理在 `.cuckoo/agents/`（用 `runAgent(name, task)` 委派）：

| 代理 | 用途 |
|---|---|
| `arch-guard` | 架构合规审查（依赖铁律 / D12 / 生成物禁改 / ctx.view） |
| `tool-smith` | 按 D12 加/改工具 |
| `build-doctor` | 构建/编译/打包问题诊断 |
| `req-writer` | 按规范创建需求档案 + 分支 |
| `hook-surgeon` | 修改 provider hook（网络拦截/SSE/截断检测） |

用户级通用代理（`~/.cuckoo/agents/`）：`explore`（只读探索）、`code-reviewer`（代码审查）、`test-runner`（跑测试+根因分析）。

## 十一、其它

- 有疑问先问，别猜。
- 相关文档：`docs/architecture.md`、`docs/backlog.md`（待办）、`docs/tool-errors-analysis.md`（工具错误分析）。

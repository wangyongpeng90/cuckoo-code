# 01 目录结构与职责

> 每个文件一句话职责。找功能先在这里定位。

## 顶层

| 路径 | 职责 |
|---|---|
| `package.json` | `main` 指向 `out/src/app/entry.js`；scripts 见 [03-构建.md](./03-build.md) |
| `start.js` | 启动脚本：先 `tsc` 编译，再启动 Electron，日志写入 `wyp/log/` |
| `tsconfig.json` | 主应用 TS 配置（`strict: true`，**排除** hooks） |
| `tsconfig.hooks.json` | hook 独立类型环境（非 strict，见 [03-构建.md](./03-build.md)） |
| `tsconfig.build.json` | 编译配置（`outDir: out`） |
| `eslint.config.js` | ESLint + 依赖护栏规则 |
| `vitest.config.mjs` | 测试配置 |
| `scripts/` | 构建脚本（见下） |

## 顶层薄壳

- 无 `main.js` / `preload.js` 薄壳。Electron 直接读 `package.json` 的 `main`。

## src/app/ —— 应用外壳（主进程）

| 文件 | 职责 |
|---|---|
| `entry.ts` | 应用入口：userData 目录、窗口创建（壳+view）、应用菜单、单实例锁 |
| `shell-preload.ts` | 壳页面 preload，暴露 `window.shellAPI`（导航 + 面板 + 快捷键 relay） |
| `window.ts` | 多窗口管理：`WindowContext { win, view, profileId, providerId, sessionStore }`；`getContextByWebContents` 同时匹配 win 与 view |
| `layout.ts` | 壳布局纯函数：图标栏 52 / 面板 280 / 圆角卡片 bounds；`SHELL_PANEL_IDS` 校验 |
| `shortcuts.ts` | view 按键 → 壳面板动作的纯判定（Ctrl+Shift+C / Esc，before-input-event 用） |
| `profile.ts` | 窗口 Profile（名称、providerId、partition）的读写 |
| `settings-store.ts` | 设置主进程持久化（`userData/settings.json`，全局共享）；旧 localStorage 键首启迁移 |
| `tool-activity.ts` | 工具活动历史（主进程内存，按窗口隔离，上限 50），供壳任务面板拉取 |
| `ipc/index.ts` | IPC 注册总入口，编排下列子注册器 |
| `ipc/project.ts` | `init-project` |
| `ipc/session.ts` | `list-sessions` / `navigate-session`（导航走 `ctx.view`） |
| `ipc/command.ts` | `execute-command`（含危险命令确认框） |
| `ipc/tool.ts` | `execute-tool` / `execute-js` |
| `ipc/renderer.ts` | `show-ai-notification` / `chat-send-enter` / `simulate-mouse` |
| `ipc/shell.ts` | 地址栏导航 IPC + `pushUrlState`（把 URL 推给壳页面） |

## src/session/ —— 会话与项目上下文

| 文件 | 职责 |
|---|---|
| `store.ts` | 会话-目录映射持久化（每 profile 一个 json）；URL 变化时更新状态 |
| `project-context.ts` | `initProject`：选目录、保存映射、发送初始提示 |
| `prompt-builder.ts` | **系统提示词组装**：读模板、填占位符、拼 MCP/平台/项目章节 |
| `compaction.ts` | 上下文压缩：让 AI 写摘要 → 建分享链接 → 跳转 |

## src/bridge/ —— 与 AI 网页桥接（preload，运行在 AI 页面）

| 文件 | 职责 |
|---|---|
| `entry.ts` | preload 入口：注入 hook、注册 IPC、回调接线、初始化覆盖层 |
| `api.ts` | `contextBridge` 暴露 `window.electronAPI`（所有 IPC 的渲染侧封装） |
| `intercept/observer.ts` | 监听 `cuckoo-ai-response/error` 事件，分派处理；对外提供 `onInterceptedResponse`/`onAiError` |
| `parser/js-detector.ts` | 检测并提取 `cuckoo` / js 代码块（AI 的 JS 工具调用） |
| `parser/json-detector.ts` | **仅识别** JSON 格式工具调用（D11 已废除执行，检测到发提示） |
| `loop/executor.ts` | 执行 JS 工具脚本，上报工具活动到主进程（shell 任务面板展示） |
| `loop/watchdog.ts` | 工具循环看门狗：等回复超时则催"请继续" |
| `loop/retry.ts` | 失败自动重试引擎：订阅 `cuckoo-ai-error`，退避后重发提示词 |

## src/overlay/ —— 覆盖层 UI（运行在 AI 页面）

UI 改版（Task 6-8）后，面板/悬浮球/弹窗已迁往 shell 侧栏（`src/ui/`），
页面内只保留**瞬态元素**：工具执行遮罩、toast、重试倒计时。

| 文件 | 职责 |
|---|---|
| `panel.ts` | 瞬态 UI 基础：注入 CSS/HTML、toast、工具遮罩显隐 |
| `events.ts` | **事件编排**：token 统计 + 自动压缩 + 压缩流程（shell「压缩」按钮 relay） |
| `chat-input.ts` | 输入框定位/填值/发送；工具结果回传；IPC 监听 |
| `token-counter.ts` | 对话 token 统计（只上报 shell，不写 overlay DOM） |
| `auto-compact.ts` | 自动压缩运行态（设置 UI 在 shell 侧栏） |
| `retry-countdown.ts` | 重试倒计时浮层（动态创建） |
| `settings.ts` | 渲染侧设置缓存：主进程 settings.json 读口 + 旧 localStorage 键迁移 + hook 键镜像 |
| `state.ts` | overlay 层共享状态（**只放 overlay 内部**；bridge/session 数据走回调） |
| `storage.ts` | localStorage 键名集中管理 + 读写封装 |
| `dom.ts` | 安全 DOM 构建助手（h / replaceChildrenOf） |
| `template.generated.ts` | **生成**：把 `template/*.html/.css` 变成 TS 字符串 |
| `template/overlay.html` | 覆盖层 HTML **真源**（只剩工具遮罩） |
| `template/overlay.css` | 覆盖层 CSS **真源**（遮罩/toast/倒计时样式） |

## src/tools/ —— 工具系统

| 文件 | 职责 |
|---|---|
| `core/Tool.ts` | 工具基类 + `ToolApiMeta` 接口（D12 元数据） |
| `core/ToolRegistry.ts` | 注册表：register/get/execute/listNames/getPromptSections 等 |
| `core/ToolResult.ts` | 统一执行结果 |
| `runtime/JsRunner.ts` | **vm 沙箱**：执行 AI 生成的 JS，注入工具函数 |
| `runtime/bootstrap.generated.ts` | **生成**：沙箱注入脚本（工具函数定义） |
| `impl/*.ts` | 18 个工具实现（见 [05-任务.md](./05-tasks.md)） |
| `index.ts` | 注册所有工具，导出单例 `registry` / `jsRunner` |
| `api.d.ts` | **生成**：给 AI 看的工具 API 契约 |

## src/providers/ —— 平台适配

| 文件 | 职责 |
|---|---|
| `types.ts` | Provider 接口定义 |
| `validate.ts` | 运行时字段校验（D14） |
| `registry.ts` | 内置 provider + 自定义加载 + `getProvider` / `getProviderByUrl` |
| `deepseek.ts` / `claude.ts` / `chatgpt.ts` | 各平台：元数据 + 选择器 + `getHookSource()` |
| `hooks/shared/sse.ts` | hook 共享：SSE 帧解码 |
| `hooks/{deepseek,claude,chatgpt}.ts` | 各平台网络拦截器（**真源**，构建期打包） |
| `generated/hook-sources.ts` | **生成**：打包后的 hook 字符串 |
| `custom/loader.ts` | 自定义 provider 的导入/替换/删除 |
| `custom/provider.template.js` | 自定义 provider 模板 |

## src/mcp/

| 文件 | 职责 |
|---|---|
| `client.ts` | MCP 客户端：连接 server、列工具、调用 |
| `config.ts` | MCP 配置读写（Claude Desktop 兼容格式） |

## src/infra/ —— 无业务基础设施（最底层）

| 文件 | 职责 |
|---|---|
| `paths.ts` | 资源路径解析（`resolveAsset`/`resolveSrc`/`resolveToolSpec`），锚定应用根 |
| `decode-output.ts` | 命令输出解码 + 命令规范化 |
| `dangerous-commands.ts` | 危险命令检测 |
| `with-log.ts` | 给函数加调用日志（AOP） |
| `markdown.ts` | `BT` / `FENCE` 常量 |

## src/skills/ 、src/agents/ —— 底层共享模块

| 文件 | 职责 |
|---|---|
| `skills/frontmatter.ts` | 极简 YAML frontmatter 解析（零依赖） |
| `skills/scanner.ts` | 扫描 `.cuckoo/skills/<name>/SKILL.md`（项目级 + 用户级），解析 name/description |
| `skills/prompt.ts` | 生成系统提示词的「可用技能」章节 |
| `skills/index.ts` | 模块入口 |
| `agents/scanner.ts` | 扫描 `.cuckoo/agents/<name>.md`（项目级 + 用户级），解析 name/description/tools/maxTurns |
| `agents/prompt.ts` | 生成系统提示词的「可用子代理」章节 |
| `agents/types.ts` | `AgentMeta` / `AgentSource` 类型 |
| `agents/index.ts` | 模块入口 |

## src/updater/ 、src/types/ 、src/prompt/ 、src/ui/

| 路径 | 职责 |
|---|---|
| `updater/index.ts` | 自动更新（electron-updater） |
| `types/third-party.d.ts` | 无 @types 的第三方模块声明（turndown 等） |
| `prompt/*.md` | 各平台系统提示词模板（含占位符） |
| `ui/shell.html/css/js` | 壳页面骨架：左侧图标栏、顶栏、侧面板状态机（Ctrl+Shift+C / Esc 折叠展开） |
| `ui/panels.js` | 侧面板内容：主页 / 会话 / 窗口 / MCP / 任务 / 设置 / 项目 |
| `ui/platform-select.html/css/js` | 首次选择平台页面（浅色主题；导入/替换/删除自定义 Provider，DOM 安全构建） |

## scripts/

| 文件 | 职责 |
|---|---|
| `build-hooks.mjs` | esbuild 打包 hooks → `hook-sources.ts`；同时生成 `template.generated.ts` |
| `build-tool-api.mjs` | 从工具 `apiMetas` 生成 `api.d.ts`；从 `bootstrap()` 生成 `bootstrap.generated.ts` |

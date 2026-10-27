---
id: 022
type: feature
title: DSH 插件兼容（Cuckoo 里安装/运行 DSH 插件）
status: in_progress
branch: feat/022-dsh-compat-c7
created: 2026-10-06
updated: 2026-10-26
---

## 背景

DSH（DeepSeek Harness）是 DeepSeek 官方的 Agent 框架，生态里已有大量**插件**（npm 包，用 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-tools` 写）。

目标（用户原话）：**"类似鸿蒙兼容 Android 应用"** —— 让 Cuckoo **能装、能跑 DSH 插件**，但**不依赖任何 DSH 代码**（Cuckoo 自己实现同名 API）。

## 目标

- **插件不用改**：DSH 插件**原样**放进 Cuckoo 就能跑（鸿蒙路子）
- **不依赖 DSH 代码**：Cuckoo **自己实现** `@deepseek-ai/*` 的同名 API（"转接头"）
- **预留 Cuckoo 独有扩展**：未来 DSH 插件能用上 Cuckoo 更丰富的能力

## 分期

| 期 | 内容 |
|---|---|
| **P1** | 核心 `ctx` + `defineTool`（**工具类插件能用**）|
| **P2** | 模块解析 + TS 转译 + 更多 DSH 服务映射 |
| **P3** | UI/命令/主题等 DSH 客户端能力 |

## 关键决策（10 个确认点）

1. **目标 A**：自己实现，不依赖 DSH 代码 + 预留 Cuckoo 独有扩展
2. **范围 C**：全套（工具/服务/事件/生命周期/UI）
3. **分期 B**：P1 核心 → P2 模块/TS → P3 UI
4. **来源 A**：npm 包名 + 自带 npm 下载
5. **P1 覆盖 A**：核心 `ctx` + `defineTool`
6. **import 劫持 C**：**esbuild 打包替换**（`@deepseek-ai/*` → 我们的 shim）
7. **目录**：`~/.cuckoo/cuckoo-plugins/<id>/`
8. **P1 靶子 A**：DSH 的 `scratch-plugin`（`greet-tool`）
9. **运行时 A**：**主进程**（DSH 插件是 Node 代码）
10. **验证 C**：先脚本（`try-dsh-plugin.mjs`）→ 再固化测试
11. **"够用空接口" B**：未实现的 DSH API 一律 **stub**（万能 Proxy），**所有插件都能装/加载**；副作用可空转
12. **C1 A**：`ctx.settings/tools/sessions` **接 Cuckoo 真能力**（宿主能力注入）
13. **C2 做**：**最小 DSH 运行时**（内存会话事件流 + 投影）——让插件"写进去能读回来"（自洽）

## P1 实现（已交付）

### P1-a：核心链路（`src/plugins/dsh-compat/shim.ts`）

- **`defineTool`**：DSH 参数（隐式 open object + 每属性 `required` 标注）→ JSON Schema；`output.render` → 字符串
- **`Service`**：cordis 服务基类（P1 简化占位；P2 补真实现）
- 验证脚本 `scripts/try-dsh-plugin.mjs`（手动跑看全过程）

### P1-b：集成（`src/plugins/cuckoo-plugins/`）

| 文件 | 职责 |
|---|---|
| `paths.ts` | 目录约定（`~/.cuckoo/cuckoo-plugins/<id>/`）|
| `state.ts` | 启用状态（`cuckoo-plugins-state.json`）|
| `installer.ts` | **npm 下载**（用自带 npm）|
| `loader.ts` | **esbuild 打包**（劫持 `@deepseek-ai/*`）+ 执行 + 收集工具 |
| `index.ts` | 集成（`installAndLoad` / `loadEnabledPlugins` / `DshPluginTool`）|

- **主进程启动加载**（`entry.ts` → `loadEnabledPlugins`）
- **沙箱动态注入**（`JsRunner.ts` → `buildDynamicToolsBootstrap`）：插件工具运行时注入 → **AI 可调用**

### P1-c：管理 UI（插件页「DSH 插件（npm）」区块）

- **主进程 IPC**：`cuckoo-plugin-list/install/uninstall/toggle/open-dir`
- **UI**：安装（输入 npm 包名）/ 启停 / 卸载 / 打开目录

### 关键修复（P1 期间）

- **入口回退**：npm 装的插件是"壳目录"（真插件在 `node_modules/<依赖>`）→ `resolveEntry` 回退查找
- **schema 递归**：`dshParamsToJsonSchema` 递归提取嵌套 `required/enum`（工具参数准确）
- **jsApi 展开**：`todo_write(todos: ({content: string, status: "..."})[])`——AI 看签名即懂
- **globalThis 共享**：esbuild 内联导致模块变量不共享 → 运行时会话用 `globalThis`

## C1：ctx 服务接 Cuckoo 真能力

```
插件 ctx.settings.get/set   → 插件自己的配置（plugins-config.json）
插件 ctx.tools.list()       → Cuckoo 工具表（registry.listNames）
插件 ctx.sessions.*         → Cuckoo 会话（各窗口 sessionStore）
```

**机制**：**宿主能力注入**（`src/app/cuckoo-host.ts` 构造 → `loadEnabledPlugins` 传入；plugins 层不直接依赖 app/session）。

## C2：最小 DSH 运行时（`src/plugins/dsh-compat/runtime.ts`）

- **内存会话事件流**：`session.append(type, data)` → 存内存 + 驱动所有投影
- **投影注册表**：`ctx.sessionProjections.register({key,init,apply,view})` → `get(key)` 读视图
- **接入**：`exec.agent.session.append(...)` 真写进内存会话（不再空转）
- **简化自 DSH**：不做落盘 / checkpoint / watermark / change feed（DSH 的性能优化，Cuckoo 用不着）

> **⚠️ 边界**：内存流水——**本次运行内**写读自洽；**重启/换会话丢失**（未落盘）。
> **C5 已解决**：见下方 C5 章节（JSONL 落盘 + 启动重放）。

## C3：事件总线（`src/plugins/cuckoo-plugins/event-bridge.ts`）

- **EventBus**：复用 `src/plugins/runtime/events.ts`（5 种派发：emit/parallel/serial/bail/waterfall）
- **每个插件一个 EventBus**：`ctx.on/once/off/emit/parallel/serial/bail/waterfall` **接真**
- **事件桥**：主进程 `harness-event-report` → 转 DSH 事件名 → 广播给所有活跃插件
- **映射**：stream→assistant-stream / assistant-done→turn-end / task-idle / tool-start→tool/call / tool-end→tool/result

**现在**：DSH 插件 `ctx.on('agent/turn-end', ...)` **能收到** Cuckoo 的 AI 事件。

## C4-A：ctx.systemPrompt（`src/plugins/dsh-compat/prompt-sections.ts`）

- **注册表**：插件 `ctx.systemPrompt.section({name, order, text})` → 全局表（按 order 排序）
- **合并**：`prompt-builder.ts` 把插件段合并进 `{{TOOL_SECTIONS}}`（与工具 section 一起进系统提示词）

**现在**：DSH 插件注册的提示词段**真进** Cuckoo 系统提示词。

## C4-B：ctx.fs（`src/plugins/dsh-compat/fs-service.ts`）

- **简化实现**：`resolve / readText / streamText / listDir / writeText / editText`（基于 node:fs）
- **基准**：相对路径基于**当前项目目录**（宿主注入）
- **对比 DSH**：DSH 是"沙箱化 + target/version/observe"的大服务；Cuckoo 简化掉版本/观察/沙箱

## C4-C：ctx.agents（`src/plugins/dsh-compat/agents-service.ts`）

- **只读视图**：`get(id) / current() / list() / roots()`——会话 → agent 视图（`{ id, session: { id, projectDir } }`）
- **写操作**（`4731e13` 提交新增）：`create(options)` / `followup(msg)` / `whenIdle()`
  - `create`：登记到 `activeSessions`，返回 `{ agent, dispose }` handle
  - `followup`：消息入 `state.queue`，异步 `processQueue` 消费（导航首页 + 合并提示词 + 发消息）
  - `whenIdle`：等 `state.status` 变 `idle`
  - `onAssistantDone`：AI 回复完成时把 `busy` 状态解锁，推进队列
- **对比 DSH**：DSH 是 Cordis fiber 驱动的活 agent；Cuckoo 用 `activeSessions` Map + `state.queue` 模拟 Inbox 语义

> **C4 完整**（systemPrompt + fs + agents 全接真）。

## C4-D：ctx.agents 深度对齐（2026-10-22，见决策记录第九章）

**基准**：`dsh-v0.2.0-rc.2`（commit `639ed01539`）
**详细决策**：见 `docs/dsh-compat-decisions.md` 第九章

本次讨论针对 `@weibaohui/dsh-tasks` 的最小兼容，逐项核对 `ctx.agents` 契约（`CreateAgentOptions` 共 9 字段，dsh-tasks 实际只用 5 项）：

| 步骤 | 决策 | 状态 |
|---|---|---|
| 9.1 `create` 只落库，不导航不发消息 | 待实现 | TODO |
| 9.2 `meta.cwd` 严格校验绝对路径 | 待实现 | TODO |
| 9.3 `setup` 必调，`agentCtx` 最小实现 | 待实现 | TODO |
| 9.4 `agentPresets` C-light（诚实映射现状） | 待实现 | TODO |
| 9.5 `workspaceRegistry` 升级为持久化注册表 | 待实现 | TODO |
| 9.6 `attachSession` 完整五道校验 | 待实现 | TODO |
| 9.7 `session.append` 补错误传播 | 待实现 | TODO |
| 9.8 队列 3 缺陷 + 压缩冲突（记 TODO） | 已记录 | TODO |

**待实现的意义**：以上 8 项是在"讨论阶段"定下的决策，代码改动尚未落地。等实施完成后再把状态改为已完成。

## C5：插件会话落盘（`src/plugins/cuckoo-plugins/plugin-storage.ts`）

- **存储**：JSONL（`~/.cuckoo/cuckoo-plugins-data/<id>/session.jsonl`），事件流追加
- **运行时**：`attachStorage`——加载时**读回重放**（驱动投影恢复状态）；`append` 时**落盘**
- **lazily build**：投影**后注册**时，**fold 已有历史**（DSH 机制）
- **对比 DSH**：DSH 有 `storage`（hub）+ 后端（json/sqlite）+ domain；Cuckoo 简化到"一个 JSONL 文件"

**现在**：插件 `append` 的事件**落盘** → **重启后投影恢复**。

## C6：7 个服务（`src/plugins/dsh-compat/c6-services.ts`）

| 服务 | Cuckoo 对应 |
|---|---|
| `ctx.skills` | scanSkills |
| `ctx.commands` | snippets |
| `ctx.goals` | 目标状态 |
| `ctx.compaction` | 触发压缩 |
| `ctx.workspaceFiles` | 文件树 |
| `ctx.sessionTitle` | sessionStore |
| `ctx.tokenMeter` | token-stats |

**现在**：DSH 插件能"列技能/命令、看目标、触发压缩、读 token、读写标题"。

## C7：subagents / shell / sessionQuery（`src/plugins/dsh-compat/c7-services.ts`）

- `ctx.subagents`：list（scanAgents）+ run（runAgent 工具）
- `ctx.shell`：exec（bash 工具）
- `ctx.sessionQuery`：get（sessionStore.getSessionMeta）

## C8：mcpResources / web / browserUse / attachments / terminals（`src/plugins/dsh-compat/c8-services.ts`）

- `ctx.mcpResources`：call/listServers/listTools（mcpCall 等工具）
- `ctx.web`：fetch（webFetch 工具）
- `ctx.browserUse`：open/inject（openBrowserWindow/injectJS 工具）
- `ctx.attachments`：attach（attachFile 工具）
- `ctx.terminals`：exec（bash 工具）
- `ctx.computerUse / ssh / lsp`：空实现（不崩）

> **C7/C8 在分支 `feat/022-dsh-compat-c7`**（未合 master）。

## C7 后续修复：窗口定位与压缩上下文

**背景**：真机验证 dsh-tasks 时发现两类问题——插件指定的窗口未打开时，命令跑到了错误窗口；压缩上下文后新会话丢失项目目录。根因都是「会话 ID / 窗口定位」的解析逻辑不完整。

### 修复 1：插件按 profileId 找不到窗口时主动拉起（`e627104`）

**问题**：`cuckoo-host.ts` 的 `navigateWindowToHome` / `sendUserMessage` 在按 `profileId` 找不到窗口时，**静默回退到"最后一个已打开的窗口"**，导致插件任务在错误的窗口里执行。

**修复**：找不到窗口时调 `createWindow(profile)` 主动拉起目标窗口，再执行后续操作。

### 修复 2：navigate-session 支持跨窗口跳转（`8bb50f9`）

**问题**：dsh-tasks 的「打开对话」传入 `logicId`，但 `navigate-session` 只用当前窗口导航，没有查找 `logicId` 归属的窗口。

**修复**：先查数据库拿 `web_id` + `profile_id`，按 `profile_id` 找目标窗口（找不到则拉起），再在目标窗口导航。保留同 URL 跳过刷新逻辑。

### 修复 3：压缩后新会话目录绑定（`85eb557`）

**问题**：压缩跳转到分享页（`/share/xxx`）时，该页面既无 `webId` 也不是主页，`handleUrlChange` 提前 `return` 导致内存里的 `currentSessionId` 残留旧会话 ID。随后 `selectProjectDir` 把目录写到了旧记录上，新会话的 `project_dir` 为空。

**修复**：
1. 无 `webId` 页面（含分享页）立刻清空 `currentSessionId`
2. `selectProjectDir` 加 `isCompaction` 参数，压缩场景强制写 `pendingProjectDir`，不写旧逻辑 ID
3. `initProject` 把 `isCompaction` 传给 `selectProjectDir`

### 修复 4：彻底废除 `local-xxx` 临时 ID（`c4b889d`）

**问题**：`aae0435` 引入的「新窗口立刻生成 `local-xxx` 临时 ID 并落库」设计，导致数据库堆积大量 `web_id=null` 的垃圾记录，且压缩/新建对话时反复复用旧 ID，产生"父子指向自己"的死循环数据。

**修复**：
1. 加号（壳页面 / 工作区 / 纯净模式）只做 `loadURL(homeUrl)` 纯导航，不再重置状态
2. 落地首页 / 分享页等无 `webId` 页面立刻清空 `currentSessionId` 为 `null`
3. 取消窗口创建时的 `tempLogicId` 生成——没发消息就没有会话记录

> **工作区加号例外**：工作区「+」保留 `?cuckoo-project-dir=xxx` 参数，让初始化遮罩层默认填好该工作区的目录（`b25a219`）。

## 验证

### 单测（956 tests 全过）

- `test/plugins/dsh-compat.test.js`（9）：`defineTool` 转换 + 递归 schema
- `test/plugins/cuckoo-plugin-load.test.js`（2）：加载 → 注册 → 执行
- `test/plugins/plugin-tool-inject.test.js`（4）：动态注入沙箱 + AI 调用 + jsApi 展开
- `test/plugins/c1-host-services.test.js`（4）：settings/tools/sessions 接入
- `test/plugins/c2-session-events.test.js`（1）：append 真写 + 投影真读回
- `test/app/new-conversation.test.js`（8）：加号纯导航契约（不重置状态）
- `test/app/window-resolution.test.js`（8）：插件按 profileId 拉起窗口 + navigate-session 跨窗口跳转

### 真机验证

- **2026-10-06**：`greet-tool` → AI 调 `await greet("Cuckoo")` → `"你好，Cuckoo！(来自 DSH 插件)"` ✅
- **2026-10-08**：**官方包** `@deepseek-ai/dsh-tool-todo` → AI 调 `todo_write([...])` → `"Updated todo list: ..."` ✅

### 对照测试（Cuckoo vs 真 DSH）

- 同一插件 `@deepseek-ai/dsh-tool-todo`，**DSH 侧**（`new Context()` + 挂 ToolRuntime/SessionProjectionRegistry/插件）与 **Cuckoo 侧** 跑
- **Schema 一致**（todos 数组 + {content,status} + enum + required）
- **执行结果一致**（"Updated todo list: 1 pending, 0 in progress, 0 completed."）
- ✅ **Cuckoo 与真 DSH 表现一致**（"鸿蒙兼容 Android"验证）

## 未完成

- **C4-D 的 8 项决策**：见上方 C4-D 章节，需按 `docs/dsh-compat-decisions.md` 第九章逐个实现
- **队列系统深化**：`state.queue` 是 `4731e13` 为兼容 DSH 而加的（非 Cuckoo 原生需求），存在 3 个已知缺陷 + 压缩冲突（详见 9.8），等真正做队列时一并解决
- **P2**：TS 转译（npm 插件多是 JS，价值低）、依赖解析（esbuild 已处理）
- **P3**：UI/命令/主题等 DSH 客户端能力
- **对照测试固化**：`scripts/compare-dsh.mjs`（方便回归）

> **2026-10-22 已解决**：
> - ~~C2 落盘~~（C5 已实现 JSONL 落盘）
> - ~~ctx.agents / ctx.fs / ctx.systemPrompt 仍 stub~~（C4-A/B/C 已接真）

## 相关

- 参考项目：`C:\d\SourceCode\2026\deepseek-harness2`
- 前置：PR #36（可执行插件运行时——但它是 bridge 层、简化版，与本需求的"主进程 + 全兼容"不同）
- **[DSH API 覆盖度清单](../dsh-api-coverage.md)**：当前 119 个 DSH Context 服务的实现状态（已实现 32 个，27%），适配新插件时先对照此清单
- **[DSH 兼容决策记录](../dsh-compat-decisions.md)**：9.1-9.9 各决策的背景与权衡

---
id: 022
type: feature
title: DSH 插件兼容（Cuckoo 里安装/运行 DSH 插件）
status: in_progress
branch: direct-on-master（直接 master 提交）
created: 2026-10-06
updated: 2026-10-08
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

- **简化实现**：`get(id) / current() / list() / roots()`——**会话 → agent 视图**（`{ id, session: { id, projectDir } }`）
- **对比 DSH**：DSH 是"活 agent 注册表 + handle/dispose"；Cuckoo 无 agent registry，用会话映射

> **C4 完整**（systemPrompt + fs + agents 全接真）。

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

## 验证

### 单测（865 tests 全过）

- `test/plugins/dsh-compat.test.js`（9）：`defineTool` 转换 + 递归 schema
- `test/plugins/cuckoo-plugin-load.test.js`（2）：加载 → 注册 → 执行
- `test/plugins/plugin-tool-inject.test.js`（4）：动态注入沙箱 + AI 调用 + jsApi 展开
- `test/plugins/c1-host-services.test.js`（4）：settings/tools/sessions 接入
- `test/plugins/c2-session-events.test.js`（1）：append 真写 + 投影真读回

### 真机验证

- **2026-10-06**：`greet-tool` → AI 调 `await greet("Cuckoo")` → `"你好，Cuckoo！(来自 DSH 插件)"` ✅
- **2026-10-08**：**官方包** `@deepseek-ai/dsh-tool-todo` → AI 调 `todo_write([...])` → `"Updated todo list: ..."` ✅

### 对照测试（Cuckoo vs 真 DSH）

- 同一插件 `@deepseek-ai/dsh-tool-todo`，**DSH 侧**（`new Context()` + 挂 ToolRuntime/SessionProjectionRegistry/插件）与 **Cuckoo 侧** 跑
- **Schema 一致**（todos 数组 + {content,status} + enum + required）
- **执行结果一致**（"Updated todo list: 1 pending, 0 in progress, 0 completed."）
- ✅ **Cuckoo 与真 DSH 表现一致**（"鸿蒙兼容 Android"验证）

## 未完成

- **C2 落盘**：内存流水**不持久**（重启丢）；DSH 是落盘的——后续可做
- **更多服务映射**：`ctx.agents`（子代理）/ `ctx.fs` / `ctx.systemPrompt` 等仍 stub
- **P2**：TS 转译（npm 插件多是 JS，价值低）、依赖解析（esbuild 已处理）
- **P3**：UI/命令/主题等 DSH 客户端能力
- **对照测试固化**：`scripts/compare-dsh.mjs`（方便回归）

## 相关

- 参考项目：`C:\d\SourceCode\2026\deepseek-harness2`
- 前置：PR #36（可执行插件运行时——但它是 bridge 层、简化版，与本需求的"主进程 + 全兼容"不同）

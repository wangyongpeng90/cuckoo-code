---
id: 022
type: feature
title: DSH 插件兼容（Cuckoo 里安装/运行 DSH 插件）
status: in_progress
branch: feat/022-dsh-plugin-compat
created: 2026-10-06
updated: 2026-10-06
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

## 验证

### 单测（858 tests 全过）

- `test/plugins/dsh-compat.test.js`（8）：`defineTool` 转换
- `test/plugins/cuckoo-plugin-load.test.js`（2）：加载 → 注册 → 执行
- `test/plugins/plugin-tool-inject.test.js`（3）：动态注入沙箱 + AI 调用

### 真机验证（2026-10-06）

- 手动放 `greet-tool` 到 `~/.cuckoo/cuckoo-plugins/greet-tool/`
- 重启 Cuckoo → AI **成功调用** `await greet("Cuckoo")` → `"你好，Cuckoo！(来自 DSH 插件)"` ✅

## 未完成

- **P1-c**：插件管理 UI 页面（当前只能手动放目录 / 代码调用）
- **P2**：模块解析（多文件依赖）、TS 转译、更多 DSH 服务映射
- **P3**：UI/命令/主题等 DSH 客户端能力

## 相关

- 参考项目：`C:\d\SourceCode\2026\deepseek-harness2`
- 前置：PR #36（可执行插件运行时——但它是 bridge 层、简化版，与本需求的"主进程 + 全兼容"不同）

---
id: 014
type: feat
title: 地址栏下方显示当前对话 token 量
status: done
branch: feat/014-shell-token-bar
created: 2026-09-25
updated: 2026-09-26
---

## 背景

当前对话的累计 token 量只在 overlay 面板里显示。用户希望在**地址栏下方**（壳页面）
加一条状态条，随时可见（后续还要在此条上扩展其它信息）。

## 目标

- 在地址栏与 AI 页面之间，加一条**独立状态条**
- 显示当前对话的**累计 token 量**（accumulatedTokens，与 overlay 面板同一个数）
- 可扩展（后续会加更多内容）

## 方案

### 数据流

AI 页面（overlay/events.ts 收到 token）→ IPC → 主进程 → 壳页面显示

### 1. AI 页面侧

- `src/bridge/api.ts`：加 `updateTokenUsage(accumulatedTokens)`
- `src/overlay/events.ts`：`startTokenCounter` 收到 token 时调 `updateTokenUsage`

### 2. 主进程侧

- `src/app/ipc/shell.ts`：新增 `update-token-usage` handler
  - 找到窗口壳页面，`send('shell-token-updated', { tokens })`

### 3. 壳页面侧

- `src/app/shell-preload.ts`：加 `onTokenUpdated` 订阅
- `src/ui/shell.html`：加状态条 div + CSS + JS 显示

### 4. 布局

- `src/app/entry.ts`：`TOOLBAR_HEIGHT` 从 44 调整为 44 + 状态条高度

## 验收标准

- [x] 壳页面显示累计 token
- [x] AI 页面 token 更新时，状态条实时刷新
- [x] 格式化（过万显示「x.xx 万」）
- [x] AI 页面区域高度正确（不被状态条遮挡）
- [x] typecheck / test / lint / compile
- [x] 真机验证（后续扩展为多值：对话上下文/对话累计/窗口/今日窗口/系统）

## 遗留

- 真机验证
- 后续在状态条上扩展其它信息

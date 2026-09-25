---
id: 007
type: feature
title: 工具执行遮罩加「停止」按钮（取消回传）
status: done
branch: feat/007-tool-mask-cancel
created: 2026-09-23
updated: 2026-09-25
---

## 背景

需求 003 的工具执行遮罩，在工具执行完、等待把结果发回 AI 的这段窗口内，
用户**无法中断**——只能等它自动发送。但有时用户想中止（如发现 AI 要执行的操作不对）。

## 目标

在执行完成、等待发送的窗口期，遮罩上显示「停止」按钮：

- 点击 → **取消本次回传**（不再自动发送执行结果）
- 遮罩消失
- 输入框内容**保留**（用户可自行决定发送或删除）

## 方案

### 1. HTML（`overlay.html`）

遮罩 box 里加一个按钮 `#cuckoo-tool-mask-cancel`（文案「停止」）。

### 2. CSS（`overlay.css`）

按钮样式（次要按钮风格，与现有 `cuckoo-btn` 一致）。

### 3. panel.ts

`showToolMask(onCancel?)` 接收可选取消回调，绑定到按钮；`hideToolMask()` 解绑。

### 4. chat-input.ts

- 模块级 `pendingSend`（记录待发送的 timer + input）
- `sendToChat` 里注册，发送时清空
- 新增导出 `cancelPendingSend()`：清 timer + 清空输入框

### 5. observer.ts

工具分支：
- `showToolMask(cancelHandler)`
- 执行完成后若已取消 → 直接返回
- 取消时调 `cancelPendingSend()` + `hideToolMask()`

## 验收标准

- [x] 遮罩上有「停止」按钮（等待发送阶段显示）
- [x] 点击停止 → 不发送、遮罩消失（**输入框内容保留**）
- [x] 不点 → 正常自动发送（行为不变）
- [x] 执行中不显示停止按钮（无法中断运行中的工具）
- [x] 遮罩不再使用 loading 光标（`cursor: wait` → `default`）
- [x] typecheck / test / lint / compile
- [x] 真机验证

## 遗留 / 后续

- 无法中断"正在执行中"的工具（只能阻止后续发送）
- 真机验证

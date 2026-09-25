---
id: 004
type: fix
title: 看门狗改为 SSE 流静默检测
status: done
branch: fix/004-watchdog-criteria
created: 2026-09-21
updated: 2026-09-25
---

## 背景

原看门狗（watchdog.ts）在"工具循环中"判断：检测到工具调用 → 进入循环 → 发消息后计时 →
超时（默认 300s）发「请继续」催 AI。存在两个问题：

1. **判定脆弱**：依赖上层"是否检测到工具调用"的猜测（`onToolCallDetected` / `exitToolLoop`）。
   一旦检测漏了（如工具调用识别不全），看门狗就不生效，任务可能无声中断。
2. **不反映底层状态**：固定超时，不关心"SSE 流是否还在流动"。而钩子层能直接看到流——流静默才是"卡住"的直接证据。

## 目标

改为**直接监控 SSE 流活跃度**：

- 流持续有新数据（含心跳）→ 视为正常工作，不打扰
- 流静默超过阈值 → 发提示词催继续，按次数上限停止
- 复用原看门狗的全部配置项（超时 / 提示词 / 次数），UI 不变

## 方案

### 一、hook 侧（`src/providers/hooks/deepseek.ts`）—— 流活跃度自检

在 `observeBody` 内：

1. 维护 `lastActiveAt`（初值 = 流开始时刻）
2. `feed()` 收到**任意 chunk**（含心跳）即更新 `lastActiveAt`
3. 起定时器（每 5 秒检查一次）：
   - 读 `cuckoo-xhr-idle-timeout`（毫秒，<=0 禁用）
   - 若 `now - lastActiveAt > timeout` 且流未结束 → `dispatch 'cuckoo-stream-idle'`（含 sessionId），并重置 `lastActiveAt`
4. 流结束（`r.done`）/ 出错 → 清理定时器

**为什么在 hook 里做**：只有 hook 能感知每块数据；且**上报频率极低**（只在静默时发一次事件），避免跨世界通信开销。

### 二、隔离世界（`src/bridge/loop/watchdog.ts`）—— 订阅流静默

- 新增 `window.addEventListener('cuckoo-stream-idle', ...)`
- 收到事件：
  1. `suspended` 时忽略（压缩等流程）
  2. 会话校验：事件 sessionId 与当前不一致 → 忽略
  3. 计数上限检查（`cuckoo-watchdog-count`，负数=无限）
  4. 发提示词（`cuckoo-watchdog-prompt`，默认"请继续"）
- **移除**：`inToolLoop` / `onToolCallDetected` / `onMessageSent` / `exitToolLoop` 等工具循环判断
- **保留**：`setSuspended` / `reset` / `startSessionWatcher` / 收到终态重置计数

### 三、调用点清理

- `observer.ts`：去掉 `onToolCallDetected` / `exitToolLoop` 调用；`onResponseReceived` 简化为"收到终态重置计数"
- `entry.ts`：去掉 `onMessageSent` 传入
- `chat-input.ts`：`onMessageSent` 钩子不再需要（若无人使用则移除）

## 验收标准

单元测试（`test/bridge/loop/watchdog.test.js`，17 例）已覆盖：

- [x] 收到静默事件 → 计数 +1，发提示词催继续
- [x] 收到正常终态（finished）→ 重置计数
- [x] 会话不匹配 → 忽略
- [x] 压缩进行中（suspended）→ 忽略
- [x] 次数达上限 → 停止
- [x] 次数负数 → 无限
- [x] 会话切换轮询 → 重置
- [x] typecheck / test / lint / compile 全绿

真机验证：

- [x] 正常使用不误触发（长时间使用，未出现异常催继续）
- [x] **已验证：流静默触发催继续链路**

  方式：AI 页面 DevTools Console 执行
  `window.dispatchEvent(new CustomEvent('cuckoo-stream-idle', { detail: {} }))`
  → 立即弹出提示 + 输入框填入"请继续"并自动发送。链路打通。（"事件 → 催继续"验证通过；次数上限逻辑由 17 个单测覆盖）

  可行的补验方式：
  1. **手动派发事件**（验证"事件 → 催继续"链路）——AI 页面 DevTools Console 执行：
     `window.dispatchEvent(new CustomEvent('cuckoo-stream-idle', { detail: {} }))`
     预期：弹出「等待 AI 回复超时，发送『请继续』催继续」
  2. **调小阈值 + 长期观察**——设置里超时改为 10~30 秒，日常使用中留意真卡住时是否触发
  3. ⚠️ **断网不可用于验证**——断网走的是 `stream-error` 分支，不是"静默"

## 遗留 / 后续

- claude / chatgpt 未同步（本次只改 deepseek）
- 心跳也算活跃：若服务端持续发心跳，静默检测不触发（已知取舍——用户认为心跳=仍在工作）
- 阈值（300s）与检查间隔（5s）为初值，真机验证后再定

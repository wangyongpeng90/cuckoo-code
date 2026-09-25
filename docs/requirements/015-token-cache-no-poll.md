---
id: 015
type: feat
title: token 按会话缓存 + 去掉高频轮询（改主进程推送）
status: done
branch: feat/015-token-cache-no-poll
created: 2026-09-26
updated: 2026-09-26
---

## 背景

两个问题：
1. 对话 token 只在收到回复时更新，**切会话后显示的是上个会话的值**（或空）
2. 有 3 个常驻高频轮询（1.5s / 3s / 1.5s），都在检测 URL/sessionId 变化——CPU 开销 + 响应延迟

## 目标

- **token 按 sessionId 缓存**（localStorage），切会话时显示对应会话的值
- **去掉 3 个常驻轮询**，改为主进程 `did-navigate-in-page` 事件主动推送
- 保留一个**低频兜底轮询**（15 秒），防事件漏触发

## 方案

### 1. 主进程推送 URL 变化

`src/app/entry.ts` 的 `did-navigate` / `did-navigate-in-page` 里，
`view.webContents.send('cuckoo-url-changed', { url })`。

### 2. 渲染进程统一监听

`src/bridge/entry.ts` 里监听 `cuckoo-url-changed`，分发给：
- `ui.updateHomeMode()`（首页模式）
- 看门狗 `reset()`（会话切换重置计数）
- 更新窗口名（原 3s 轮询的逻辑）
- 刷新 token 显示（新逻辑）

### 3. token 按会话缓存

- overlay 维护 `tokenCache`（localStorage，key=sessionId）
- 收到 token 事件：按**当前 sessionId** 写入缓存 + 刷新显示
- 切会话（`cuckoo-url-changed`）：从缓存读该会话的值显示

### 4. 去掉 3 个轮询

- `bridge/entry.ts:76`（1.5s URL 变化）→ 删
- `bridge/entry.ts:111`（3s sessionId→窗口名）→ 删（改事件驱动）
- `bridge/loop/watchdog.ts:103`（1.5s 会话切换）→ 删（改事件驱动）
- **保留**一个 15 秒低频兜底轮询

## 验收标准

- [x] token 按 sessionId 缓存（localStorage），切会话显示对应值
- [x] 主进程推送 `cuckoo-url-changed`
- [x] 渲染进程监听并分发（首页模式/看门狗重置/窗口名/token）
- [x] 去掉 3 个高频轮询，保留 15 秒兜底
- [x] typecheck / test / lint / compile
- [x] 真机验证（token 缓存 ✓、事件驱动即时响应 ✓）

## 遗留

- 真机验证

---
id: 028
type: feature
title: ChatGPT 上下文主动压缩（摘要 + 新会话续接）
status: review
branch: feat/028-chatgpt-context-compact
created: 2026-10-15
updated: 2026-10-15
---

## 背景

ChatGPT 网页版单会话上下文有上限。Cuckoo 已有「上下文耗尽自动续接」链路
（hook 检测 continue_in_new_chat → cuckoo-context-exhausted → IPC
context-exhausted-continue → 导航首页 + initProject 保留 projectDir），但：

1. 该链路是**被动触发**（等耗尽才动）。
2. **主动压缩**（compaction.ts）是 **DeepSeek 专属**：依赖 DeepSeek IndexedDB +
   /api/v0/share/create；ChatGPT 无对应能力 → ChatGPT 无法主动压缩、无法跨会话续接长任务。

用户诉求：彻底解决 GPT 报错 + 上下文太短 —— 让 ChatGPT 也能长任务不中断。

## 目标

- ChatGPT 支持「主动压缩」按钮：生成对话摘要 → 新会话携带摘要 + 项目上下文续接
- 复用现有续接链路，不新造轮子

## 方案

`src/session/compaction.ts`：新增 `runChatGptCompaction(projectDir)`，
在 `runCompaction` 入口按 provider 分派（ChatGPT → 新路径）。

**与 DeepSeek 压缩的差异**：ChatGPT 无 IndexedDB 分享机制，故**不走**
「清 IDB → 刷新 → share/create」，而是：

1. 发 `SUMMARY_INSTRUCTION` 让 AI 生成摘要，等回复
2. 组装交接文本（摘要 + 「请据此继续，缺细节用工具读文件补全」）
3. 调 `electronAPI.contextExhaustedContinue({ pendingText: handoff })`
   —— 复用 024 已实现的续接 IPC：导航首页 + `initProject(projectDir, extraPrompt)`

**复用**：`SUMMARY_INSTRUCTION` / `waitForResponse` / `sendToChat` / 续接 IPC 均为现有能力，
零新增依赖。DeepSeek 路径完全不变。

## 验收标准

- [x] ChatGPT 点「压缩」→ 生成摘要 → 新会话带摘要 + 项目目录（代码完成）
- [x] DeepSeek 压缩路径不受影响（分派前判断 provider.id）
- [x] typecheck / lint / test / compile 全绿
- [ ] 真机 npm start 验证（ChatGPT 长会话点压缩，观察新会话是否带摘要）

## 遗留 / 后续

- ChatGPT 的 `context-exhausted` 被动检测（banner_info）真机触发仍未验证（023 遗留项），
  本次主动压缩不依赖它，是独立可用的路径。
- 摘要质量取决于模型；后续可考虑「结构化摘要模板」提升保真度。

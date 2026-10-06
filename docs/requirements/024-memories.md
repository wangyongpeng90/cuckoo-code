---
id: 024
type: feature
title: 用户记忆系统
status: draft
branch: feat/024-memories
created: 2026-10-06
updated: 2026-10-06
---

## 背景

好的 Agent 应该"记得住用户习惯"。当前项目缺记忆能力：用户偏好（如"用中文回复"、
"提交信息格式"）每轮都要重说，跨会话丢失。

## 目标

- 用户级存储 `~/.cuckoo/memories.json`（跨项目，可用 `CUCKOO_HOME` 覆盖）
- 系统提示词注入「## 用户记忆」章节，让模型了解用户习惯
- 工具 `remember(text)` / `forgetMemory(id)`：模型主动记忆/遗忘
- **正文标记** `[记忆]内容`：AI 直接在回复里写，软件自动捕获创建
- 侧边栏「记忆」tab：列出 / 新建 / 编辑 / 删除

## 方案

- `src/infra/memories.ts`：存储层（放 infra，纯文件 IO，避免 session→app 违规）
- `src/tools/impl/remember.ts`：remember / forgetMemory 工具
- `src/session/prompt-builder.ts` + `src/prompt/*.md`：注入 `{{MEMORY_SECTION}}`
- `src/bridge/intercept/observer.ts`：解析正文 `[记忆]xxx` 标记
- `src/app/ipc/memory.ts` + shell-preload + 页面

## 验收标准

- [x] 记忆 CRUD 正常，提示词注入生效
- [x] 正文标记自动创建记忆
- [x] 侧边栏「记忆」tab 可交互
- [x] 工具契约（api.d.ts）自动生成
- [x] typecheck / test / lint 全绿

## 遗留 / 后续

- 记忆暂不分项目/用户作用域（统一用户级）

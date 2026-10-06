---
id: 025
type: feature
title: 工作快照
status: draft
branch: feat/025-snapshots
created: 2026-10-06
updated: 2026-10-06
---

## 背景

好的 Agent 应该"改坏能收回"。当前项目缺快照能力：模型大范围改动前无法存档，
改坏只能靠 git 兜底（未提交的改动会丢）。

## 目标

- 用户级存储 `~/.cuckoo/snapshots/<id>/`（`meta.json` + `files/` 副本）
- 工具 `createSnapshot(name, description?)` / `listSnapshots()` / `restoreSnapshot(id)`
- **正文标记** `[快照]名称`：AI 直接在回复里写，软件自动捕获创建
- 快照当前项目目录（排除 `.git`/`node_modules`/`dist`/`out` 等产物）
- 侧边栏「快照」tab：列出 / 创建 / 恢复 / 删除

## 方案

- `src/app/snapshots.ts`：快照目录管理 + 文件复制/恢复（放 app，需项目目录上下文）
- `src/tools/impl/snapshot.ts`：createSnapshot / listSnapshots / restoreSnapshot 工具
- `src/bridge/intercept/observer.ts`：解析正文 `[快照]xxx` 标记
- `src/app/ipc/snapshot.ts` + shell-preload + 页面

## 验收标准

- [x] 快照创建/列出/恢复/删除正常
- [x] 正文标记自动创建快照
- [x] 侧边栏「快照」tab 可交互
- [x] 工具契约（api.d.ts）自动生成
- [x] typecheck / test / lint 全绿

## 遗留 / 后续

- 快照暂不含 .git/node_modules（避免体积爆炸）
- 恢复为覆盖式（不删除快照没有的文件）

---
id: 016
type: feat
title: 子代理（Subagents，对齐 Claude Code）
status: doing
branch: feat/016-subagents
created: 2026-09-26
updated: 2026-09-26
---

## 背景

对齐 Claude Code 的子代理机制：主对话把任务委派给**独立上下文的 AI 对话**，
子代理干完只回摘要。双重收益：
1. 上下文隔离（大任务不撑爆主对话）
2. 缓解卡顿（主对话上下文越长，DeepSeek 页面越卡——见 backlog「长对话卡顿」）

## 关键模型（用户确认）

**窗口 = 标签页，partition = 用户**。主 agent 和 subagent 是**同一用户的两个标签页**：
- 共享 partition（免登录）
- 共享 localStorage → subagent 的 token 消耗**自动计入主窗口**的「窗口累计/今日窗口累计」（正是需求）
- 不改 localStorage 命名空间（用户明确：零改造）

## 方案（对齐 Claude Code）

### 1. 代理定义（文件驱动，仿 Skill）

```
.cuckoo/agents/<name>.md        # 项目级
~/.cuckoo/agents/<name>.md      # 用户级
```

```markdown
---
name: code-reviewer
description: 审查代码质量。写完代码后使用。
tools: read, grep, glob
---
你是代码审查专家……（系统提示正文）
```

### 2. 新工具 `runAgent`

AI 在主对话里调用：
```js
await runAgent("code-reviewer", "审查 src/session/compaction.ts")
```

### 3. 执行流程（同步）

```
主对话 AI 调 runAgent
   → IPC 到主进程
   ① 创建子代理窗口（复用主窗口 profile 的 partition → 免登录）
   ② 导航到新对话
   ③ 注入代理系统提示 + 任务
   ④ 等子代理跑完（无工具调用 = 完成；超时兜底）
   ⑤ 抓取最终文本
   → 回传主对话
```

### 4. 完成判定

- **无工具调用**（普通文本回复）= 完成（对齐 Claude Code）
- **超时兜底**（防卡死）

### 5. 工具限制

子代理窗口的 bridge 按代理定义的 `tools` 字段过滤可用工具；
**不注册 `runAgent`**（防递归）。

## 分阶段

- [ ] P2：代理定义扫描（`src/agents/`，仿 `src/skills/`）
- [ ] P3：子代理窗口创建（复用 partition）
- [ ] P4：`runAgent` 工具 + 完成判定 + 回传
- [ ] P5：工具限制 + UI 显示（overlay 显示「委派中：xxx」）

## 验收标准

- [ ] 能扫描项目级/用户级代理
- [ ] `runAgent` 能开子代理窗口、跑完、回传摘要
- [ ] 子代理免登录（共享 partition）
- [ ] 子代理 token 计入主窗口累计
- [ ] 子代理不能调 `runAgent`（防递归）
- [ ] typecheck / test / lint / compile
- [ ] 真机验证

## 遗留

- 异步/后台子代理（Claude Code 的 run_in_background）
- 并行多个子代理
- 持久记忆（memory）

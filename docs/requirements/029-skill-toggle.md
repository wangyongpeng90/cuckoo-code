---
id: 029
type: feature
title: 技能开关（决定是否加入上下文）
status: review
branch: feat/029-skill-toggle
created: 2026-10-21
updated: 2026-10-21
---

# 技能开关（决定是否加入上下文）

## 背景

侧边栏「技能」页目前只做展示与"请使用 xxx 技能"的快捷追加。技能一旦被扫描到，就会
全量拼进系统提示词的 `## 可用技能` 章节。技能多了以后：

- 提示词变长（网页版输入框有上限，超长会被静默截断，见 backlog 第 7 条）
- 无关技能占位，干扰 AI 选择

需要一个**按技能粒度的开关**，决定它是否进入上下文。

## 目标

- 技能页每个技能一个开关，关闭后**不加入系统提示词**（不注入 `## 可用技能`）。
- 开关状态**持久化**，且**不修改 SKILL.md**（不污染技能定义）。
- 默认开启（存量行为不变）。
- 同一份开关在以下注入点都生效：
  - 初始化项目时组装系统提示词（`prompt-builder`）
  - 覆盖层「发送 skill 信息」（`refresh-skills`）
  - Harness 模式的可用技能清单（`harness-list-tools`）
- 技能页仍**列出全部技能**（含已关闭的），并显示其开关状态。
- 已关闭的技能，**点击卡片不做任何事**（不填入「请使用 xxx 技能」提示词）。

## 方案

### 1. 状态存储（`src/skills/state.ts`）

与 MCP 一致：状态与定义分离，只记录**被显式关闭**的技能名（默认开启）。

- 项目级技能：`<projectDir>/.cuckoo/skills-state.json`
- 用户级 / 插件级技能：`~/.cuckoo/skills-state.json`（可用 `CUCKOO_HOME` 覆盖，供测试隔离）

格式：

```json
{ "disabled": ["skill-a", "skill-b"] }
```

读取时"任一状态文件里被关闭即视为关闭"，避免依赖调用方传 source；写入时按技能 source
决定落到哪个文件（project → 项目级，其余 → 用户级）。

对外 API：

- `isSkillEnabled(name, source, projectDir)`
- `setSkillEnabled(name, source, projectDir, enabled)`
- `filterEnabledSkills(skills, projectDir)`

模块只依赖 node 内置，不引入上层依赖（符合 infra/skills 分层规则）。

### 2. 注入点过滤

- `src/session/prompt-builder.ts`：`buildSkillsSection(filterEnabledSkills(scanSkills(...), selectedDir))`
- `src/app/ipc/project.ts` 的 `refresh-skills`：同上过滤
- `src/app/ipc/harness.ts` 的 `harness-list-tools`：过滤
- `list-skills`：**不过滤**，但每条附带 `enabled`

### 3. IPC / API / UI

- 新增 IPC `set-skill-enabled`（project.ts）
- `shell-preload.ts` 暴露 `setSkillEnabled`
- `shell-api.ts` 加类型
- `src/ui/shell/scripts/pages/skills.ts`：卡片加 `ck-switch` 开关，阻止冒泡；
  关闭时卡片置灰（`ck-skill-off`）
- `src/ui/shell/styles/components.css`：加置灰样式

### 4. 文档

`docs/skills.md` 补充「开关」小节。

## 验收标准

- [x] 关闭某技能后，重新初始化项目，其不出现在 `## 可用技能` 章节
- [x] 覆盖层「发送 skill 信息」不再包含已关闭技能
- [x] 技能页正确展示开关状态，切换后持久化（重启仍生效）
- [x] 默认全部开启，存量行为不变
- [x] 项目级技能开关写项目级状态文件；用户级写用户级
- [x] `typecheck` / `test` / `lint` / `compile` 全绿
- [x] 关闭技能后，点击该技能卡片**不填入任何提示词**（不触发「请使用 xxx 技能」）
- [x] 真机验证（技能页开关可用）—— 已验证

## 遗留

- 插件整体开关（`pluginSetEnabled`）与单技能开关相互独立；插件关闭时其技能本就不扫描。
- 未做"批量开关 / 全选"，按需再议。

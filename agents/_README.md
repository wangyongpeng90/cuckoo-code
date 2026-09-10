# agents/ 目录说明（本文件不会被加载为 Agent）

本目录存放内置子 Agent 模板，随应用打包。主 Agent 可以通过
`subagent({ agentType, task })` 委派任务，`agentType` 就是文件名去掉 `.md`。

## 编写规则

1. 每个 `.md` 文件是一个子 Agent，文件名即 agentType（如 `code-reviewer.md` → `code-reviewer`）
2. 第一个非空行（一级标题）是简介，会展示在「多 Agent」机制说明中
3. 正文是该子 Agent 的角色提示词：身份、工作范围、输出规范
4. 以 `_` 开头的文件（如本文件）和 `README.md` 不会被加载
5. 用户在 userData/agents/ 下放置的同名模板会覆盖内置模板

## 运行机制（无需写进模板）

框架会自动为子 Agent 包裹运行规则：只能用 `cuckoo` 代码块执行工具、
用 `subagent_result` 代码块交付结果、自主完成不向用户提问。模板内只需
描述角色本身，不要重复这些规则。

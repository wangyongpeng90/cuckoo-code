# Skills（技能）配置与使用

> Skill 让 AI 掌握特定领域的流程 / 规范 / 脚本。对齐 Claude Code 的 Agent Skills 机制。

## 一、它是什么

技能是一个带 frontmatter 的 `SKILL.md` 文件，放在约定目录下。应用启动（初始化项目）时**自动扫描**，把技能的 **name + description + 路径**注入系统提示词（**渐进式披露**——不塞全文，省 token）。

AI 判断任务与某技能相关时，会**用 `read` 读取该 SKILL.md 全文**，再按其中指令执行。技能若有附带脚本，AI 会用 `bash`/`pwsh` 运行（路径以技能目录为准）。

## 二、目录约定

| 作用域 | 路径 | 说明 |
|---|---|---|
| **项目级** | `<项目根>/.cuckoo/skills/<name>/SKILL.md` | 随仓库走，团队共享 |
| **用户级** | `~/.cuckoo/skills/<name>/SKILL.md` | 所有项目通用 |

- 只扫描 skills 目录的**直接子目录**（一层），不递归
- 每个子目录必须有 `SKILL.md`
- **同名时项目级优先**（覆盖用户级）

## 三、SKILL.md 格式

```markdown
---
name: my-skill
description: 一句话说明这个技能做什么。当用户需要 xxx 时使用。
when_to_use: 用户想 xxx 时
allowed-tools: read, edit, bash
---

# 技能正文

这里写具体流程、规范、示例。AI 会读取全文后按此执行。

## 步骤
1. ...
2. ...

## 附带脚本
运行：`bash("node .cuckoo/skills/my-skill/run.js")`
```

### frontmatter 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 否 | 技能名。缺省取**目录名** |
| `description` | 否 | 简述。缺省取正文**首段**。**留空则技能被跳过** |
| `when_to_use` | 否 | 建议使用场景，与 description 合并展示 |
| `allowed-tools` | 否 | 声明可用工具（逗号分隔）。**仅声明，不强制** |

> description + when_to_use 合计截断 **1536 字符**（对齐 Claude Code）。

## 四、如何生效

1. **初始化项目时自动扫描**——把技能清单注入系统提示词
2. **改完技能后**：点覆盖层面板的「**发送 skill 信息**」按钮，重新扫描并把最新清单发给 AI

## 五、完整示例

`.cuckoo/skills/commit-helper/SKILL.md`：

```markdown
---
name: commit-helper
description: 按规范生成 git commit message。当用户要提交代码时使用。
when_to_use: 用户说"提交"或"commit"时
allowed-tools: bash, read, grep
---

# Git 提交助手

## 流程
1. 用 `bash("git status")` 和 `bash("git diff")` 查看改动
2. 按 **type(scope): 简述** 格式生成 message
3. type 用：feat / fix / refactor / chore / docs
4. 执行 `bash("git add -A && git commit -m '...'")`

## 规范
- 简述不超过 50 字
- 中文描述
```

## 六、现成技能合集

[`skills/`](../skills/) 目录收录了可直接复制安装的社区技能（GitHub 一键提交流程等），复制到 `~/.cuckoo/skills/` 即用，欢迎 PR 贡献新技能。

## 七、与 Agents 的区别

| | Skill | Agent |
|---|---|---|
| **本质** | 当前上下文里的**流程 / 知识** | **独立上下文**的子对话 |
| **调用方式** | AI 自己 `read` SKILL.md | `runAgent(name, task)` 委派 |
| **上下文** | 复用主对话 | 全新独立 |
| **适用** | 规范、流程、脚本 | 大范围搜索、独立子任务 |

---
id: 012
type: feat
title: Skill 支持（对齐 Claude Code，纯文件驱动）
status: review
branch: feat/012-skills
created: 2026-09-25
updated: 2026-09-25
---

## 背景

参考 Claude Code 的 Agent Skills 机制，给 Cuckoo Code 加技能支持。
用户把技能写成 `SKILL.md`（带 frontmatter）放到约定目录，AI 按需加载执行。
**纯文件驱动，无复杂界面**（仅一个"发送skill信息"按钮用于刷新）。

## 目标

- 扫描技能目录，把 `name + description` 注入系统提示词（渐进式披露）
- AI 判断相关时用 `read` 读 `SKILL.md` 全文再执行
- 技能可带脚本（`scripts/`），AI 用现有 `bash`/`pwsh` 运行
- 格式对齐 Claude Code，能直接读其生态的技能

## 设计决策（逐条确认）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 作用域 | 项目级 + 用户级 |
| 2 | 用户级路径 | `~/.cuckoo/skills/`（os.homedir()） |
| 3 | 项目级路径 | `.cuckoo/skills/`（`.cuckooCode/` 改名 + 兼容读旧） |
| 4 | frontmatter | 对齐 Claude Code（name/description/allowed-tools/when_to_use…） |
| 5 | allowed-tools | 解析但仅作声明，不强制（无权限系统，格式兼容） |
| 6 | 注入方式 | 新增 `{{SKILLS_SECTION}}` 占位符（4 个 provider 模板各加一处） |
| 7 | 展示字段 | description + when_to_use，合计截断 1536 字符 |
| 8 | 扫描范围 | 只扫项目根 `<projectDir>/.cuckoo/skills/*/SKILL.md`（一层） |
| 9 | 同名优先级 | 项目级 > 用户级 |
| 10 | 容错 | 宽容（name 缺省=目录名，description 缺省=正文首段，YAML 失败才跳过） |
| 11 | AI 加载 | 纯提示词 + read（清单给 SKILL.md 完整路径）；不加 skill() 工具 |
| 12 | 截断应对 | SKILL.md 保持精简；提示词引导被截断时用 read 的 offset 续读 |
| 13 | 脚本语言 | 不限（取决于用户环境）；依赖缺失不特殊处理 |
| 14 | 清单格式 | 列表式（`- name：description\n  路径：...`） |
| 15 | 刷新 | 初始化时扫描；新增技能后点"发送skill信息"按钮重发清单 |
| 16 | 热加载 | **不做**（系统提示词初始化时发一次，中途变化靠按钮刷新） |

## 方案

### 1. 新建 `src/skills/`

- `types.ts`：`SkillMeta` 接口
- `frontmatter.ts`：极简 YAML frontmatter 解析（零依赖，只解析顶层 key: value）
- `scanner.ts`：扫描项目级 + 用户级目录，合并（项目级优先），返回 `SkillMeta[]`
- `prompt.ts`：`buildSkillsSection()` → `{{SKILLS_SECTION}}` 文本

### 2. 目录改名 `.cuckooCode` → `.cuckoo`（含 CUCKOO.md）

- `prompt-builder.ts` 的 `readProjectIntro`：先找 `.cuckoo/CUCKOO.md`，找不到再找 `.cuckooCode/CUCKOO.md`
- `window-manager.ts` 提示词文案更新

### 3. 注入提示词

- `prompt-builder.ts`：`buildPrompt` 里调 `buildSkillsSection()`，填 `{{SKILLS_SECTION}}`
- 4 个模板（`src/prompt/*.md`）各加一处 `{{SKILLS_SECTION}}`

### 4. 刷新按钮

- `overlay.html`：设置面板加按钮 `#cuckoo-skills-refresh`（"发送skill信息"）
- 点击 → 主进程重新扫描 → 只发技能清单消息（不重发完整提示词）

## 验收标准

- [x] 扫描项目级 + 用户级技能，合并去重（项目级优先）
- [x] frontmatter 解析（含缺省容错）
- [x] 技能清单注入系统提示词
- [x] 目录改名 + 兼容读旧 `.cuckooCode`
- [x] 刷新按钮发送技能清单
- [x] typecheck / test / lint / compile
- [ ] 真机验证

## 遗留

- 真机验证
- 提示词长度控制（backlog 编号 7）

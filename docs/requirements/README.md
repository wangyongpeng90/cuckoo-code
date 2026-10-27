# docs/requirements —— 需求档案

> 每个需求一个文件，记录**背景 → 目标 → 方案 → 验收 → 遗留**，并与 git 分支关联。

## 规则

### 文件命名

**格式**：`docs/requirements/<id>-<slug>.md`

**id 规则**（2026-10-22 起）：

| 阶段 | id 格式 | 例 |
|---|---|---|
| 历史档案（001~028） | 三位序号 | `001`、`022` |
| **新档案（本次起）** | `YYMMDD-<6位base36随机>` | `261022-a3f9k2` |

**生成新 id**（建档案时执行，每次输出不同）：
```bash
node -e "const d=new Date(),p=n=>String(n).padStart(2,'0');console.log(String(d.getFullYear()).slice(2)+p(d.getMonth()+1)+p(d.getDate())+'-'+Math.random().toString(36).slice(2,8))"
```
输出示例：`261022-a3f9k2`

**为什么改规则**：旧的三位序号在**多分支并行开发**时会撞号（已发生：`023-chatgpt-input-send.md` 和 `023-shell-react.md`）。新 id 带日期+随机，**天然唯一**，合并时无需重编号 → 代码注释里的 `[id]` 永不需要改动。

**排序兼容性**：`build-docs-index.mjs` 按 frontmatter `id` 字符串排序。新 id 以 `26`、`27` 等数字开头，与旧 id（`0xx`）对比时 `'0' < '2'`，**旧档案自动排在新档案之前**，无需改脚本。

**老档案零改动**：`001`~`028` 保持原样，新档案与老档案在同一目录下共存。

### 文档结构（固定）
文件头部是 YAML frontmatter（结构化数据，供脚本与 AI 解析）：

```yaml
---
id: 001
type: feature          # feature | fix | refactor | chore | docs
title: 窗口地址栏
status: done           # draft | doing | review | done | dropped
branch: feat/address-bar
created: 2026-09-20
updated: 2026-09-21
---
```

正文固定五节：`背景` / `目标` / `方案` / `验收标准` / `遗留`。

### 分支关联
- 分支名**必须含需求 ID**：`<type>/<id>-<slug>`
  - 例：`feat/001-address-bar`、`fix/002-interrupt-retry`
- 需求文档的 `branch` 字段记录对应分支名

→ 从需求找分支、从分支反查需求。

### INDEX.md
`INDEX.md` 是**自动生成**的总览表，**不要手改**。

**自动更新**（两道保障）：
- **pre-commit 钩子**：提交时若 `docs/requirements/` 有改动，自动重生成并加入本次提交
- **CI 校验**：若 INDEX 与文档不一致，CI 会失败（见 `.github/workflows/quality.yml`）

手动执行（通常不需要）：
```bash
npm run docs:index
```

> 钩子随仓库分发，`npm install` 时经 `prepare` 脚本自动挂载（`git config core.hooksPath .githooks`）。
> 换机器后若钩子没生效，手动跑一次 `npm install` 或 `npm run prepare`。

## 何时建档案

**必须建**：新功能 / 新工具 / 新平台、行为变更、涉及多文件的改动、需要决策的改动。

**可跳过**：单文件单行修复、纯文案 / 注释 / 格式、纯依赖升级。

**拿不准就建。**（跳过时仍建议建分支，commit message 说清即可。）

---

## 状态流转

```
draft（刚建）→ doing（实现中）→ review（待验收）→ done（完成）
                                       ↘ dropped（放弃）
```

## 代码注释关联档案（2026-10-22 新增）

**目的**：让后来人（尤其是 AI 对话）读代码时，**能直接找到决策依据**——而不是只看到一行代码，不知道为什么这么写。

### 什么时候加注释

**只在"决策点"和"反直觉处"加**——一个不熟悉这块代码的人，看到这一行会不会问"为什么这么写？"——会问才加。

✅ **该加**：
- 新增的、承载业务决策的代码块（如「create 只落库不导航」）
- 修改现有逻辑的地方（如「原先无校验，现改为……」「原先顺序 A→B，现改为 B→A，因为……」）
- 反直觉的实现（如「这里故意不 await，因为……」）
- 绕过某个已知限制的 workaround

❌ **不该加**：
- 描述代码字面含义（`// 判断 projectDir 是否存在`）
- 显而易见的空值检查、类型转换
- 每行都加（会让代码淹没在注释里）

### 注释格式

固定前缀 + 档案号 + 一句话说清「做了什么 + 为什么」+ 档案路径：

```typescript
// [022] DSH 语义：create 只落库不导航。详见 docs/requirements/022-dsh-plugin-compat.md C4-D 9.1
async create(options: CreateAgentOptions): Promise<CuckooAgentHandle> { ... }
```

```typescript
// [022] 修改：原先无校验，现对齐 DSH prepare() 的 cwd 绝对路径检查。详见 ... C4-D 9.2
if (meta?.cwd !== undefined && !isAbsolute(meta.cwd)) throw new Error(...);
```

### 前缀约定

| 前缀 | 场景 |
|---|---|
| `[022]` | 新增代码 |
| `[022-mod]` | 修改现有代码（附带说明「原先是什么」） |
| `[022-fix]` | 纯 bug 修复 |

**好处**：`grep "\[022\]" src/` 能一秒钟找到某需求的所有代码落点。

### 档案侧的反向索引（配套）

档案里每个决策点**附带落地位置**，形成双向链接：

```markdown
| 9.1 `create` 只落库 | `src/plugins/dsh-compat/agents-service.ts:248` |
```

- **代码 → 档案**：注释里的路径
- **档案 → 代码**：表格里的行号

---

## 与其他文档的分工

| 文档 | 角色 |
|---|---|
| `docs/architecture.md` | 系统**怎么工作**（静态架构） |
| `docs/requirements/` | **每个需求**的过程档案（动态） |
| `Roadmap.md` | 未来**计划**（还没立项的） |
| `CHANGELOG.md` | **发布**记录（面向用户） |

## AI 工作流

新需求时，见提示词 `docs/prompts/new-requirement.md`。

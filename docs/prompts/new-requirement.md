# 任务提示词：处理一个新需求

> 用法：新开 AI 对话时，把本文件 + 你的需求描述一起发给 AI。

---

## 你的第一步：先了解项目

1. 读 `docs/architecture.md`（及 `docs/arch/` 分册）——了解系统怎么工作
2. 读 `docs/requirements/README.md`——了解需求档案规则
3. 读 `docs/requirements/INDEX.md`——了解已有需求

## 判断：这个需求要不要建档案？

**先判断需求大小**：

### 可跳过档案（但仍建议建分支）

- 单文件、单行级别的修复（改个错字、修正一个常量）
- 纯文案 / 注释 / 格式调整
- 纯依赖升级

跳过时：直接建分支 → 改 → 验证 → 提交（commit message 说清即可），**不建需求文档、不动 INDEX**。

### 必须建档案

- **新功能 / 新工具 / 新平台**
- **行为变更**（改了用户能感知的逻辑）
- **涉及多文件**的重构 / 修复
- **需要决策**（有多个方案要选、有取舍）

**拿不准就建**——档案的成本远低于事后追溯的成本。

---

## 你的第二步：建需求档案 + 建分支

> （仅"必须建档案"的需求走这里；可跳过的见上）

### 2.1 生成 ID

**2026-10-22 起，新档案的 id 用 `YYMMDD-<6位随机base36>`**，不再手动递增三位序号（避免多分支并行撞号）：

```bash
node -e "const d=new Date(),p=n=>String(n).padStart(2,'0');console.log(String(d.getFullYear()).slice(2)+p(d.getMonth()+1)+p(d.getDate())+'-'+Math.random().toString(36).slice(2,8))"
```
输出示例：`261022-a3f9k2`

**老档案（001~028）保持原 id 不变**，新老档案共存。

### 2.2 建分支
```bash
git checkout -b <type>/<id>-<slug>
```
- `<type>`：`feat` / `fix` / `refactor` / `chore` / `docs`
- 例：`feat/003-dark-mode`、`fix/004-login-timeout`

### 2.3 建需求文档
新建 `docs/requirements/<id>-<slug>.md`，套用固定结构（照 `001-address-bar.md`）：

```markdown
---
id: 003
type: feature
title: 你的需求标题
status: draft
branch: feat/003-dark-mode
created: <今天>
updated: <今天>
---

## 背景
（为什么做）

## 目标
（做成什么样算完成）

## 方案
（怎么做；开工前可先留空，实现中补）

## 验收标准
- [ ] ...

## 遗留 / 后续
（完成后补）
```

## 你的第三步：实现

- 严格遵守 `docs/arch/02-dependency.md` 的依赖方向
- 参考 `docs/arch/05-tasks.md` 的对应任务手册（加工具/加平台/改 UI/加 IPC/改提示词）
- 把需求文档的 `status` 从 `draft` 改为 `doing`

### 代码注释规范（详见 `docs/requirements/README.md` 的「代码注释关联档案」）

**只在"决策点"和"反直觉处"加注释，别每行都加**：

- **新增代码**：`// [022] <一句话说清做了什么 + 为什么>。详见 docs/requirements/022-dsh-plugin-compat.md C4-D 9.1`
- **修改现有代码**：`// [022-mod] 原先 xxx，改为 yyy。理由见 ... C4-D 9.2`
- **纯 bug 修复**：`// [022-fix] ...`

同时在需求档案里维护「落地位置」反向索引，形成双向链接。

## 你的第四步：验证（硬要求）

```bash
npm run typecheck   # 必须 0 错误
npm test            # 必须全绿
npm run lint        # 必须 0 problems
npm run compile     # 构建通过
```

**改了运行时行为（IPC / hook / 工具 / UI）→ 必须真机 `npm start` 验证。**

## 你的第五步：收尾

1. 补全需求文档：`方案`（关键决策）、`验收标准`（勾选）、`遗留 / 后续`
2. `status` 改为 `done`，`updated` 改为今天
3. 刷新索引：
   ```bash
   npm run docs:index
   ```
4. 提交（需求文档 + 代码 + INDEX 一起）：
   ```bash
   git add -A
   git commit -m "<type>(<id>): <简述>"
   ```

## 记住

- **一需求一分支一文档**——不要在一个分支里塞多个需求
- **需求文档是过程档案**：不只写"做了什么"，更写"**为什么这么做**、放弃了什么方案"
- 完成即更新文档和 INDEX，**别留到最后补**
- 有疑问先问，别猜

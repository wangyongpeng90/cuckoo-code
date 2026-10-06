---
id: 022
type: feature
title: 长期记忆系统（对齐 DeepSeek++）
status: draft
branch: feat/022-memory-system
created: 2026-10-05
updated: 2026-10-05
---

# 022 长期记忆系统

## 背景

Cuckoo Code 目前每次对话都是从零开始：AI 不知道用户的身份、偏好、历史决策，用户需要反复说明背景。参考 DeepSeek++（zhu1090093659/deepseek-pp）的"长期记忆系统"，让 AI 能跨对话记住关键信息，提升个性化与连续性。

DeepSeek++ 的机制（调研结论）：
- **数据结构**：`{ id, syncId, scope, type, name, content, description, tags[], pinned, createdAt, updatedAt, accessCount, lastAccessedAt }`
- **四种类型**：`user`（用户画像）/ `feedback`（行为反馈）/ `topic`（话题上下文）/ `reference`（参考资料）
- **自动提取**：系统提示词要求 AI 在"用户透露身份/偏好/纠正行为/重要决策/说'记住'"时调用 `memory_save` 工具
- **智能注入**：按打分排序选记忆，拼进 system prompt 的 `{memories}` 占位
- **打分公式**：`score = (pinned?1000:0) + keywordScore + decayScore + (1h内访问?5:0)`，其中 `keywordScore = tagHits*20 + nameHits*15 + contentHits*5`，`decayScore = min(accessCount,20) + max(0,10-daysSinceAccess*0.1)`
- **预算控制**：按 token 预算截断（约 2000 tokens，prompt 大时动态缩减）

## 目标

在 Cuckoo 上复刻完整的记忆系统：
1. **存储**：`<userData>/memories.json`（对齐 Cuckoo 现有 JSON 存储风格）
2. **自动提取**：新增 `memorySave` 工具 + 系统提示词指令，AI 自动保存关键信息
3. **智能注入**：`prompt-builder` 组装时按打分选记忆注入 `{{MEMORIES_SECTION}}`
4. **管理 UI**：壳页面新增「记忆」页——列表/筛选/编辑/置顶/删除/导入导出

## 方案

### 模块划分（遵守依赖铁律）

```
src/memory/              ← 底层共享模块（仅 node 内置，供 tools/session/app 使用）
├── types.ts             Memory 接口、MemoryType
├── store.ts             读写 <userData>/memories.json（list/get/save/update/delete/touch）
├── selector.ts          打分 + 预算截断选取
└── prompt.ts            格式化记忆块（注入用）

src/tools/impl/
└── memory-save.ts       memorySave 工具（D12：apiMetas + bootstrap + Tool 子类）

src/session/prompt-builder.ts   新增 {{MEMORIES_SECTION}} 占位

src/app/ipc/
└── memory.ts            记忆 IPC（list/save/delete/pin/import/export）

src/ui/shell/
├── partials/pages/memory.html   记忆页
└── scripts/pages/memory.ts
```

### 依赖方向

```
memory（底层，node 内置）
  ↑
tools/impl/memory-save  （依赖 memory）
session/prompt-builder  （依赖 memory）
app/ipc/memory          （依赖 memory）
ui/shell                （通过 IPC，不直接依赖 memory）
```

`memory/` 只依赖 node 内置（fs/path/os）与 `createRequire` 懒加载 electron，符合"底层共享模块"定位。

### 关键设计

- **存储**：`memories.json` = `{ version: 1, memories: Memory[] }`；id 自增数字；并发用简单串行队列（避免写竞争）
- **打分**：完全对齐 DeepSeek++ 的 `selector.ts`
- **提取**：`memorySave({ type, name, content, description?, tags? })`；prompt 章节指示 AI 何时调用
- **注入**：选中记忆格式化为 `- #id [type] name: content`，放入 system prompt
- **预算**：默认 2000 tokens（粗略按字符数/2 估算），prompt 大时动态缩减
- **管理 UI**：列表 + 按 type 筛选 + 编辑弹窗 + 置顶开关 + 删除 + JSON 导入导出

## 验收标准

- [ ] 存储：`memories.json` 增删改查正常，并发写不丢数据
- [ ] 提取：AI 在对话中透露偏好时，自动调用 `memorySave` 保存
- [ ] 注入：新对话的 system prompt 里含相关记忆（按打分选取）
- [ ] 打分：pinned/关键词/访问频率符合公式
- [ ] UI：记忆页可查看/筛选/编辑/置顶/删除/导入导出
- [ ] 验证：`typecheck` + `test` + `lint` + `compile` 全绿
- [ ] 真机验证：AI 能记住并跨对话复用

## 遗留

- 同步（WebDAV 等）暂不做
- 项目级记忆（scope=project）先做全局，项目级后续
- 向量检索暂不做（用关键词匹配）
- 记忆自动归档/清理（DeepSeek++ 的 90 天归档）暂不做

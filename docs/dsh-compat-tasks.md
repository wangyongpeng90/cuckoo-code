# DSH 客户端兼容 —— 任务清单

> 目标：**逐个击破**，每条可独立完成 + 验证。
> 状态：⬜ 待做 / 🔨 进行中 / ✅ 完成

---

## P0：`ctx.slots` 补全（通用，最高优先）

> **为什么**：3 个插件都用它；dsh-codex-ui 当前就崩在这。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P0-1 | **`slots.entries(slot)`** | 拿插槽条目列表（数组）| ⬜ |
| P0-2 | **`slots.entriesOfSlot(slot)`** | 同上（别名，codex-ui 用）| ⬜ |
| P0-3 | **`slots.subscribe(slot, cb)`** | 订阅插槽变化，返回退订函数 | ⬜ |
| P0-4 | **`slots.getVersion(slot)`** | 版本号（每次变化 +1）| ⬜ |
| P0-5 | **`slots.spec(slot)`** | 插槽声明（codex-ui 判 `typeof === "function"`）| ⬜ |
| P0-6 | **`slots.inject` 支持 generator** | `function*` + `yield`（一次注册多个）| ⬜ |
| P0-7 | **`slots.entries` 条目格式** | `{ options: { id, order, label }, ... }` | ⬜ |
| P0-8 | **`resolveSlotLabel`** | ui-slots 导出的工具函数 | ⬜ |

**验证**：dsh-codex-ui 的"常规"设置页能打开（不崩）。

---

## P1：`settingsScope` 服务（新服务）

> **为什么**：`ui-settings-plugins` 插件硬性依赖。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P1-1 | **`settingsScope.bind({ namespace })`** | 绑定命名空间，返回 scope | ⬜ |
| P1-2 | **`settingsScope.describe()`** | 返回 `{ getSnapshot, subscribe }` | ⬜ |
| P1-3 | **scope 的 `get/set/subscribe`** | 读写配置 + 订阅 | ⬜ |

**验证**：`ui-settings-plugins` 插件能 apply（不报 `ctx.settingsScope` undefined）。

---

## P2：`connection.api` + `remote.$on`（小扩展）

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P2-1 | **`ctx.get("connection").api`** | REST 客户端（codex-ui 用）| ⬜ |
| P2-2 | **`ctx.remote.$on("credentials/updated", cb)`** | 事件订阅 | ⬜ |
| P2-3 | **`connection.requestRejection`** | 业务 REST 认证（codex-ui warn）| ⬜ |

---

## P3：`children` 插槽嵌套机制

> **为什么**：`ui-settings-plugins` 的 `settings.section` 声明 `children: { "settings.plugins.tab": { kind: "list" } }`。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P3-1 | **`register` 支持 `children`** | 父槽声明子槽（`kind`/`scope`）| ⬜ |
| P3-2 | **`kind: "list"`** | 子槽是列表（多个条目）| ⬜ |
| P3-3 | **`kind: "keyed"`** | 子槽是键值对（带 key）| ⬜ |

---

## P4：`settings.plugins.tab` + `settings.plugin.item` 插槽

> **为什么**：`ui-settings-plugins` 注册这两个新插槽。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P4-1 | **`settings.plugins.tab` 插槽** | 设置页"插件"分类下的 Tab 栏 | ⬜ |
| P4-2 | **`settings.plugin.item` 插槽** | Tab 下的插件卡片 | ⬜ |
| P4-3 | **Tab UI** | 在设置页里渲染 Tab（点击切换）| ⬜ |

**验证**：设置页 → 插件 → 看到 Tab（"可配置"）+ 卡片（Shell/AgentLoop/WebSearch）。

---

## P5：`@deepseek-ai/dsh-client-runtime/client` 包（简化）

> **为什么**：`ui-settings-plugins` import 它（`createSnapshotStore`）。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P5-1 | **`createSnapshotStore(init, opts)`** | 快照 store（`getSnapshot`/`subscribe`/`update`/`set`）| ⬜ |
| P5-2 | **`defineStore`** | 同款（ui-slots 的契约）| ⬜ |
| P5-3 | **`persist` 支持** | localStorage 持久化 | ⬜ |

---

## P6：Profile 收尾

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P6-1 | **卸载验证** | 市场点"卸载"→ 真的卸掉 | ⬜ |
| P6-2 | **更新验证** | 市场点"更新"→ 真的更新 | ⬜ |
| P6-3 | **启停验证** | `cordis.patch.yml` 的 `disabled` | ⬜ |
| P6-4 | **`dsh-vcs` 加载验证** | 装了但 `bundles` 没加 → 要手动加吗 | ⬜ |

---

## P7：其他

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P7-1 | **用户记忆 React 版** | 合并遗留（`memories-react.tsx`）| ⬜ |
| P7-2 | **`profileContext` 真机验证** | P4 未验证 | ⬜ |
| P7-3 | **推送提交** | 多个提交未推 github | ⬜ |

---

## 依赖关系

```
P0 (slots 基础)
  ↓
P1 (settingsScope)  ← 依赖 P0
  ↓
P3 (children 嵌套)  ← 依赖 P0
  ↓
P4 (tab/item 插槽)  ← 依赖 P0 + P3
  ↓
P5 (runtime/client) ← 独立
```

**建议顺序**：**P0 → P1 → P3 → P4 → P5 → P6 → P7**

---

## 里程碑

| 里程碑 | 完成标志 |
|---|---|
| **M1** | P0 完成 → dsh-codex-ui 设置页不崩 |
| **M2** | P0+P1 完成 → `ui-settings-plugins` 能 apply |
| **M3** | P0+P1+P3+P4 完成 → 设置页"插件"分类完整显示 |
| **M4** | 全部完成 → DSH 核心插件都能跑 |

---

## 更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 初版（基于 4 个插件侦察 + ui-settings-plugins 深挖）|


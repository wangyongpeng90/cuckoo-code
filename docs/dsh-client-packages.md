# DSH 客户端包兼容清单

> **Cuckoo 对 DSH 客户端（`@deepseek-ai/dsh-client-*`）的兼容现状**
> 目的：**告别"插件崩了才补"**——系统盘点，一眼看全。

## 数据来源

**方法**：扫描 profile 里 4 个已装插件（dshmarket / dsh-codex-ui / dsh-web-all / dsh-tool-todo）的 `import` + `require`，统计 `@deepseek-ai/*` 依赖。

**结论**：**只有 4 个包被直接 import**（其余 60 个包通过 `ctx.get()` 运行时访问）。

---

## 一、编译期依赖（import）—— 4 个包

| 包 | 谁用 | Cuckoo 实现 | 状态 |
|---|---|---|---|
| `@deepseek-ai/cordis` | dsh-web-all | `src/plugins/dsh-compat/shim.ts`（真实现）| ✅ |
| `@deepseek-ai/dsh-tools` | dsh-tool-todo | 同上 | ✅ |
| `@deepseek-ai/schemastery` | dshmarket / tool-todo | STUB（万能空接口）| ✅ |
| `@deepseek-ai/dsh-client-ui-primitives` | **3 个插件** | `src/ui/shell/scripts/dsh-primitives/` | ⚠️ 部分 |

**即：import 层已基本覆盖**。

---

## 二、运行期服务（ctx.get / ctx.xxx）—— 主战场

### 2.1 已实现（客户端侧）

| 服务 | Cuckoo 位置 | 状态 |
|---|---|---|
| `ctx.slots` | `dsh-client-runtime.ts:makeCtx` | ⚠️ **只有 inject/register**（缺 subscribe/entriesOfSlot/getVersion/spec）|
| `ctx.on/once/off/emit` | 同上 | ✅ 真事件总线 |
| `ctx.effect` | 同上 | ✅ |
| `ctx.inject` | 同上 | ✅（立即执行）|
| `ctx.plugin` | 同上 | ✅ 挂子插件 |
| `ctx.locale` | `makeLocale()` | ✅ register/bind/subscribe |
| `ctx.theme` | `makeTheme()` | ✅ getTheme/setTheme/subscribe |
| `ctx.store` | `makeStoreEngine()` | ✅ defineStore |
| `ctx.configForms` / `ctx.forms` | `makeConfigForms()` | ✅ 简化版 |
| `ctx.sessions` | `makeSessions()` | ✅ |
| `ctx.workspaces` | `makeWorkspaces()` | ✅ |
| `ctx.layout` | `makeLayout()` | ✅ |
| `ctx.connection` | `makeConnection()` | ✅ |
| `ctx.remote` / `remote.session` | `makeRemote()` | ✅ |
| `ctx.uiWorkspace` | `makeUiWorkspace()` | ✅ |
| `ctx.tools` | **stub** | ⚠️ 空实现（host 侧有真实现）|

### 2.2 缺失 / 待补

| 服务 | 插件 | 说明 |
|---|---|---|
| **`ctx.slots.subscribe/entriesOfSlot/getVersion/spec`** | **dsh-codex-ui** | **当前卡点**（设置页崩）|
| `connection.requestRejection` | dsh-codex-ui | warn（业务 REST 认证）|
| `ctx.theme` 的完整 API | — | 待核 |

---

## 三、DSH Primitives（重点包）

**包**：`@deepseek-ai/dsh-client-ui-primitives`（**3 个插件都用**）

### 3.1 已实现

| 类别 | 数量 | 状态 |
|---|---|---|
| **图标** | 188 | ✅ 占位实现（名字全）|
| **组件** | 13 | ✅ Button/Tag/Switch/Modal/Menu/Tooltip/Pill/StateDot/Checkbox/DisclosureRow/SegmentedControl/Input/Toast |
| **Hooks** | 4 | ⚠️ 简化 |
| **工具函数** | 若干 | ⚠️ 简化 |

### 3.2 未实现

| 类别 | 组件 | 状态 |
|---|---|---|
| **高级组件** | MarkdownText / CodeBlock / JsonTree / DiffBlock / TerminalBlock / SearchBlock / WebBlock / ImageLightbox | ⬜ 未做 |

**判断**：dsh-market 不用高级组件；dsh-codex-ui 可能用。**按需补**。

---

## 四、补全策略（按优先级）

| # | 事项 | 影响 | 优先级 |
|---|---|---|---|
| 1 | **`ctx.slots` 补全** | dsh-codex-ui 崩 | **高** |
| 2 | **`ctx.slots.spec`** | `registerAfterOfficialWave` 逻辑 | 高 |
| 3 | **`ctx.slots.subscribe`** | 响应式更新 | 高 |
| 4 | **`ctx.slots.getVersion/getSnapshot`** | `useSyncExternalStore` | 高 |
| 5 | **`connection.requestRejection`** | codex-ui 业务 REST | 中 |
| 6 | **`ctx.tools` 真实现** | tool-todo | 中 |
| 7 | **高级 Primitives** | 按需 | 低 |

---

## 五、给插件开发者的建议

**写 DSH 插件时，为了让它在 Cuckoo 里也能跑**：

1. **UI 用 `ctx.slots.register`**（别硬改 DOM）
2. **import 只用这 4 个包**（其他 DSH 包可能不存在）
3. **服务用 `ctx.get(...)`**（别 import 包）
4. **UI 组件从 `@deepseek-ai/dsh-client-ui-primitives`**（我们提供兼容层）
5. **避免依赖 HMR / 进程重启**

---

## 更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 初版（盘点 4 个已装插件，确认 4 个 import 包）|


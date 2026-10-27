# DSH 插件兼容计划 —— plugin-manager

目标：让 DSH 官方的"插件管理器"（主页侧栏"插件"面板）在 Cuckoo 里完整跑起来。
版本：0.1.6-alpha.2（npm 上实际安装的）。原则：看 API 契约，自己实现。

---

## 零、目标插件全貌（侦察结论）

### 0.1 它是什么

【@deepseek-ai/dsh-client-ui-plugin-manager】—— DSH 的"插件管理器"：
- 主页侧栏一个"插件"入口（sidebar.panellist）
- 点开 → 主面板显示插件管理页（main）
- 功能：安装 / 启用 / 禁用 / 卸载 / 重试 / 组合插件

### 0.2 依赖（inject 数组）

【["slots", "locale", "remote", "remote.pluginManager", "remote.pluginInventory"]】

### 0.3 import 的包

| 包 | 我们 |
|---|---|
| @deepseek-ai/dsh-client-ui-primitives | ✅ 已有 |
| @deepseek-ai/dsh-client-ui-slots | ⚠️ stub（够用）|
| **@deepseek-ai/dsh-client-store** | ❌ **缺**（新包）|

### 0.4 注册的插槽

| 插槽 | 说明 | 我们 |
|---|---|---|
| **sidebar.panellist**（id:plugins, order:0）| 侧栏入口 | ✅ 已支持 |
| **main**（key:plugins）| 主面板（含 children）| ❌ **架构冲突** |

main 的 children：
```
children: {
  "plugins.item":          { kind: "list" },
  "plugins.bundle.config": { kind: "keyed" },
  "plugins.row.config":    { kind: "keyed" },
}
```

### 0.5 用到的 remote API

**remote.pluginManager**（8 个方法）：

| 方法 | 作用 |
|---|---|
| listBundles() | 列已装 bundle |
| listPlugins() | 列插件条目 |
| setBundleEnabled(pkg, on) | 启/禁 bundle |
| setPluginEnabled(entryId, on) | 启/禁插件 |
| removeBundle(pkg) | 卸载 |
| installBundle(spec, opts) | 安装 |
| cancelInstall(requestId) | 取消安装 |
| inspect(spec, signal) | 检查包 |

**remote.pluginInventory**：list()

**remote.$on**（3 个事件）：plugin-manager/changed、plugin-manager/install-log、plugin-manager/install-state

### 0.6 用到的其他 API

| API | 说明 | 我们 |
|---|---|---|
| ctx.layout.panelInfo | getSnapshot/subscribe | ✅ |
| ctx.layout.selectPanel(id) | 切换面板 | ❌ |
| ctx.on("connection/reset") | 连接重置 | ✅ |
| ctx.locale.register/bind | i18n | ✅ |

---

## 一、任务清单（按依赖排序）

### P0：@deepseek-ai/dsh-client-store 包（新包，基础）

为什么：插件 import 它（createSnapshotStore）。

| # | 任务 | 契约 | 状态 |
|---|---|---|---|
| P0-1 | **createSnapshotStore(init, opts)** | 返回 getSnapshot/subscribe/update/set | ✅ |
| P0-2 | update(mutator) 支持 draft | draft 可变，set 不可变 | ✅ |
| P0-3 | opts.persist = { name } | localStorage 持久化 | ✅ |
| P0-4 | opts.flush = raf | raf 批量通知 | ✅ |
| P0-5 | defineStore(spec) | 声明 store（返回 handle）| ✅ |

实现位置：src/ui/shell/scripts/dsh-client-store/（新目录）

验证：单测（getSnapshot/subscribe/update/set/persist）

---

### P1：remote.pluginManager + remote.pluginInventory（后端 RPC）

为什么：插件的核心功能全靠它。

| # | 任务 | 契约 | 状态 |
|---|---|---|---|
| P1-1 | **listBundles()** | 返回 BundleInfo[] | ✅ |
| P1-2 | **listPlugins()** | 返回 PluginInfo[] | ✅ |
| P1-3 | **setBundleEnabled(pkg, on)** | 改 cordis.patch.yml | ✅ |
| P1-4 | **setPluginEnabled(entryId, on)** | 改 patch | ✅ |
| P1-5 | **removeBundle(pkg)** | pnpm remove + 改 manifest | ✅ |
| P1-6 | **installBundle(spec, opts)** | pnpm add + 改 manifest | ✅ |
| P1-7 | **cancelInstall(requestId)** | 杀进程 | ✅ |
| P1-8 | **inspect(spec, signal)** | 检查 npm 包 | ✅ |
| P1-9 | **remote.pluginInventory.list()** | 列可管理插件 | ✅ |

实现方式：壳页面 → shellAPI → 主进程 IPC（复用 src/app/ipc/plugin.ts）

⚠️ 关键：返回的 BundleInfo / PluginInfo 形状要对（插件按它渲染卡片）。

---

### P2：remote.$on 事件（3 个）

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P2-1 | **plugin-manager/changed** | 安装/启用后广播 | ⬜ |
| P2-2 | **plugin-manager/install-log** | 安装日志流 | ⬜ |
| P2-3 | **plugin-manager/install-state** | 安装进度 | ⬜ |

实现方式：主进程 → preload → 壳页面事件总线（复用 ctx.on）

---

### P3：main 插槽（架构冲突，核心难点）

问题：DSH 是"侧栏 = 面板切换器"，Cuckoo 侧栏是"工作区/会话列表"——没有"主面板切换"机制。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P3-1 | **ctx.layout 补全** | panelInfo + selectPanel(id) | ⬜ |
| P3-2 | **main 插槽的渲染位置** | 决定"点插件 → 主面板往哪放" | ⬜ |
| P3-3 | **sidebar.panellist 点击联动** | 点侧栏项 → 切主面板 | ⬜ |
| P3-4 | **children 嵌套机制** | 父槽声明子槽 | ⬜ |

方案（待定）：A. 复用主页区域；B. 新开面板（像任务看板）；C. 模态。

⚠️ 这个要先定方案（影响 P3-P6）。

---

### P4：ctx.slots 补全（通用）

之前 P0 做过一部分（entries/subscribe/getVersion/spec/generator）。

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P4-1 | slots.entries / entriesOfSlot | — | ✅ 已做 |
| P4-2 | slots.subscribe | — | ✅ 已做 |
| P4-3 | slots.getVersion | — | ✅ 已做 |
| P4-4 | slots.spec | — | ✅ 已做 |
| P4-5 | slots.inject generator | — | ✅ 已做 |
| P4-6 | **children 嵌套** | 父槽声明子槽（kind/scope）| ⬜ |
| P4-7 | **register 的 key 字段** | keyed 类型的 key | ⬜ |

---

### P5：plugin-manager 的 children 插槽渲染

| # | 任务 | 说明 | 状态 |
|---|---|---|---|
| P5-1 | **plugins.item**（list）| 官方插件卡片 | ⬜ |
| P5-2 | **plugins.bundle.config**（keyed）| bundle 配置 | ⬜ |
| P5-3 | **plugins.row.config**（keyed）| 行配置 | ⬜ |

说明：这些是插件管理页内部的子插槽。P3 完成后才能做。

---

### P6：settings-plugins（之前的，可选）

| # | 任务 | 状态 |
|---|---|---|
| P6-1 | settingsScope 服务 | ✅ 已做（P1）|
| P6-2 | settings.section（设置页"插件"）| ⬜ 可选 |

---

## 二、执行顺序

```
P0 (client-store)         ← 基础（无依赖）
  ↓
P1 (remote RPC)           ← 核心（无依赖）
  ↓
P2 (remote events)        ← 依赖 P1
  ↓
P3 (main 插槽)            ← 依赖 P3-1 (layout)
  ↓
P4 (slots children)       ← 通用
  ↓
P5 (children 渲染)        ← 依赖 P3 + P4
```

建议：P0 → P1 → P2 → P3（先定方案）→ P4 → P5

---

## 三、里程碑

| 里程碑 | 完成标志 |
|---|---|
| M1 | P0 完成 → 插件能 import |
| M2 | P1 完成 → apply 不崩 |
| M3 | P2+P3 完成 → 侧栏出现"插件"入口，点开有面板 |
| M4 | P4+P5 完成 → 面板功能完整 |

---

## 四、侦察待补

| # | 待侦察 | 说明 |
|---|---|---|
| 1 | BundleInfo / PluginInfo 形状 | 从 dsh-api-remotes 类型定义看 |
| 2 | PluginManagerState / PluginManagerFace | 从 manager-store.d.ts 看 |
| 3 | ctx.layout 契约 | panelInfo / selectPanel |
| 4 | main 插槽在 DSH 怎么渲染 | 面板切换机制 |

---

## 更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 初版（基于 plugin-manager@0.1.6-alpha.2 侦察）|

---

## 五、侦察补充（第二轮，2026-10-16）

### 5.1 BundleInfo（已装/可装 bundle）

```ts
{
  name: string
  version?: string
  meta?: PluginLocalizedMeta    // 本地化显示（title/description）
  description?: string
  enabled: boolean              // 是否在 profile manifest 选中
  installed: boolean            // 是否在 profile 依赖里
  source?: string               // pnpm add 可用的 spec
  optional: boolean             // 安装自带、可开关、不可删
  removable: boolean
  readOnlyReason?: "management-required" | "unaddressable"
  error?: ManagementError       // { code, diagnostic?, incompatible? }
  rows: BundleRowInfo[]         // patch 声明的行（rowId/moduleName/meta/entryId）
  overrides: string[]           // patch 覆盖的行 id
}
```

### 5.2 PluginInfo（运行中条目）

```ts
{
  entryId: PluginEntryId
  moduleName: string
  meta?: PluginLocalizedMeta
  enabled: boolean
  fiberPhase: "pending"|"loading"|"active"|"failed"|"unloading"|null
  patchId?: string
  readOnlyReason?: "management-required" | "unaddressable"
}
```

### 5.3 PluginManagerState / PluginManagerFace

```ts
// State（前端渲染用）
{
  status: "idle"|"loading"|"ready"|"error"|"unavailable"
  packages: PackageView[]
  busy: string[]
  notice: ManagerNotice | null
  install: InstallState
  confirm: ConfirmState | null
  highlight: string | null
}

// Face（注册注入的）
{
  hooks: { pluginManager: SnapshotStore<State>, configLedger: HostObservable<ConfigLedger> }
  ensure / refresh / openInstall / closeInstall / editInstallSpec
  runInstall / approveBuildsAndRetry / cancelInstall / cancelInstallAndClose
  toggleInstallDetails / enableInstalled
}
```

### 5.4 ctx.layout 契约

```ts
interface ILayout {
  panelInfo: HostObservable<PanelInfo>   // { activePanelId: MainPanelId | null }
  selectPanel(panelId: MainPanelId | null): void   // null = 回会话
  beginNavigation(): AbortSignal
  toggleSidebar(): void
  openRightbar(track, fullscreen): void
  closeRightbar(): void
}
```

⚠️ 关键：selectPanel(id) 要求 id 已注册（"main panel 未注册"抛错）——即"先注册 main 插槽，再切面板"。

### 5.5 main 渲染机制（Cuckoo vs DSH）

**Cuckoo 现有**（shell-frame.tsx）：
```
TABS（硬编码 10 项）→ 点击 → activeTab → PAGES[activeTab] 渲染
```

**DSH**：
```
sidebar.panellist 项 → 点击 → selectPanel(id) → main 插槽组件（按 key 渲染）
```

**桥接**：Cuckoo 的"活动栏 TABS + PAGES" = DSH 的"sidebar.panellist + main"。

### 5.6 P3 方案已定：B（新 tab）

**用户拍板**：新 tab（最贴近 DSH）。

具体：
1. ctx.layout.selectPanel(id) → 桥接 setActiveTab(id)
2. ctx.layout.panelInfo → 当前 activeTab
3. main 插槽注册的组件 → 动态渲染在 tab 里
4. sidebar.panellist 项 → 点击切 tab（而非调命令）

⚠️ 代价：TABS 是硬编码的，要改成"动态 + 插槽"；main 组件 props 要组装（PropsRuntime<"main">）。

### 5.7 补充发现

| 发现 | 说明 |
|---|---|
| PluginManagerState 要 SnapshotStore | 依赖 dsh-client-store（P0）|
| main 的 props 要 PropsRuntime<"main"> | = OwnerOf + KeyProps + SlotInjectFace + ScopeStandardProps |
| configLedgerSource(ctx) | 要读 3 个子插槽（plugins.item/bundle.config/row.config）|
| remote.$on 事件带数据 | changed(change) / install-log(chunk) / install-state(progress) |
| ManagementError.code | 13 种（management-required/unaddressable/unknown-plugin/invalid-spec/ambiguous-install/not-bundle/not-removable/stop-profile/bundle-in-use/stale-approval/incompatible-version/operation-error）|

### 5.8 事件契约

```ts
ctx.remote.$on("plugin-manager/changed", (change) => {})      // change.reason: plugin|bundle|install|remove
ctx.remote.$on("plugin-manager/install-log", (chunk) => {})   // chunk: { requestId?, jobId, argv, cwd, stream, text, exitCode? }
ctx.remote.$on("plugin-manager/install-state", (progress) => {}) // progress: { requestId, phase, attempt? }
```

---

## 六、更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | 初版（基于 plugin-manager@0.1.6-alpha.2 侦察）|
| 2026-10-16 | 补侦察：BundleInfo/PluginInfo/State/Face/layout/main + P3 定 B |

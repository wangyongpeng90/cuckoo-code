---
id: 261125-bmsfsh
type: feature
title: Cuko 窗口兼容 dsh-purge 插件接口
status: doing
branch: feat/261125-bmsfsh-dsh-purge-compat
created: 2026-11-25
updated: 2026-11-25
---

# Cuko 窗口兼容 dsh-purge 插件接口

> 隶属 [022 DSH 插件兼容](./022-dsh-plugin-compat.md)，是 [261125-p3vk8w-cuko-plugin-slots](./261125-p3vk8w-cuko-plugin-slots.md) 的下一站。
> 原则（用户原话）：**我们只是参考 DSH 去做，而不是把他的代码拿来用。**

## 背景

`dsh-purge`（v1.1.71 / MIT / 原作者 YuJunZhiXue）是一个 DSH 的「破甲 + 红队演练台」插件，体量大、接口面广，是检验 Cuko 窗口 DSH 兼容度的**标杆靶子**。

- 本地参考：`C:\d\SourceCode\2027\dsh-purge`（镜像仓库，含 MIRROR-NOTICE）
- DSH 源码参考：`C:\d\SourceCode\2026\deepseek-harness2`
- 现状：Cuko 窗口刚通过 p3vk8w 拿到侧边栏插槽，但 **`shell.overlay` / `conversation.*` 一个都没有**，dsh-purge 的 UI 在 Cuko 里完全不可见。

### 目标与非目标

| | 内容 |
|---|---|
| **要** | 让 dsh-purge 的 **UI 在 Cuko 窗口里能看到、能点**（鸿蒙兼容 Android 的路子） |
| **要** | 把它用到的 DSH 接口在 Cuckoo 侧**按契约补齐**，而不是照搬它的实现 |
| **不要** | 复刻 `lib/core.js` 的「改写 DSH 安装目录」能力——Cuckoo 不是 DSH，没有那些文件 |
| **不要** | 复制 dsh-purge 的任何代码；只参考它**用了哪些接口** |

> ⚠️ **重要边界**：dsh-purge 宿主侧 `apply()` 开头就调 `core.applyRuntimeEnv()` / patch 磁盘文件。
> 在 Cuckoo 里这部分**注定空转或报错**。本需求的验收是「插件不崩、UI 可见可用」，
> **不追求破甲逻辑生效**。

## dsh-purge 的接口测绘（实测）

### 一、`ctx.*` 服务依赖

| 服务 | 用量 | Cuckoo 现状 | 差距 |
|---|---|---|---|
| `ctx.tools.register` | 60 次 | ✅ 宿主侧有真实现 | 客户端 `ctx.tools` 是 `makeStub` |
| `ctx.on` / `ctx.effect` | 29 / 28 | ✅ 有 | — |
| `ctx.get(...)` | 25 | ✅ 有 | — |
| `ctx.slots.inject/register` | 9 | ⚠️ 机制有，槽位名不支持 | 见「三、UI 插槽」 |
| `ctx.logger` | 10 | ✅ 有 | — |
| `ctx.waterfall` | 7 | ❌ **无** | 只有 emit，没有 waterfall 链 |
| `ctx.agentPresets` | 6 | ⚠️ 宿主 C-light，客户端空壳 | 缺 `register()` |
| `ctx.subprocess.resolveExecutable` | 4 | ❌ **无** | 核心缺口 |
| `ctx.sandboxPolicy.resolve` | 1 | ❌ 无 | 可静态返回 |
| `ctx.webServer.register` | 1 | ✅ 宿主有 | 客户端不需要（走 fetch 拦截） |
| `ctx.provide('redteam')` | 2 | ✅ 有 | — |
| `ctx.inject([...], cb)` | 2 | ⚠️ 立即执行，不等待就绪 | dsh-purge 靠它等 `sessions`/`uiWorkspace` |
| `ctx.scheduleRestart` | 1 | ❌ 无 | 可空转 |

### 二、事件契约

| 事件 | 方向 | Cuckoo 现状 |
|---|---|---|
| `agent/pre-step` | 监听（5 处，含 `{global:true, prepend:true}`） | ❌ 未广播 |
| `system-prompt/assemble` | 监听（2 处，waterfall 改写） | ❌ 未广播 |
| `tools/pre-execute` / `tools/post-execute` | 监听 | ❌ 未广播 |
| `session/created` | 监听（4 处） | ⚠️ 只有 `session/event` |
| `agent-preset/selected` / `subagent/end` | 监听 | ❌ 无 |
| `agent/assistant-stream` 等 7 个 | 监听 | ✅ 已有（event-bridge） |

**DSH 真实契约**（参考 `packages/core/agent/src/runtime-types.ts` 与 `packages/core/system-prompt/src/index.ts`）：

- `agent/pre-step`：`({ agent, messages, turn, step, signal }, next)`
- `system-prompt/assemble`：`(assembly: PromptAssembly, context, next) => Promise<PromptAssembly>`
  - `PromptAssembly = { sections, contexts, variables, tools }`

### 三、UI 插槽（4 个）

| 插槽 | 注册的组件 | Cuckoo 现状 |
|---|---|---|
| `shell.overlay` | `redteam-console`(50)、`dsh-purge-dock`(50) | ❌ 无 |
| `sidebar.footer.action` | `redteam-toggle`(50)、`redteam-full`(51) | ✅ 有（p3vk8w） |
| `conversation.session.header.utilities` | `redteam-header-toggle`(50) | ❌ 无 |
| `conversation.input.right` | `dsh-purge-rewind`(20) | ❌ 无 |

**DSH 里 `shell.overlay` 的语义**（参考 `packages/client/ui-layout/src/client/AppFrame.tsx:328`）：
挂在整个 frame 的 `overlayLayer` 里，是**全屏最高层**，插件往里放浮层/抽屉/Toast。

### 四、客户端入口形态

`client.js` 是 `window.__ModuleLoader__.load({ id, factory })` 单文件（508 KB），
`inject: ["slots", "locale"]`，用 `react` / `react-dom`（`createPortal`）。
Cuckoo 的 `dsh-client-runtime` 已能加载这种形态，**无需改插件**。

## 方案：四个阶段

### 阶段 0：可行性验证（前置门槛）✅ **已完成**

**目标**：确认链路通，再谈兼容。

1. 手写一个**最小测试插件**，只往 `shell.overlay` 注册一个纯 DOM 浮层
2. 在 Cuko 窗口里确认能渲染、能点击、能卸载
3. 验证通过前**不动真插件**

> 理由：p3vk8w 只证明了 `sidebar.panellist` 能跑，`shell.overlay` 的挂载时机、层级、
> 事件透传都还没验过。

#### 交付物

| 文件 | 说明 |
|---|---|
| `examples/dsh-slot-probe/` | 探针插件（`package.json` / `index.js` / `client.js` / `README.md`） |
| `src/ui/cuko/plugin-slots.tsx` | 新增 `CukoOverlayLayer`（`shell.overlay` 最小挂载点） |
| `src/app/cuko-preload.ts` | 暴露 `pluginDebugLog`（探针落盘通道） |
| `src/ui/shell/scripts/dsh-client-runtime.ts` | **修 `ctx.effect` 永不回收的缺陷** |

#### 实测结果（2026-11-25，隔离环境真机）

四环全绿：

| 环 | 结果 | 实测证据 |
|---|---|---|
| ① load | ✅ | `require(react)` 可用，ModuleLoader 已执行 |
| ② register | ✅ | 6 项深断言全过 |
| ③ render | ✅ | `shell.overlay` 挂载点 + 组件节点均存在 |
| ④ dispose | ✅ | 禁用插件后 cleanup 执行 |

环② 的 6 项断言：register 返回 disposer / entries() 含本条目 / order 保留 7 /
component 是函数 / inject 面已派生 / `inject()` 返回 `probeInjected=yes`。

#### 阶段 0 顺带修掉的缺陷：`ctx.effect` 从不回收

**根因**：`makeCtx` 里的 `effects` 数组只 push 不消费——`applyClient` 丢弃了返回的 ctx，
`clearSlotsByPlugin` 只清 `slotTable`，`reloadDshClients` 只删 `loadedModules`。
**后果**：插件卸载后样式标签、`MutationObserver`、`setInterval`、事件监听全部残留。

**修法**（对齐 DSH 的 Cordis fiber 作用域语义）：

- 新增 `pluginCtxs: Map<pluginId, { effects, ctx }>` 登记表
- `disposePluginCtx(pluginId)`：逆序执行该插件所有 cleanup（与 `plugin-system.md` 约定一致）
- `makeCtx(pluginId, services, parentEffects?)`：子插件 effect 直接挂父作用域
- `ctx.dispose()` 接真（不再是空函数）
- `applyClient` 登记作用域；`clearSlotsByPlugin` / `clearAllSlots` 调用回收

#### 隔离验证环境（不碰真实 ~/.cuckoo）

```
CUCKOO_HOME        = tmp/cuckoo-home-probe
CUCKOO_SESSION_DIR = cuckoo-probe-session
CUCKOO_DEBUG_PORT  = 9388
```

探针落盘在 `%APPDATA%/cuckoo-probe-session/plugin-debug.log`，搜 `[dsh-slot-probe]` 取 JSON。

### 阶段 1：客户端槽位（改动最小、收益最大）✅ **已完成**

| 槽位 | Cuko 落点 | 说明 |
|---|---|---|
| `shell.overlay` | ~~`app.tsx` 根 div 内新增一层全屏容器~~ **阶段 0 已提前完成** | `CukoOverlayLayer`：容器 `pointer-events-none` + `fixed inset-0 z-50`，子项 `pointer-events-auto` |
| `conversation.session.header.utilities` | Cuko 对话区顶部工具条 | `CukoSessionHeaderUtilities` |
| `conversation.input.right` | 输入框右侧（`ComposerSlotsContext.extra` 内） | `CukoInputRight` |

**前置重构**（已完成）：`sidebar-slots.tsx` 的 `useSidebarSlot` 泛化为 `useDshSlot(slotName)`，
`useSidebarSlot` 保留为别名（老页面调用点不用改）。

#### 关键实现：会话作用域槽位的 scope 目标注入

这类槽位的 `spec.inject` 是 `(sessionId) => ({ sessionId, t, ... })`——
**必须把 scope 目标当参数传进去**，否则插件拿到 `undefined`（dsh-purge 的 rewind 按钮正是这样）。
`renderSessionSlotItems(items, sessionId, label)` 统一处理，并额外把 `sessionId` 当 props 传一份。

#### 实测结果（2026-11-25，隔离环境真机）

- 5 个 `data-slot` 挂载点全部就位：`sidebar.panellist` / `sidebar.footer.action` /
  `conversation.session.header.utilities` / `conversation.input.right` / `shell.overlay`
- 两个会话作用域槽位拿到**真实 sessionId**（`76126559-8db5-4f0a-ace7-e9d0e610f976`）
- 探针 10 项断言全过，四环全绿
- 禁用插件后组件全部消失，5 个空挂载点保留（不破坏布局）

### 阶段 2：客户端 runtime 补 3 个洞 ✅ **已完成**

改 `src/ui/shell/scripts/dsh-client-runtime.ts` 的 `makeCtx`：

| 缺口 | 补法 |
|---|---|
| `ctx.waterfall` | 按注册顺序串 `(value, ...args, next)`，返回链尾值；支持 `prepend`/`global` 选项 |
| `ctx.inject` 立即执行 | 改「服务就绪才回调」：pending 队列 + `provide` 后 flush，5s 超时兜底 |
| `ctx.agentPresets` | 客户端返回 `{ list, register, get, subscribe }`（dsh-purge 只读，给空列表） |

#### 顺带补齐：完整的事件派发

原来只有 `emit`，且 `ctx.on` 的第三参（`{global, prepend}`）会被当成函数处理。
现在按 DSH 的 cordis 五派发全部实现：

| 派发 | 语义 |
|---|---|
| `emit` | 广播，不等返回（异常隔离） |
| `parallel` | 并行，返回结果数组 |
| `serial` | 串行，返回最后一个结果 |
| `bail` | 短路，第一个非 undefined 即停 |
| `waterfall` | 瀑布：`(value, ...args, next)`，调 `next()` 取下游，返回自己的加工结果 |

**waterfall 的语义细节**（对着 DSH `core/system-prompt/src/index.ts:684` 核过）：

```js
ctx.on('system-prompt/assemble', async (assembly, context, next) => {
  const downstream = await next();               // 取下游结果
  return { ...downstream, sections: [...] };     // 自己的加工结果交给上游
}, { global: true, prepend: true });
```

- `prepend` 的监听器排在前面
- 监听器返回 `undefined` → 视为「不改变」，沿用下游结果
- 链尾执行调用方给的 `next`（DSH 里是 `() => Promise.resolve(assembly)`）

#### 踩到并修掉的一个坑

`inject` 的就绪检查最初只看 `ctx[n]`，但 `ctx` 是 `...services` 的**展开副本**——
`provide()` 写的是 `services`，后提供的服务不会出现在 `ctx` 上，导致「provide 后仍不触发」。
改成两个都查后通过。

#### 实测结果（2026-11-25，隔离环境真机）

探针 **17 项断言全过**，四环全绿：

| 新断言 | 实测值 |
|---|---|
| waterfall 链式执行 | `out=tail+B+A order=A-in,B-in,B-out,A-out` |
| waterfall prepend 排在前 | 同上 |
| inject 服务未就绪时不执行 | `firedEarly=false` |
| inject 在 provide 后执行 | ✅ |
| agentPresets 存在 / list() 可调用 | `{"result":{"value":{"presets":[]}}}` |
| on(evt,fn,opts) 正常 + off 生效 | `hit=1` |

### 阶段 3：宿主侧加载修复 ✅ **已完成**

> **实际做下来，阶段 3 的重心变了**：真机装 dsh-purge 后，卡住它的**不是**缺 3 个服务，
> 而是加载器的 `import.meta.url` 缺陷。原计划的服务补齐降级为非阻塞项。

#### 真机首跑的两个报错（2026-11-25）

```
[Cuckoo Plugin] 失败: dsh-purge:The "path" argument must be of type string
                or an instance of URL. Received undefined
[dsh-client] inject 超时（服务未就绪）: sessions,uiWorkspace,workspaces,conversation @dsh-purge
```

#### ① 宿主侧：`import.meta.url` 在 CJS bundle 里丢失（已修）

**根因**：DSH 插件用 `fileURLToPath(import.meta.url)` / `createRequire(import.meta.url)` /
`new URL(rel, import.meta.url)` 定位自身目录和资源文件。dsh-purge 有 **14 处**这样用。
esbuild 打成 `format: 'cjs'` 后 `import.meta` 变成空对象，
于是 `fileURLToPath(undefined)` 抛「path argument ... Received undefined」，**整只插件加载失败**。

**修法**（`src/plugins/cuckoo-plugins/loader.ts` 的 `bundlePlugin`）：

```ts
const entryUrl = require('node:url').pathToFileURL(entryFile).href;
esbuild.build({
  // ...
  define: { 'import.meta.url': JSON.stringify(entryUrl) },
});
```

定义成**入口文件的真实 file:// URL**（不是虚拟占位值），
这样 `createRequire` / `new URL(rel, import.meta.url)` / `fileURLToPath` 全都照常工作，
插件读自己目录下的资源文件也能读到。

**验证**：

- define 生效、bundle 里无 `import.meta.url` 残留
- dsh-purge 的 `apply()` 完整跑通：`inject(connection)` ✅ → `inject(webServer)` ✅ → `apply 完成`
- 注册 3 个工具：`purge_status` / `purge_apply` / `purge_revert`，12 个 disposer
- 新增回归测试 `test/plugins/plugin-meta-url.test.js`（造一个用 `import.meta.url` 读同目录资源的插件）

> **这是通用修复**，不只救 dsh-purge——任何依赖 `import.meta.url` 的 ESM 插件都受益。

#### ② 客户端：`ctx.conversation` 缺失（遗留，见阶段 4）

`inject(['sessions','uiWorkspace','workspaces','conversation'])` 里 `conversation` Cuckoo 没有，
`every()` 永不满足 → 5s 超时（阶段 2 的兜底逻辑生效了，强制执行没让插件卡死）。
**不阻塞加载**，但 rewind 等依赖它的 UI 不可用。

#### ③ 原计划的 3 个服务（降级为非阻塞）

| 服务 | dsh-purge 用途 | 状态 |
|---|---|---|
| `ctx.subprocess.resolveExecutable` | 找 bash / 命令路径 | 未补；真机 `apply` 未走到，暂不需要 |
| `ctx.sandboxPolicy.resolve` | 读沙箱策略 | 未补；同上 |
| `ctx.agentPresets.register` | 注册红队预设 | 客户端已给空实现，够用 |

#### ④ 未做的：`cordis.patch.yml` 的 `insert`（红队演练台）

dsh-purge 的 3 个 redteam 子插件（`redteam` / `redteam/store` / `redteam/ui`、54 个 `redteam_*` 工具）
是 patch 文件里 `insert` 声明的。Cuckoo 目前**只读 patch（启用/禁用），不执行 insert**
（022 文档已记为 ⚠️ 部分兼容）。要跑演练台需先支持 insert 语义，属独立课题。

### 阶段 4：conversation 服务 + 事件补齐 ✅ **已完成**

**触发点**：`shell.overlay` 里的 `EnvAdaptSendGate` 监听 `agent/pre-step` 做发送拦截；
`RewindSafe` 依赖 `sessions` + `uiWorkspace` + `conversation`。

#### ① `ctx.conversation` 服务（客户端，解决 inject 超时）

**契约来源**：DSH `packages/client/ui-conversation/src/client/contract/input.ts`
（`SessionInput` / `SessionInputResolver` / `InputHub`）。

dsh-purge 的取法（`client.js:2968` `conversationInput`）：

```js
const input = conversationFace()?.input;
if (typeof input.shell === 'function') return input.shell(sessionId);   // 首选
const actx = sessions.scope(sessionId);
if (typeof input.for === 'function' && actx) return input.for(actx);    // 回退
```

**实现**（`dsh-client-runtime.ts` `makeConversation`）：

- `input.shell(sessionId)` → 该会话的输入面板
- `input.for(actx)` → 按作用域解析（支持 `actx.sessionId` / `actx.session.id` / `actx.id`）
- 面板提供 `setDraft` / `insertQuote` / `state.getSnapshot()` / `state.subscribe()` / `notify` / `focus` 等

**诚实说明**：Cuckoo 没有可复用的真实 composer 句柄，所以做成**按 sessionId 的内存草稿仓**——
`setDraft` 记下值，`getSnapshot().draft` 读回来，会话之间互相隔离。
插件的 rewind 能「写回草稿」并读回，但**不会真的显示在 Cuko 输入框里**
（把草稿接到真实 composer 是后续独立工作）。

#### ② `system-prompt/assemble` 瀑布（让插件能改写提示词）

- `event-bridge.ts` 新增 `waterfallDshEvent()`：按 `(value, ...args, next)` 串起所有插件的监听器
- `buildPrompt()` 从**同步改异步**，末尾把整段提示词塞进 `assembly.sections[0]` 走一遍瀑布，再拼回
- 改 async 波及 **6 个调用点**（`cuko-runner` / `cuko.ts` / `harness.ts` / `project-context.ts`），
  连同 `withSystemPrompt` / `prepareOpenAiUserTurn` / `switchToOpenAiModel` 一起改成 async

> **为什么能改**：所有调用点本来就在 async 上下文里，改动是机械的 `await` 补齐。

#### ③ 事件补齐

`dispatchHarnessPayload` 新增三类事件映射：

| 上报类型 | DSH 事件 |
|---|---|
| `session-created` | `session/created` |
| `tool-pre-execute` | `tools/pre-execute` |
| `tool-post-execute` | `tools/post-execute` |

> **未做**：`agent/pre-step` 的**拦截式**广播（需要 Cuko 发送流程真正停下来等插件决策）。
> 目前只补了会话/工具事件的**通知式**广播，不做发送拦截。

#### 实测结果（2026-11-26，隔离环境真机）

探针 **23 项断言全过**，四环全绿。阶段 4 新增的 6 项：

| 断言 | 结果 |
|---|---|
| `conversation` 存在 | ✅ |
| `conversation.input` 存在 | ✅ |
| `input.shell(id)` 返回面板 | ✅ |
| `setDraft` → `getSnapshot().draft` 往返 | ✅ |
| 不同会话的草稿互相隔离 | ✅ |
| `input.for(actx)` 可用 | ✅ |

宿主侧另验：模拟插件注册 `system-prompt/assemble` 监听器，
插件注入的 section **确实出现在最终结果里**（`ORIGINAL | INJECTED-BY-PLUGIN`）。

> **风险提示（用户已知悉并同意）**：阶段 4 让插件能**改写系统提示词**，
> 属于「让它真生效」而非「让它能显示」。dsh-purge 这类插件会改写 Cuckoo 发出的提示词内容。

## 待拍板的四个决策

| # | 问题 | 选项 |
|---|---|---|
| 1 | 目标边界 | (a) 只要 UI 可见可用（阶段 1-3）；(b) 连拦截/改写逻辑也生效（含阶段 4） |
| 2 | `shell.overlay` 范围 | (a) 盖整个 Cuko 窗口（含侧栏）；(b) 只盖对话区 |
| 3 | 工具注册 | (a) 不注册，`redteam_*` 全部不可用；(b) 真注册进 Cuckoo 工具表（依赖它的 SQLite store，工作量大） |
| 4 | `conversation.input.right` 语义 | Cuko 的会话是 `cuko_sessions`，rewind 依赖 `sessions`/`uiWorkspace`，需额外映射 |

## 验收标准

- [x] 阶段 0：最小测试插件的 `shell.overlay` 浮层在 Cuko 窗口正常渲染、可点、可卸载（四环全绿）
- [x] 阶段 1：Cuko 窗口存在 `shell.overlay` / `conversation.session.header.utilities` / `conversation.input.right` 三个 `data-slot` 挂载点
- [x] 阶段 1：没有插件注册时，Cuko 界面外观**完全不变**（空槽只留 `display:contents` 挂载点）
- [x] 阶段 2：`ctx.waterfall` / `ctx.inject` 延迟 / `ctx.agentPresets` 通过自测（17 项断言全过）
- [x] 真机装 `dsh-purge`：宿主侧 `apply()` 跑通，注册 3 个工具（阶段 3 修复 `import.meta.url`）
- [ ] 真机装 `dsh-purge`：Cuko 窗口不崩、RedTeam 按钮可见、点击有反应（**待你重启 Cuckoo 后验**；`conversation` 已补齐，inject 不再超时）
- [x] 阶段 4：`ctx.conversation` 服务（`shell` / `for` / 草稿读写 / 会话隔离）
- [x] 阶段 4：`system-prompt/assemble` 瀑布接通（插件能改写提示词）
- [ ] 老页面（壳）行为不变
- [ ] `typecheck / test / lint / compile` 全绿

## 落地顺序

```
1. 阶段 0：最小验证（只放浮层，确认链路）
2. 阶段 1：泛化 useDshSlot + 补 3 个槽位宿主
3. 阶段 2：补 ctx.waterfall + ctx.inject 延迟执行
4. 装真 dsh-purge，按报错逐项补（学会用错误驱动，而不是照依赖清单全补）
5. 阶段 3 / 4：视决策 1 和 3 的结果再定
```

## 不要做的事

- ❌ 照着 dsh-purge 的依赖清单把 8 个服务全补齐 —— 很多是它宿主侧破甲逻辑用的，UI 路径根本走不到
- ❌ 复刻 `lib/core.js` 的 patch DSH 安装目录能力
- ❌ 直接复制 dsh-purge 的任何源码
- ❌ 为「硬改 DOM」型插件加伪 DOM 钩子（沿用 022 的既定立场）

## 相关

- [022 DSH 插件兼容](./022-dsh-plugin-compat.md)
- [261125-p3vk8w-cuko-plugin-slots](./261125-p3vk8w-cuko-plugin-slots.md)（前置：Cuko 侧边栏插槽）
- [DSH 界面插槽清单](../dsh-ui-slots.md)
- [DSH 客户端包兼容清单](../dsh-client-packages.md)
- [DSH API 覆盖度清单](../dsh-api-coverage.md)
- 外部参考：`C:\d\SourceCode\2027\dsh-purge`、`C:\d\SourceCode\2026\deepseek-harness2`

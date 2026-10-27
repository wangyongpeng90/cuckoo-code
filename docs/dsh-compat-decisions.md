# DSH 插件兼容 —— 关键决策记录

> 本文件固化 2026-10-19 讨论的全部决定，后续开发对照执行。
> 决策原则：**通用兼容**（不只适配 dsh-tasks）、**编译期保护**（Branded Type）、**不糊弄**。

---

## 一、核心架构：两套 Session ID

### 1.1 为什么必须两套

| ID | 来源 | 用途 |
|---|---|---|
| **`logicId`** | 插件生成（如 `dsh-tasks` 的 `session-xxx`）| 插件接口（`ctx.agents` / `agent` / `workspace`）|
| **`webId`** | 网页 AI 生成（URL 里的 `.../s/xxx`）| Cuckoo 内部（`sessionStore` / UI / `handleUrlChange`）|

**根因**：DSH 的 `agents.create` **要求调用方指定 `sessionId`**；Cuckoo 的网页 AI **只能事后从 URL 拿 `webId`**。

### 1.2 两套 ID 的治理（Branded Type）

```ts
type WebId = string & { readonly __brand: 'WebId' };
type LogicId = string & { readonly __brand: 'LogicId' };
```

- **所有 `sessionId: string` 参数改名**：内部用 `webId: WebId`，插件边界用 `logicId: LogicId`
- **翻译层唯一入口**：`src/session/logic-id-map.ts`
- **传错 ID 编译报错**（不是运行时静默 bug）

### 1.3 翻译层接口

```ts
webIdOf(logicId: LogicId): WebId | null
logicIdOf(webId: WebId): LogicId | null
bind(logicId: LogicId, webId: WebId): void
ensureLogicId(webId: WebId): LogicId   // 系统触发：logicId = webId
has(logicId: LogicId): boolean
```

**落盘**：`~/.cuckoo/logic-id-map.json`（全局一张表）

### 1.4 映射生命周期

- **系统触发**：URL 变化（`handleUrlChange`）时 `ensureLogicId(webId)` → `logicId = webId`
- **插件触发**：`create` 时记 pending，网页 id 出现后 `bind(logicId, webId)`
- **清理**：**不做**（Cuckoo 没有"删除会话"逻辑，映射不会变脏）
- **历史数据**：启动时扫描所有 `webId`，补 `logicId = webId`

---

## 二、`dsh-tasks` 兼容（核心）

### 2.1 `agents.create` 的语义

| 项 | 决定 |
|---|---|
| **sessionId** | 必填（插件给的 `logicId`）|
| **行为** | **只开对话**（导航到 AI 首页）+ **记目录**，**不发任何消息** |
| **返回时机** | 等页面 `did-finish-load`（若已在首页则立刻返回）|
| **窗口** | 用 `agentOptions.model` 指定的窗口（= `profile.id`）；没开则**后台打开**（不抢焦点）|
| **已存在 sessionId** | 保持 DSH 行为（报错）|

### 2.2 `agent.followup` 的语义

| 项 | 决定 |
|---|---|
| **首次**（该会话没发过系统提示词）| **合并发**：系统提示词 + 用户消息 |
| **后续** | 只发用户消息 |
| **"已发"判断** | 内存 `Set<webId>`（不落盘；重启后老会话多带一次，无害）|
| **并发** | 串行（一个窗口一次只跑一个对话；忙则排队）|
| **支持已存在会话** | 通过 `ctx.agents.get(sessionId)` 拿到 agent 后 `followup`（追加模式）|

### 2.3 `workspace.attachSession`

| 项 | 决定 |
|---|---|
| **入参** | `sessionId`（1 个，即 `logicId`）|
| **返回** | `Promise<void>` |
| **挂起** | 网页 id 还没出现 → 立刻返回（后台等 URL 变化再绑）|
| **校验** | **不做** DSH 的 `cwd == workspace.path` 校验（Cuckoo 没有独立 workspace 实体）|
| **实质** | 翻译 `logicId → webId`，然后 `saveSessionDirMapping(webId, dir)` |

### 2.4 `workspaceRegistry`

- `list()` / `get(id)` / `workspace.path` / `workspace.title` / `workspace.attachSession` —— **已有 4 个，补 `attachSession` 的翻译**
- **不新增** `detachSession` / `insertSessionBefore` / `status` / `workspaceRegistry.create`

### 2.5 通知

- **复用现有 `show-ai-notification`**（窗口聚焦则跳过；未聚焦则弹通知 + 任务栏闪烁）
- **不区分"定时任务"**（统一"AI任务已完成"）

### 2.6 窗口行为

- **后台开**（不抢焦点，`showInactive`）
- **跑完保留**（不自动关，用户自己关）
- **指定窗口没开** → 后台打开那个窗口

---

## 三、初始化流程改造

### 3.1 触发条件（初始化卡片/覆盖层输入框）

- **判断依据**：**当前会话是否绑定了项目目录**（`sessionId → meta.projectDir`）
- **无会话（新窗口）** → 显示
- **有会话但未绑** → 显示
- **已绑** → 不显示（改目录走"快捷提示词 → 重新项目初始化"）

### 3.2 两种模式的行为

| 模式 | 输入框 | 系统提示词 |
|---|---|---|
| **原版模式** | **覆盖层输入框**（盖住网页原生输入框）| **用户可见**（填进输入框，光标放最后）|
| **纯净模式** | Cuckoo 自己的输入框 | **隐藏**（占位提示"已附加系统提示词"，发送时合并）|

### 3.3 原版模式覆盖层细节

- **盖住**网页原生输入框（用户点到的都是我们的）
- **带"重新选择目录"**小按钮（选错了能重选）
- **等待期间（AI 回复中）**：禁用输入框 + 显示"AI 正在处理…" + **提供"停止"按钮**（转发 `stopGeneration`）
- **绑定成功后**：覆盖层**隐藏**，交还网页原生输入框

### 3.4 绑定时机

| 场景 | 绑定时机 |
|---|---|
| **新窗口（无 sessionId）** | **URL 变化时**（AI 回复后拿到 `webId`）|
| **老会话（有 sessionId、未绑目录）** | **选完目录立刻绑**（`saveSessionDirMapping`）|

---

## 四、实现顺序（排期）

| 批次 | 内容 | 耗时 |
|---|---|---|
| **第 1 批（类型地基）** | 翻译层 + 核心 5 文件 + 27 边缘文件 + tsc 全过 | **1 天** |
| **第 2 批（功能）** | `AgentSession` + `create`/`followup` + 覆盖层输入框 | **2-3 天** |
| **第 3 批（联调）** | `dsh-tasks` 跑通 + 修边角 | **1 天** |

**原则**：**类型先立，功能不回头改**；**不隔夜**接功能。

---

## 五、剩余未确认事项（待讨论）

| # | 事项 | 备注 |
|---|---|---|
| 1 | `ctx.agents.get(sessionId)` 的 Cuckoo 实现 | 返回什么？逻辑 id 还是需要翻译 |
| 2 | `followup` 支持"已存在会话"的完整流程 | 走 `get` + `followup`，还是别的 |
| 3 | 原版模式"填输入框"的 React/Vue 兼容技术 | `nativeInputValueSetter` + `input` 事件 |
| 4 | "AI 首次回复成功"的精确判断 | `harness-event` 的 `status: idle` 够不够 |
| 5 | `dsh-tasks` 的 `turn/end` 监听与映射清理的关系 | 当前决定不清理，待确认 |
| 6 | 排队超时策略 | 两个任务撞同一窗口，排队最长等多久 |

---

## 六、已完成的相关改动（本文件记录前）

- `storageDomain` / `agentDefaultModel` / `connection` 兼容层（`dsh-tasks` + `dshmarket` 跑通）
- `llm` 服务（provider = 平台，model = 窗口）
- `workspaceRegistry` 的 `list` / `get` / `title` / `attachSession`（基础版）
- `fetch` 拦截器动态路由（`plugin-web-routes` IPC）
- `main` 插槽页关闭按钮 + 顶部留白
- DSH 设计令牌（237 个 `--dsw-*`）+ 252 个图标

---

---

## 七、兼容基准版本（钉死）

| 项 | 值 |
|---|---|
| **基准 tag** | `dsh-v0.2.0-rc.2` |
| **基准 commit** | `639ed01539`（Merge PR #5479 from worktree/release-dsh-0.2.0-rc.2） |
| **本地路径** | `C:\d\SourceCode\2026\deepseek-harness2` |
| **检出方式** | `git checkout dsh-v0.2.0-rc.2`（detached HEAD） |
| **钉死日期** | 2026-10-21 |

> 后续所有"DSH 源码证据"都以此版本为准。要升级基准版本，必须在本文件更新记录，并重新核对所有已实现的契约。

---

## 八、`CreateAgentOptions` 契约调研（rc.2 源码证据）

**源码**：`packages/core/agent/src/index.ts:63-119`

### 8.1 字段清单（共 9 个：1 必填 + 8 可选）

| # | 字段 | 类型 | 必填 | 用途（源码注释摘要） |
|---|---|---|---|---|
| 1 | `sessionId` | `SessionId` | ✅ | 会话/Agent 唯一身份（第 64-65 行） |
| 2 | `parentAgent` | `Agent` | ❌ | 运行时父 Agent；根 Agent 省略（第 66-67 行） |
| 3 | `meta` | `{ cwd?, parentSession?, isSeeded?, origin?, delegationDepth?, agentPreset? }` | ❌ | 会话创建元数据（第 68-86 行） |
| 4 | `inheritedEventCount` | `SessionLogOffset` | ❌ | `isSeeded=true` 时必填的 fork 继承前缀长度（第 87-88 行） |
| 5 | `seed` | `readonly SessionEvent[]` | ❌ | 初始 replay/fork 历史事件（第 89-95 行） |
| 6 | `agentOptions` | `AgentOptions` | ❌ | 每个 Agent 的模型/推理等配置（第 96-97 行） |
| 7 | `signal` | `AbortSignal` | ❌ | 仅用于创建期的取消信号（第 98-99 行） |
| 8 | `setup` | `AgentSetup` | ❌ | 创建期组合回调（挂载 scoped 工具/prompt sections 等）（第 100-118 行） |

### 8.2 `meta` 子字段（共 6 个，全部可选）

| 子字段 | 类型 | 用途 |
|---|---|---|
| `cwd` | `string` | 已验证的绝对工作目录 |
| `parentSession` | `SessionId` | fork 血缘（从哪个会话 fork 出来） |
| `isSeeded` | `boolean` | fork 标记（配合 inheritedEventCount 使用） |
| `origin` | `'subagent'` | 粗粒度来源分类 |
| `delegationDepth` | `number` | 递归深度预算（防止无限子代理） |
| `agentPreset` | `string` | Agent 预设名称 |

> ⚠️ 不含 `createdAt`——这是 `CreateSessionOptions.meta` 独有的（内部重建持久化会话时用），factory 调用方永远不设置（第 73-75 行注释明说）。

### 8.3 关联类型（源码证据）

**`AgentOptions`**（`packages/core/agent/src/runtime-types.ts:26-35`）
```ts
export interface AgentOptions {
  provider?: string         // Provider 路由（调用时须已注册 adapter）
  model?: string            // 由选中的 provider adapter 解释的 model id
  reasoningEffort?: ReasoningEffortId  // adapter 拥有的推理强度
  maxTokens?: number        // 每次对话-模型请求的最大输出 token
}
```

**`AgentSetup` / `AgentSetupCommit`**（`index.ts:37-54`）
```ts
export interface AgentSetupCommit {
  commit(): void   // 发布前的同步提交/校验
}
export type AgentSetup = (
  agentCtx: Context,
  agent: Agent,
) => AgentSetupCommit | Promise<AgentSetupCommit | void> | void
```
> **Setup composes, it never drives**（第 114 行）：setup 只负责组合作用域，不驱动 Agent。驱动必须在 `createAgent` resolve 之后。

**`AgentHandle`**（`index.ts:160-163`）
```ts
export interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

**`Agent`**（`packages/core/agent/src/types.ts:15-18`）
```ts
export interface Agent {
  readonly id: SessionId   // 公开面只有 id，其余能力由 runtime face 增强
}
```

**`SessionLogOffset`**（`BrandedNumber<'SessionLogOffset'>`，见 `api-catalog.ts:6662`）
> 一个被打上 brand 的数字类型，用于区分"偏移量"和普通数字。

---

## 九、`ctx.agents` 服务兼容决策（基于 dsh-tasks 最小兼容）

> 基准版本：`dsh-v0.2.0-rc.2`（见第七章）
> 原则：只实现 `@weibaohui/dsh-tasks` 实际用到的能力，其余字段接收但忽略

### 9.1 `create` 只落库，不导航、不发消息

**决策**：`ctx.agents.create(options)` 在 Cuckoo 里只做「往 SQLite `sessions` 表写一行」，**不打开网页、不发送任何消息、不等 `webId`**。

**依据**：DSH 源码 `agent-loop/src/index.ts:714-751` 的 `createAgent` 只做 prepare + 落盘 + setup + publish，全程无消息发送；`dsh-tasks` 的 `execute()`（`_dsh-tasks.js:450-529`）也是 `create` 之后才调 `followup`。

**收益**：彻底解耦「创建会话」和「驱动 AI」，绕开 `create` 时拿不到 `webId` 的时序矛盾。

### 9.2 `meta.cwd` 严格校验绝对路径

**决策**：`meta.cwd` 传了（非 `undefined`）时，必须是字符串且为绝对路径，否则 `throw`；没传则 `project_dir = null`（不绑目录）。

**依据**：DSH `packages/core/session/src/index.ts:116-119` 对 header `cwd` 的校验规则（非 string / 非 absolute 都 throw）；`1049-1059` 显示 `cwd` 缺省时 header 里无此字段。

**收益**：避免「静默忽略相对路径 → 后续 attachSession 才报错」的难查问题。

### 9.3 `setup` 必调，`agentCtx` 最小实现

**决策**：`create` 内必须调用 `options.setup(agentCtx, agent)`（若提供）。`agentCtx` 最小实现：
- `get(name)` → `undefined`
- `plugin()` → 返回空 disposer（防插件调 `plugin` 时崩溃）
- `effect(fn)` → 执行 `fn`，返回空 disposer

**依据**：DSH `setupAndPublish`（`agent-loop/src/index.ts:774-779`）在 publish 前调 setup；`dsh-tasks` 的 setup（`_dsh-tasks.js:475-484`）依赖 `ctx.get('agentPresets')`，且有防御性判断。

**收益**：契约对齐；将来实现 `agentPresets` 时只需改 `agentCtx.get` 的返回值，`create` 逻辑不用动。

### 9.4 `agentPresets` 选 C-light（诚实映射现状）

**决策**：`ctx.get('agentPresets')` 返回一个最小服务：
- `resolve(id?)` → `{ id: id ?? 'default' }`（永不 throw、永不带 broken）
- `mount(agentCtx, id?)` → `{ id: id ?? 'default' }`（空操作，因为 Cuckoo 默认全量工具）

**依据**：
- DSH 的 preset = Cordis 子插件树（`definition.ts:10`）；Cuckoo 无 Cordis，工具是编译时全量注入（`src/tools/impl/*` + `buildPrompt`）
- `dsh-tasks` 永远 `resolve(undefined)`（`_dsh-tasks.js:480`），从不指定自定义 preset
- Cuckoo 现状「所有会话 = 全量工具」，与 DSH「默认 preset = 标准工具集」语义等价

**拒绝 C-full 的理由**：
- C-full 需要 Cuckoo 新增一整套 preset 概念（工具池清单 / preset 持久化 / 提示词按 preset 过滤 / 会话级选择 / UI 入口 / **插件工具与 preset 的关系**）
- 最后一点是 Cuckoo 独有难题（DSH 无此问题，因插件工具与 preset 同属 Cordis 机制），需独立产品设计
- 这属于「新增产品能力」，不属于「兼容任务」

**升级路径**：C-light 是 C-full 的特例。将来若真需要多套工具集，只需把 `resolve` / `mount` 换成真实实现，`create` 侧无需改动。

### 9.5 `workspaceRegistry` 必须升级为持久化注册表

**决策**：新建 SQLite `workspaces` 表（`id` uuid / `path` 规范化绝对路径 / `title` / `created_at` / `session_order` / `archived`），提供 `create` / `get` / `list` / `delete` / `insertBefore` 全套；工作区不再从 session 的 `project_dir` 动态聚合。

**依据**：
- DSH `workspace/src/index.ts:236-242` 的 `create`：`realpathNormalize` → `stat isDirectory` → 写入注册表，重复调用幂等
- DSH `WorkspaceId` 是 uuid（`types.ts:13-16`），与 `path` 分离（path 会被规范化重写，id 必须稳定）
- DSH `attachSession`（`entity.ts:109-149`）依赖 workspace 记录里维护 `sessionIds` 数组
- Cuckoo 现状（`loader.ts:371-401`）：每次 `list()` 现扫 `projectDir` 去重，**空目录（无 session）根本不出现在列表中**，导致 `dsh-tasks` 配置的 `workspaceId` 找不到工作区而报错
- 安全考虑：DSH 「唯一路径是用户选目录」（`.agents/notes/.../2026-07-31-one-route-to-add-a-workspace.zh.md:10-16`）防止插件恶意查看用户目录；Cuckoo 应对齐

**收益**：`get(id)` 不再有「空工作区找不到」的盲区；`attachSession` / `insertSessionBefore` 有真实载体；目录被重命名/移动时 `id` 不受影响。

### 9.6 `workspace.attachSession` 完整对齐 DSH 五道校验

**决策**：按 DSH `entity.ts:109-149` 完整实现五道校验 + 一次前插写入。

**校验顺序**：
1. **幂等**：若 `sessionIds` 已含该 sessionId → 直接返回（不校验、不重写）
2. **header 有 cwd**：无 cwd → throw `carries no cwd to validate against`
3. **cwd 可解析**：`realpathNormalize(cwd)` 失败 → throw `does not resolve`
4. **cwd 是目录**：`stat(cwd).isDirectory() === false` → throw `is not a directory`
5. **cwd === workspace.path**：不一致 → throw `resolves to 'xxx'`

**写入方向**：往 `workspace.sessionIds` **前插**（不是往 `session.project_dir` 覆盖）。

**前置依赖**：必须先完成 9.5（workspace 持久化注册表），否则无 `workspace.path` 和 `sessionIds` 可对比。

**连带修复**：`create` 阶段存 `meta.cwd` 前应先 `realpathNormalize`，否则 symlink / 大小写差异会导致第 5 道校验失败。

### 9.7 `session.append` 补错误传播

**决策**：保留现状（只处理 `session/title`，静默忽略其它 type），但补充错误传播——`host.setSessionTitleForId` 失败时 `throw`。

**依据**：
- `dsh-tasks`（`_dsh-tasks.js:493-503`）只调 `session/title`，用 `try-catch` 兜住错误
- Cuckoo 现状（`agents-service.ts:192-199`）在 `host.setSessionTitleForId` 未实现时静默跳过，dsh-tasks 误以为成功
- 补 throw 让失败暴露（dsh-tasks catch 兜住，至少日志可见）

**不做的事**：
- ❌ 补类型校验（`title` 非空 / `messageSeqs` 数组 / `source.kind` 合法）：dsh-tasks 传的永远合法，校验空转
- ❌ 实现完整 `SessionEvent<T>` 返回 + deepFreeze + JSON 快照：Cuckoo 无 Session log 概念，dsh-tasks 不用返回值

### 9.8 队列的 3 个已知缺陷 + 压缩冲突（均记 TODO，暂不修）

**来源**：`agents-service.ts` 的 `state.queue` 是 `4731e13` 提交为兼容 DSH 的 `Inbox` 而引入的（非 Cuckoo 原生需求）。以下 4 个问题**均暂不处理**，等真正做「队列系统」时一并解决。

#### 缺陷 1：`busy` 只靠 `assistant-done` 解锁

**问题**：`onAssistantDone()` 是唯一解锁点。AI 报错 / 页面崩溃 / 网络断时，`assistant-done` 不来 → `busy` 永久卡死。

**决策：不修。** 交给现有的**重试引擎**（`src/bridge/loop/retry.ts`）兜底。重试机制会在 `onAiError` 后自动重新投递消息，最终一定会触发 `assistant-done`。如果重试也失败，那是重试机制的缺陷，应修重试机制而非在 agents-service 层加兜底。

#### 缺陷 2：发送后未出队，崩溃时可能重复发送

**问题**：`processQueue` 的时序是 `sendUserMessage() → queue.shift() → setSessionQueue([])`，三步同步。若在中间崩溃，重启后 `restorePendingQueues` 会把已发送的消息重新入队 → 重复执行。

**决策：不修。** 理由：
- 触发概率极低（微秒级同步窗口，只有强制 kill / 蓝屏 / 断电才可能）
- 如果改成"先出队再发送"，问题会从"重复发送"变成"丢失消息"——**丢失比重复更糟**（重复可察觉、可纠正；丢失是静默失败）
- 真正做到原子性需要事务，但 `webContents.send` 无法事务化

#### 缺陷 3：队列无超时

**问题**：若 AI 长时间不回复，队列后续任务永久等待。

**决策：不修。** 理由：
- 用户已提供**"卡住了点我"快捷提示词**作为兜底（用户主动点一下，AI 就继续了）
- 现有 watchdog（SSE 流静默检测）+ retry 引擎已覆盖大部分场景
- 真正的超时值无法合理设定（设 5 分钟，AI 可能 6 分钟才回复）

#### 压缩冲突：`compaction.ts` 与 `agents-service` 完全隔离

**问题**：`src/session/compaction.ts` 与 `agents-service` 无任何交叉引用。压缩时会刷新页面 + 创建新会话，导致：
1. `assistant-done` 不来 → `state.status` 永久 `busy`
2. 摘要指令污染 dsh-tasks 的半成品任务
3. `logicId` 血缘断裂（旧 `session-xxx` 未跟着迁移到新会话）

**决策：不修。** 理由：
- 压缩是**低频事件**（通常 50-60 万 token 耗尽才触发，用户手动或自动）
- dsh-tasks 的定时任务通常很短（几分钟内完成），撞上压缩的概率极低
- 等真正做「队列系统」时一并处理

---

### 9.9 会话 ID 生命周期：废除临时 ID，无 webId 即无会话

**背景**：`aae0435` 为实现「首页无 webId 时也能绑目录/设标题」，引入了「新窗口立刻生成 `local-xxx` 临时 ID 并落库」的设计。真机验证发现这带来一系列连锁问题：

1. 数据库堆积大量 `web_id=null` 的垃圾记录（永不清理）
2. 压缩/新建时反复复用旧 `logicId`，产生"父子指向自己"的死循环数据（前端展开压缩历史时刷出 50 条重复）
3. `currentSessionId` 作为内存状态，与真实 URL 脱节后极难排查

**决策**：**废除 `local-xxx` 临时 ID**。

- **没发消息 = 没会话**：窗口创建时不生成任何临时 ID，不落库
- **无 webId 页面 = 无当前会话**：`handleUrlChange` 遇到无 `webId` 的页面（首页 / 分享页 / settings 等）立刻清空 `currentSessionId` 为 `null`
- **有 webId 才落库**：发消息产生真实 `webId` 后，通过 `ensureLogicId(webId)` 创建记录（此时 `logicId === webId`）
- **加号纯导航**：壳页面 / 工作区 / 纯净模式的「+」只做 `loadURL(homeUrl)`，不重置任何状态。工作区「+」额外带 `?cuckoo-project-dir=xxx` 让遮罩层填好目录
- **插件驱动例外**：URL 带 `?cuckoo_logic_id=xxx` 时由插件指定 `logicId`，属合法场景

**权衡**：用户在首页选了目录但还没发消息就刷新页面，目录会丢（存内存不落库）。这是有意的——会话尚未真正建立，不该产生持久化记录。用户重选一次目录的成本，远低于垃圾数据和 ID 混乱的维护成本。

---

*最后更新：2026-10-26*

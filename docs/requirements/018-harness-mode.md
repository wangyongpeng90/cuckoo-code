---
id: 018
type: feature
title: 纯净对话模式（Harness 模式，类 Codex 体验）
status: doing
branch: feat/017-harness-mode
created: 2026-09-29
updated: 2026-10-02
---

## 背景

现有 Cuckoo Code 直接展示 AI 网页 + 覆盖层。用户在界面上会看到系统提示词、工具执行结果回传、格式纠正提示等"底层对话指令"，体验偏向开发者面板，而非纯粹的对话。

希望提供类似 Codex 等主流 harness 的体验：一个只保留「用户 ↔ 模型」对话与工具调用记录的纯净界面，隐藏所有底层指令。

## 目标

- 新增"纯净模式"：在**同一窗口内**切换到类 Codex 的对话界面（AI 网页退居后台）
- 只显示三类内容：① 用户消息 ② 模型文本回复 ③ 工具调用卡片（含执行结果）
- 不显示：系统提示词、工具结果回传消息、JSON/XML 格式纠正提示等一切"底层指令"
- AI 网页继续在后台正常运行（hook 拦截、工具循环照旧）
- **与官方源码解耦**：新增代码集中在独立文件；对官方文件的改动仅限少量向后兼容新增

## 方案

### 总体

在现有窗口内增加一个覆盖式 \`WebContentsView\`（harness view），承载纯净 UI 页面，默认隐藏，盖在 AI 网页之上。AI 网页 bounds 不变、继续运行，仅被遮挡。

入口：
- 快捷键 \`Ctrl+Shift+H\`（AI 页面 / harness 页面 / 壳页面 内均可触发切换）
- 菜单「查看 → 纯净对话模式」
- harness 页面内「网页模式」按钮

### 新增文件（独立，尽量零耦合）

| 文件 | 职责 |
|---|---|
| \`src/ui/harness.html\` | 纯净对话流页面（Codex 风格，内联 CSS/JS，无外部依赖） |
| \`src/app/harness-preload.ts\` | harness 页面 preload，暴露 \`window.harnessAPI\` |
| \`src/bridge/harness-bridge.ts\` | bridge 侧：上报 AI 回复/工具调用、接收用户消息 |
| \`src/app/ipc/harness.ts\` | 主进程 IPC：发送、事件中转、显隐切换 |

### 对官方文件的改动（全部为向后兼容的新增）

| 文件 | 改动 |
|---|---|
| \`src/app/entry.ts\` | 创建 harness view + 布局 + 快捷键 + 菜单项 |
| \`src/app/ipc/index.ts\` | 注册 harness IPC（2 行） |
| \`src/bridge/entry.ts\` | import 并调用 initHarnessBridge（2 行） |
| \`src/bridge/intercept/observer.ts\` | 新增可选 \`onToolCall\` 回调 + 导出（约 20 行，无监听者时零开销） |

### 数据流

\`\`\`
用户输入(harness) → harness-send(IPC) → 主进程 → AI view.send('harness-user-message')
  → bridge/harness-bridge → sendToChat() → AI 网页

AI 回复 → hook → observer → onInterceptedResponse
  → bridge/harness-bridge(去工具代码块) → harness-event-report(IPC) → 主进程 → harness view.send('harness-event')

工具执行 → observer.emitToolCall(新增回调) → bridge/harness-bridge
  → harness-event-report(IPC) → 主进程 → harness view.send('harness-event')
\`\`\`

### 纯净性保障

系统提示词、工具结果回传、格式纠正提示均由框架经 \`sendToChat\` 发出，**不经过 harness 记录**；harness 只记录自己输入的用户消息、AI 回复（剥离工具代码块后）、工具卡片，故底层指令天然不显示。

### 关键决策

- **方案 A（允许少量向后兼容新增）而非方案 B（纯监听 DOM）**：把数据通道固定为稳定的回调契约（\`onToolCall\`），而非耦合 DOM id / 事件名，官方重构时更不易失效。代价仅是一个可选回调。
- **方案 ①（同窗口覆盖视图）而非独立窗口**：复用 provider/session/partition，切换即时，布局改动小。

## 验收标准

- [x] 可切换到纯净模式，显示 Codex 风格对话流
- [x] 用户消息、模型回复、工具调用卡片正确显示（数据链路实现完成）
- [x] 系统提示词、工具结果回传等底层指令不显示
- [x] AI 网页后台照常工作，工具循环正常
- [x] 可切回网页模式
- [x] typecheck / test / lint / compile 全通过

## 后续迭代（2026-09-29 同日）

### 流式输出 + 思考过程

初版只显示最终回复（hook 仅在结束时派发一次）。为对齐主流 harness 体验，补充：

- **hook 新增流式事件** \`cuckoo-ai-stream\`（deepseek/claude/chatgpt 三平台，纯新增，节流 80ms）
  - deepseek：暴露已有 \`thinkText\`；claude：新增捕获 \`thinking_delta\`
  - \`dispatchStream(think, text, finished)\`，text/think 均为全量快照
- **observer 新增 \`onStream\` 回调**（向后兼容，无监听者零开销）
- **harness-bridge** 上报 \`stream\` 事件；完成时发 \`assistant-done\`
- **UI**：流式渲染 + 光标；思考过程折叠块（正文出现后自动折叠，可手动展开）

### UI 重做（Claude Code 风格）

- 暖色强调（#d97757）、深色极简、助手消息无气泡（前缀标记 + 正文）
- 工具卡片：名称 + 参数 + 状态徽章，成功自动折叠
- 全部图标为内联 SVG（无 emoji）

### Goal / Plan 与输入增强（迭代三）

- **Goal（目标）**：输入 /goal 目标文本 设定 → 顶部目标条（目标 + 状态灯 + 轮数 + 计时 + 暂停/退出）
  - 自动多轮推进：AI 纯文本回复结束约 3 秒内无工具调用/新流式 → 自动发送"继续推进"；有工具调用的轮次由工具循环自然推进，不催促
  - 终止条件：AI 调用 `goalDone()` 工具（主进程直接向 harness 视图上报 goal-done）/ 达到设置的最大迭代次数 / 连续多轮无进展 / 手动停止（停止生成亦一并退出目标）
    - 旧版曾用"回复末尾输出 [[GOAL_DONE]] 文本标记"判定完成：靠模型自律，漏输出则目标永不收束，只能靠无进展兜底停表，已废弃（工具调用是结构化动作，界面有卡片留痕）。
  - 目标状态持久化（localStorage），刷新/重开不丢
- **目标条交互（迭代四，对齐 DSH 的目标语义）**
  - **修改**：目标描述本身就是输入框，**就地编辑**（Enter 提交 / Esc 撤销 / 失焦提交），沿用已跑轮数与已用时间，不重置进度、不额外催一轮。（旧版 `window.prompt` 在 Electron 中直接抛 `prompt() is not supported.`，必然无效，已删除该按钮。）
  - **暂停**：立即中止当前任务（清掉待发自动续跑 + `harness-stop` 停掉 AI 页面当前生成/工具循环），计时冻结
  - **继续**：立刻接着推进（重启自动续跑计时 + 恢复计时）
  - **退出**：立即终止当前任务并清除目标
  - 目标文本展示统一剥离 `[目标]`/`[计划]` 展示标签，输入框里只留纯目标描述
- **斜杠菜单**：动作项版式对齐 DSH —— 图标 + 中文名 + 英文标识 + 右侧说明（`文件 file`／`目标 goal`／`计划 plan`），中文名与英文标识都能被过滤词命中（`/g` 直接命中 `目标 goal`），不再出现"只写中文名、看不出命令叫什么"的问题；技能/工具项共用同一版式（图标 + 等宽名 + 右侧说明）
- **`/goal` 无参数**：有目标时输出当前目标详情（文本 / 状态 / 迭代轮数 / 用时），无目标时输出用法，对齐 DSH「设置或查看」语义
- **Plan（计划）= 确认闸门**（迭代六，定位修正）：`/plan <任务>` 后在 harness 层进入**三态状态机**，与 goal 的"自动推进"语义完全不同
  - **草拟 draft**：只发"列出计划条目、不要执行任何任务、输出后停下等确认"的指令；首轮指令明确禁止执行
  - **待确认 confirm**：模型产出计划条目 → 计划面板**编号渲染（1. 2. 3. …）**并高亮"待确认"，此时 harness **绝不自动续跑**（`scheduleGoalNudge` 只认 `phase === 'exec'`），完全停下等用户点「执行」
  - **执行 exec**：用户点「执行」后才进入，此时才有自动续跑；每轮指令要求模型用 todoWrite 逐项标记 completed / in_progress
  - **完成 done**：全部步骤 completed 自动收尾；执行中「暂停」= 立即中止并**退回待确认**（要重新确认才继续）；「退出」= 中止任务 + 清空状态与条目
  - 面板控制：状态灯（生成计划中 / 待确认 / 执行中 / 已完成）+ 计数 + 迭代轮数 + 计时 + 「执行」「暂停」「退出」
  - 计划条目按会话隔离并持久化（`cuckoo-harness-plan-v1`），刷新/切会话不丢
  - **计划 JSON 的正确处置（迭代七，按协议修正）**：模型常不调用 `todoWrite`，而是把 `{"todos":[...]}` 当**正文**直接输出（实测样本：12 条计划 + "请确认该计划"）。此时 `__cuckooTodos` 为空 → 主进程不推 `plan` 事件 → 面板停在"生成计划中"、没有执行按钮。**根因在提示词层，不在 UI 层**：
    - 本项目原生工具调用协议是 **cuckoo 代码块**（`src/prompt/default.md`：工具调用必须写成 ```cuckoo 块，块外不要有文字），`todoWrite` 是 JS 沙箱里的全局函数（`globalThis.todoWrite`，见 `todo-write.ts`），**裸 JSON 正文根本不会被执行**。bridge 的 `stripToolBlocks` 已经在剥 ```cuckoo/js 块，这条通道无需任何 UI 支持。
    - 因此 `buildPlanSendText` / `nudgeSendText` **显式给出 cuckoo 写法示例**，并明确"不要把计划以 JSON 正文或 ```json 块输出"，把模型引回原生通道。
    - UI 层只保留**结构化识别**（`tryParseTodoJson`）：草拟阶段偶尔收到裸 JSON 时，认成计划条目让面板仍可用。**不修改、不屏蔽正文** —— 曾被误屏蔽的正文（用户要一份 todos JSON、生成示例、调试）一律原样显示；非计划模式下该识别完全不触发。
  - **模型索要信息时停止催跑**（`blocked` 阶段）：模型回复「需要你补充…」「无法继续推进」这类**合理阻塞**时，原实现仍每 3 秒无条件催"继续执行"，把模型的正确判断当故障，回复被刷成重复索要。现在 `asksForUserInput` 识别索要输入句式 → 进入 `blocked` 阶段：停表、停止自动续跑、状态显示「等待你的输入」，主按钮变「继续」；用户补充信息后点「继续」即恢复执行（保留原轮数）
  - 修正的旧缺陷：`/plan` 斜杠项此前把提示语塞进隐藏指令（无 `isPlan` 标记），根本不触发计划模式；`planAutoEnabled` 默认开导致任何对话只要写过 todo 就无限自动续跑；`renderPlan` 在无条目时直接隐藏面板，计划模式开着却看不到状态；设置弹窗 JS（`settingsMask`/`openSettings`/`closeSettings`）整块缺失而末行仍引用未定义变量，导致初始化从此行中断（`scrollBtn` 绑定、`input.focus()`、`api.ready()` 均不再执行）
- **运行中判定统一为 `isBusy()`**（迭代五）：`generating || toolRunningCount > 0`
  - 工具执行期间任务并未结束，发送按钮、进度条、Enter 守卫、忙状态通知全部按此判定；原先只看 `generating`，工具一跑起来（`assistant-done` 已把状态置就绪）按钮就退回发送箭头，且 12 秒静默兜底还会把长 bash 误判为"卡死"
  - 12 秒静默兜底加 `toolRunningCount === 0` 前置条件：工具执行中不算静默
  - 中止（停止 / 暂停 / 退出）引入**任务代次**抑制（`abortEpoch`/`abortStamp`，非墙上时间窗）：中止后迟到的 `tool-end` / `status(busy)` 不得把按钮重新点亮；用户发起新任务或自动续跑时认领代次，忙碌判定立即恢复
  - `tool-start` 期间只渲染卡片不置忙（抑制态），`onAssistantDone` 在仍有工具执行时保持"工具运行中…"
- **Plan（计划）**：复用官方 todoWrite 工具，bridge 从工具代码解析 todos 上报 → 顶部可折叠计划面板（pending/in_progress/completed 三态图标 + 进度条），随对话历史恢复
- **斜杠菜单**：↑/↓ 键盘导航、Enter 选中、按输入内容过滤（动作/技能/工具统一匹配）
- **流式修复**：bridge 对未闭合的 cuckoo/js 代码块（流式输出中途）从开标记起隐藏，不再闪现工具代码

### 框架侧投递的运行态反馈（2026-10-01）

- **问题**：系统提示词、工具结果回传（JS汇总）、看门狗催继续、失败重试、上下文压缩等消息都经 `sendToChat` 由框架自动发往 AI 页面，**harness 页面完全不知情** —— 界面停在"就绪"、发送键还是箭头，用户会往正在跑的会话里插话；静默兜底还会把这类长任务（压缩可等待 120 秒）误判成已结束。
- **做法**（内容不显示，只反馈状态）：
  - `chat-input` 新增 `onMessageDelivered` 回调：**所有**经 `sendToChat` 的投递都派发（含系统内部消息，带 `isSystem` 标记）；系统提示词走独立的 `sendInitialPromptToInput` 路径，也在投递点补派发。`isSystemTag()` 从原 `SYSTEM_MSG_TAGS` 内联判断抽成函数，飞书上报与"用户消息"语义保持不变。
  - `harness-bridge` 订阅并上报 `framework-send`（`tag='harness'` 的用户消息不上报：气泡已显示，状态机自管）。
  - harness 收到后进入运行态：状态栏显示来源（如"框架：工具结果回传"），发送键切停止态，刷新活动时间；并开一个框架驱动窗口（150 秒）让静默兜底不误判。内容**不进对话流** —— 底层指令本就不该显示。
  - `onStream` 补兜底：未收到投递事件但确实在出字时同样置忙（`finished` 帧除外，收尾交给 `assistant-done`）。
  - 静默兜底收尾改用 `clearPendingBubble()`（只清空占位气泡），避免永远转圈。

### 删除上报门控 + 权威生成状态心跳（2026-10-01，最终定位）

- **症状**：对话流**空白**（只有一个转圈的占位气泡），发送键却停在停止态、状态显示运行中，且永不恢复。
- **根因（截图证据链）**：占位气泡来自 `framework-send`，而那条是**主进程直推**（不经过 AI 页面 bridge）；
  bridge 上报的**每一条**都过 `enabled` 门控 —— 门控一旦判断错（AI 页面导航/重载重建 preload 丢广播、
  查询通道失败、切换时序竞态），流式文字、回复正文、工具卡片、终态信号**被整体静默丢弃**。
  于是界面既没有内容、也没有终态，只剩主进程直推的那一条把状态钉在运行中。
- **教训**：曾两次尝试给门控打补丁（启动时主动查询 `harness-is-enabled` + 导航时重发 `harness-mode`），
  都是治标——**只要门控存在，"判断错一次就整片哑掉"这个性质就还在**，而且丢弃是静默的，排查成本极高。
- **最终做法**：
  1. **删除上报门控**：bridge 一律上报。主进程在没有 harness 视图时本就会丢弃；代价只是没用纯净模式时
     多几次 IPC（流式事件上游已按 80ms 节流），换掉一整类"哑界面"故障是划算的。
     同时清掉配套死代码：`harness-mode` 下发、`harness-is-enabled` 查询通道。
  2. **新增权威生成状态心跳 `ai-state`**：bridge 维护"AI 页面是否正在生成"（由 hook 事件驱动：
     流式输出/消息投递 → 生成中；无工具调用的回复完成 / `task-idle` / 请求失败 / 停止信号 → 已停止），
     **变化即时上报 + 每 2 秒心跳**（harness 页面可能在生成中途才被创建/刷新，只报变化会拿不到当前状态）。
     harness 据此校正：判定"已停止"且界面已静默 ≥6 秒 → 收尾（归就绪、清零工具计数、清驱动窗口、清占位气泡）。
     静默期保护用于避开"刚投递消息、bridge 尚未置忙"的填充/随机延迟窗口，防止退回"网页在跑、界面却停了"。
  3. **常规终态仍走 `task-idle`**（`observer` 判定"回复里没有工具调用 = 本轮结束"），心跳只是兜底校正。
  4. 兜底超时**有界**（框架窗口 120 秒 / 窗口外静默 60 秒）+ 工具计数泄漏自愈（防 `tool-end` 丢失永久卡住）。

### 用权威终态信号收尾，取代超时猜测（2026-10-01）

- **症状（反向）**：网页早已答完，纯净模式仍显示"运行中"——发送键停在停止态，用户发不出消息。
- **根因**：harness 一直**靠超时猜"是否结束"**，且容忍度被放得过大（框架驱动窗口内直接跳过兜底 + 5 分钟"保持运行态"档）；
  `tool-end` 还会**无条件**重新置忙，收尾事件一旦丢失就再也回不来。
- **修法**：`observer` 早在判定"回复里没有工具调用 = 本轮任务结束"时会派发 `emitTaskIdle()`（原先只喂给自动压缩），
  这正是"网页真的做完了"的权威信号 → bridge 上报 `task-idle` → harness 收尾；
  `tool-end` 不再无条件置忙；兜底回归"只兜事件丢失"且有界。

### 门控重载丢失修复（2026-10-01，已被上一节的"删除门控"取代）

- **症状**：选择项目目录后网页正常发送系统提示词、网页侧显示"正在回复中"，纯净模式却停在"就绪/已停止"。
- **根因**：`harness-bridge` 的 `enabled` 只在**切换纯净模式那一刻**由主进程下发一次。AI 页面每次导航
  （如首次对话后从首页跳到 `?cid=...` 会话页）或整页刷新都会重载 preload、重建 bridge，`enabled` 回到初值 `false`
  → **所有上报被静默丢弃**。
- **当时的修法**：主动查询 + 导航时重发广播（三层兜底）。**结论：治标不治本，最终改为直接删除门控**（见上）。
- **保留的有效改动**：`initial-prompt` 由主进程直接发给 AI 页面（不经 bridge），此刻页面可能正在导航、
  bridge 未就绪，故 `project-context` 同时由主进程直接向 harness 推 `framework-send`（幂等，重复上报无害）。

### 静默兜底的定位收敛（2026-10-01）

- **问题**：原兜底"12 秒无事件 → 重置为就绪"会在模型首个 token 延迟较久时（超长系统提示词、长思考）把**正在回复**的会话显示成"就绪"，用户以为停了。
- **收敛结论**：单纯放宽超时只是把问题推到另一头（放太宽就变成"网页答完还显示运行中"）。最终定位：
  **结束判定交给权威信号 `task-idle`**（见上一节），兜底只负责"事件丢失"这一种异常，且有界
  （框架窗口 120 秒 / 窗口外静默 60 秒即复位）。工具执行中不计静默。

### 新对话残留修复（2026-10-02）

- **症状**：点「新对话」后界面满是残留 —— 消息流、计划、目标、附件都还在。
- **根因（两处，缺一不可）**：

  1. **壳页面侧栏的「新对话」按钮完全没通知 harness。**
     `web-new-conversation` 只做了 `loadURL(平台首页)`；而 harness 是**独立的 WebContentsView**，
     AI 网页换了会话它毫不知情。（harness 页面自己的清空按钮走 `harness-new-conversation`，
     那条路有清理 —— 两个入口行为分叉，正是"有时清有时不清"的来源。）

  2. **即便走到 harness 自己的清理，也是半吊子。**
     原先只有 `clearHist()`，仅清 `history` / `stream` / `cur` 三样；
     另一条清理路径 `onSessionChanged` 也没清附件、提示、工具计数。
     而它的首行是 `if (sid === currentSessionId) return;` ——
     新对话落到平台首页时 URL 没有会话 id，sid 是**空串**，极易命中早退，于是**什么都不做**。

- **修复**：
  - 主进程新增独立事件 `reset`（`notifyHarnessReset`）与公共前置 `prepareNewConversation`，
    **两条入口共用**。不复用 `session-changed`：新对话是"丢弃"，切换会话是"按 session 存取"，
    语义不同就必须有不同的事件。
  - harness 侧把两个半吊子函数合并为**唯一**的重置路径：
    `clearTransientState()`（跨会话临时状态，两条路径共用）+ `resetConversation()`（完整重置换新对话）。
  - **`resetConversation()` 把 `currentSessionId` 归零**并 `saveHist()` 写入空历史。
    这是关键：否则随后到达的 `session-changed('')` 会把旧记录 `loadHist()` 回来，等于白清。
    （旧会话的历史本就随 `pushHist` 存在它自己的 key 下，切走不会丢。）

- **守卫**：`test/app/new-conversation.test.js` 钉住"两条入口都必须调用公共重置"这条不变式。
  已验证有效 —— 去掉 `web-new-conversation` 里的重置，该测试会失败。

## 遗留 / 后续

- 对话往返的真机端到端验证需在**已登录 AI 平台**的会话中进行（dev 隔离 profile 未登录，仅验证到页面加载与渲染）。
- 工具卡片目前按"最近一张未完成卡片"匹配 start/end，若并发多工具可能需更精确的 callId 关联（当前 observer 逐块执行，实际为串行，无影响）。
- AI 回复为空时：`assistant-done` 仍会到达并把状态收尾为就绪（空回复不渲染气泡），已不再是悬留点。

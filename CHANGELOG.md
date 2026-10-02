# Changelog

## [Unreleased]

### Fixed
- **纯净模式：对话流空白 + 状态永久卡在运行中**（根因定位后重做）：此前 bridge 的上报受"纯净模式开关"
  门控，一旦门控判断错（AI 页面导航/重载重建 preload 丢广播、查询通道失败、切换时序竞态），
  流式文字、回复正文、工具卡片、终态信号会被**整体静默丢弃**——界面只剩主进程直推的那条框架投递，
  于是既没有内容、状态又永远收不了尾（实测截图：只有一个转圈的占位气泡 + 停止键）。
  现在：
  - **删除上报门控**（不再给门控打补丁，直接消除"判断错一次就整片哑掉"这个性质）；
    主进程在没有纯净模式视图时自会丢弃事件，代价只是多几次 IPC
  - **新增权威生成状态心跳 `ai-state`**：AI 页面维护"是否正在生成"（由 hook 事件驱动），
    变化即时上报 + 每 2 秒心跳；纯净模式据此校正运行态，判定"已停止且静默 ≥6 秒"即收尾
    （含清零工具计数，兼治 `tool-end` 丢失导致的永久卡死）
  - 清理配套死代码：`harness-mode` 下发与 `harness-is-enabled` 查询通道
- **纯净模式：网页答完仍显示"运行中"**：收尾此前全靠超时猜，容忍度被放得过大
  （框架驱动窗口内直接跳过兜底 + 之后 5 分钟保持运行态档），任何一次框架投递都能把状态钉住数分钟；
  `tool-end` 还会无条件重新置忙，收尾事件一丢就回不来。现改用**权威终态信号**：
  `observer` 判定"回复无工具调用 = 本轮结束"时派发的 `task-idle` 现在上报给纯净模式，收到即收尾，
  不再依赖超时；兜底回归"只兜事件丢失"且有界（框架窗口 120 秒 / 窗口外 60 秒即复位）；
  `tool-end` 不再无条件置忙。
- **纯净模式：页面导航后上报静默失效（网页在回复、界面却停在"就绪"）**：`harness-bridge` 的纯净模式
  门控只在切换那一刻下发一次，AI 页面每次导航（如首次对话后从首页跳到 `?cid=...` 会话页）或刷新
  都会重建 preload，门控回到 `false`，导致上报被静默丢弃。
  *（注：该问题最初靠"启动主动查询 + 导航重发门控"缓解，随后确认这是治标——门控本身就是失败点，
  已改为彻底删除门控，见上方第一条。保留的有效改动：系统提示词投递另由主进程直推，不经 AI 页面 bridge。）*
- **静默兜底不再"猜结束"**：原「12 秒无事件即重置为就绪」会在模型首个 token 延迟较久时
  （超长系统提示词、长思考）把正在回复的会话显示成"就绪"。现在结束判定交给权威信号 `task-idle`，
  兜底只负责"事件丢失"这一种异常，且有界（框架窗口 120 秒 / 窗口外静默 60 秒即复位）。
- **纯净模式下框架自动消息无状态反馈**：系统提示词、工具结果回传（JS汇总）、看门狗催继续、失败重试、
  上下文压缩等由框架自动发往 AI 页面的消息，此前 harness 页面完全不知情——界面停在「就绪」、
  发送键还是箭头，用户会往正在跑的会话里插话。现在这些投递会在状态栏显示来源（如「框架：工具结果回传」）、
  把发送键切为停止态并阻止插话；**消息内容仍不进对话流**（底层指令本就不该显示），只反馈运行态。
  - `chat-input` 新增 `onMessageDelivered` 投递回调（所有 `sendToChat` 投递，含系统内部消息）；
    系统提示词走独立路径，也在投递点补派发
  - `onStream` 补兜底：正在出字但未收到投递事件时同样置忙
  - 静默兜底收尾改用 `clearPendingBubble()`，不再残留永远转圈的占位气泡

### Changed
- **目标（/goal）改为工具调用收束**：新增 `goalDone()` 工具，AI 在目标全部完成后调用它结束自动推进；
  主进程直接向纯净对话视图推送 goal-done 事件（复用 todoWrite 的主进程推送模式）。
  废弃旧版"回复末尾输出 `[[GOAL_DONE]]` 文本标记"约定——文本标记靠模型自律，漏输出则目标永不收束，
  只能靠无进展兜底停表；工具调用是结构化动作，界面有卡片留痕，bridge 不再检测文本标记。

### Added
- **goalDone 工具**（任务管理类）：无参数，仅在目标的所有要求确实完成后调用；未开纯净模式或缺少窗口
  上下文时返回明确错误，不误伤普通对话（普通对话调用它只会得到一条错误回执）。

## [0.8.7] - 2026-10-02

### Added
- **侧边栏「工作区」页**：按项目目录分组列出所有对话。
  - 组内按时间倒序；当前项目默认展开；点对话直接跳转。
  - 悬停对话 → **重命名** / **归档**按钮；悬停项目 → **新建对话** / **归档项目**按钮。
  - 悬停项目名 → 信息卡片（完整路径 + 创建时间）。
  - 已归档对话 / 已归档项目分别折叠（列表底部「已归档 N 项目」）。
  - **新建对话**：用指定项目直接开新对话（自动选好项目 + 发初始化提示词，不弹目录框）。
- **AI 自动给对话命名**：新增 `nameConversation(title)` 工具，AI 在对话开始时自动命名；
  标题持久化（旧数据兼容），工作区列表实时刷新。支持会话 ID 未生成时暂存标题、待绑定。
- **侧边栏「子代理」页**：列出（用户级/项目级）/ 新建（生成模板 + 打开编辑）/ 改名 / 删除。
- **底部状态栏**：显示当前对话上下文 token。
- **最近使用快捷工具**：底部状态栏彩色标签（技能/MCP/子代理/提示词，最多 5 条，点击效果同卡片，localStorage 持久化）。
- **纯净对话模式增强**：
  - 地址栏新增「纯净模式 / 原版模式」切换按钮（无需记快捷键）。
  - 支持**跟随系统深浅色**（浅色/深色两套），不再固定深色。
  - Markdown 渲染改用 **marked**（GFM：标题/表格/链接/引用/有序列表/任务列表等）。
  - 首页未初始化项目时，输入区替换为大虚线按钮「首次对话需选择项目目录」（点击复用初始化逻辑）。
- **自定义 Provider 开发模板**：`templates/provider-dev/`（README + 模板 + 2 示例）。

### Changed
- **壳页面源码重构（内部）**：`shell.html` 拆分为 `src/ui/shell/`（HTML/CSS/TS 模块），
  构建期生成 `shell.html`（新增 `scripts/build-shell.mjs`，接入 `npm run compile`，pre-commit 自动重建）。
- **Windows 只产出 NSIS 安装版**：去掉 zip / portable 目标（它们**无法自动更新**，导致自动更新失效）。
- **用户代理（UA）动态化**：取真实内核版本，修复写死旧版本与真实版本矛盾（改善 Google 登录）。

### Fixed
- **空回复重试**：AI 回复正文为空时判为失败并触发普通失败重试（DeepSeek/Claude/ChatGPT 统一）。
- **webFetch**：改为先全文转 Markdown 再截断（修复 Bing 等头部脚本多的网站只返回标题）。
- **提示词页一直"加载中"**：修复 API 名写错（`getSnippets`→`listSnippets`）。
- **底部状态栏被 AI 网页盖住**：修复 `getContentSize()` 多算菜单栏高度导致 view 偏高（改为壳页面上报真实尺寸）。
- **子代理残留存储文件**：子代理 sessionStore 改内存态（不落盘），并启动清理历史遗留的 `session-dir-map-subagent-*.json`。
- **工作区对话操作按钮**：改绝对定位（覆盖时间位置），修复悬停后按钮占额外空间导致文字换行/右凸。
- **飞书**：未调用工具的 AI 回复末尾附注「（本次AI没有调用任何工具）」。

> 提示词版本：本次**已变更**（新增工具 `nameConversation`，改了工具定义与提示词 section）。
> 用户若被 AI 提醒"提示词版本需 +1"，属预期。

## [0.8.6] - 2026-09-30

### Fixed
- **新对话页初始化提示不显示**：修复重构后 `updateHomeMode` 仍依赖已删除的 `#cuckoo-overlay` 元素，
  导致"首次创建对话需初始化项目"的提示框永不弹出（新对话页/未选项目时）。
- **自动压缩与工具循环抢输入框**：自动压缩改为**在"任务空闲"（工具循环结束、AI 给出普通文本回复）时**触发，
  避免摘要指令被随后回填的工具结果覆盖，导致摘要根本没发出去。

> 提示词版本：本次**未变更**（仅修复，未改 `src/prompt/*` 与工具定义）。

## [0.8.5] - 2026-09-30

### Added
- **纯净对话模式（Harness，类 Codex 体验）**：同一窗口内切换到纯对话界面（AI 网页退居后台）——
  只显示用户消息 / 模型回复 / 工具调用卡片，隐藏系统提示词、工具结果回传、格式纠正等底层指令。
  - 入口：`Ctrl+Shift+H` / 菜单「查看 → 纯净对话模式」/ 页面内「网页模式」按钮
  - 流式输出 + 思考过程折叠；工具卡片（成功自动折叠）
  - **Goal（/goal 目标）**：自动多轮推进（无工具调用时 3 秒后"继续推进"）、`[[GOAL_DONE]]` 结束标记、15 轮上限、手动停止
  - **Plan**：复用 todoWrite，顶部可折叠计划面板（三态 + 进度条）
  - 斜杠菜单（↑↓ 导航 / Enter 选中 / 按输入过滤）
  - Claude Code 风格 UI（暖色强调、深色极简、内联 SVG 图标）
  - **性能**：harness 视图懒加载（不用纯净模式零开销）+ bridge 上报门控
- **飞书同步（手机收发对话）**：把 Cuckoo 的对话同步到手机飞书，并可从飞书发消息给 AI。
  - **每个窗口绑定一个飞书群**（跟 profile 持久化，多窗口消息互不干扰）
  - 推送：用户消息 / AI 回复（剥离工具代码块）/ 工具调用状态（默认不带工具名，保护隐私）
  - 接收：群消息（可直接发，无需 @）→ 送到绑定该群的窗口发给 AI
  - 连接：飞书官方 SDK 长连接（无需公网 IP）
  - 侧边栏新增「飞书」页（手机图标）：凭证、启停、群绑定、推送选项
  - **内置图文配置教程**（应用内窗口打开，离线可用）
- **飞书单元测试**：config 读写 / profile 群绑定 / 工具代码块剥离（19 用例）。

### Changed
- **快捷提示词改为追加**：点击提示词时**追加**到输入框现有内容后（不再覆盖已输入的内容）。

### Fixed
- 飞书推送选项改为独立「保存推送设置」按钮（原先必须点「保存并连接」才生效）。

### Docs
- README 致谢补充：@27584 的纯净对话模式贡献（PR #22）。

> 提示词版本：本次**未变更**（018/019 未改 `src/prompt/*` 与工具定义）。

## [0.8.4] - 2026-09-30

### Changed
- **卡片悬停圆角动画**：窗口 / 提示词 / 技能 / MCP 四个列表的卡片，默认直角，鼠标悬停时平滑过渡为圆角 + 浅底色。
- **平台选择页精简**：新建窗口时（尚未选平台），隐藏侧边栏、项目选择器、地址栏，平台选择页铺满整个窗口。

### Removed
- 删除冗余的 GitHub Actions workflow（.github/workflows/build.yml，master push 触发且一直失败；发版只用 release.yml）。

## [0.8.3] - 2026-09-30

### Added
- **全新侧边栏 UI（重大重构）**：从"AI 页面内注入的悬浮面板"改为 **VS Code 风格的独立侧边栏**（地址栏下方、AI 页面左侧）。含 7 个页面：
  - **提示词**：快捷提示词管理（增/删/改，点击填入输入框 + 可选自动发送）
  - **技能**：列出技能（按用户级/项目级分组），点击追加"请使用 xx 技能"
  - **MCP（连接器）**：列出 server（按用户级/项目级分组，含连接状态/类型/工具数），点击追加"请使用 xx 这个 MCP"
  - **窗口**：窗口列表（新建/切换/删除/默认打开）
  - **Token**：当前上下文 + 4 项统计 + 自动压缩设置 + 近 10 日用量柱状图
  - **设置**：失败重试 / 发送延迟 / 附件间隔（直接编辑，无需弹窗）
  - **关于**：版本号 / 检查更新 / 开源地址 / QQ 群
- **快捷提示词（Snippets）**：用户级 `~/.cuckoo/snippets.json`，首次内置 3 条，之后完全自定义。
- **地址栏项目选择器**：最左显示当前项目目录，点击重选目录并重新初始化。
- **活动栏可收起**：点击激活图标收起，启动默认收起。
- **通用弹框**：替代所有原生 alert/confirm，跟随系统深浅色。
- **深浅色跟随系统**。

### Changed
- **废弃旧注入面板 + 悬浮球**：仅保留「工具执行遮罩」和「首次对话引导框」。
- **工具执行遮罩**：改为页面顶部提示条（不遮挡内容），阻止点击但允许滚动。
- 侧边栏卡片、按钮统一为无边框 + 分隔线风格；长按钮改为胶囊形。

### Fixed
- **设置项「操作频繁重试间隔/次数」取值失败**：字段映射修正。

### Removed
- 旧注入面板、窗口管理弹窗、MCP 弹窗、设置弹窗、右下角悬浮球。
- 地址栏下方的 token 状态条（数据已移至侧边栏 Token 页）。

### Docs
- 新增 [UI 设计规范](docs/ui-design.md)。

## [0.8.2] - 2026-09-29

### Added
- **Rules（规则，对齐 Claude Code）**：`.cuckoo/rules/*.md`（项目级）+ `~/.cuckoo/rules/*.md`（用户级）。
  - **有 `paths`** 的规则 → 只在 AI **读匹配文件**时注入（首次全文，之后仅名字+路径；按会话去重）
  - **无 `paths`** 的规则 → 初始化时注入「## 项目规则」章节（始终适用）
  - `paths` 匹配用 picomatch（支持 `**`/`*`/`{}`）
- **自带 uv/node 运行时**：打包内置 uv（含 uvx）+ node（含 npx），MCP 配置里 `command: "uvx"`/`"npx"` 直接可用，
  **无需用户自己装**。uvx 首次运行会自动下载 Python + 包。不碰用户系统（仅子进程级 PATH 注入）。
- **MCP 面板显示 server 来源**（项目级/用户级）。

### Fixed
- **MCP UI JSON 编辑框只管用户级**：避免把项目级配置误写进全局。
- **发送延迟取消 10 秒上限**：设置里的发送延迟最大值不再限制 10 秒。

### Docs
- 新增 [Rules 配置与使用](docs/rules.md)；README 加 Rules 章节。
- 项目自带 6 条规则（infra/overlay/tools/hooks/bridge/test）。

### CI
- 缓存并下载自带运行时（uv/node），避免每次构建重复下载。

## [0.8.1] - 2026-09-28

### Added
- **MCP 项目级 + 用户级配置（对齐 Claude Code）**：
  - 用户级 `~/.cuckoo/mcp.json`（所有项目可用）+ 项目级 `<项目>/.cuckoo/mcp.json`（仅本项目）
  - 同名 server **项目级覆盖用户级**；启用状态分两级存储
  - 首次启动自动把旧 `userData/mcp.json` 迁移到 `~/.cuckoo/mcp.json`（旧文件保留）
- **MCP 连接池 + 引用计数**：用户级 server 全局共享（跨项目一个进程）、项目级按项目隔离；
  窗口关闭/切换项目时释放引用；引用归零后空闲 60 秒断开。
- **MCP 面板显示 server 来源**（项目级/用户级）；JSON 编辑框只管用户级（避免项目级混入）。
- **项目目录确定后异步自动连接 MCP**（不阻塞窗口，覆盖会话恢复场景）。

### Fixed
- **「今日窗口」token 口径修正（v3）**：改为累加**当轮完整 acc**（今天每轮总量之和），跨天归零。
  旧数据自动迁移清空。
- **压缩「摘要成功却判失败」**：DeepSeek 有时不发 FINISHED 帧，正文已完整生成却被判 error，
  导致压缩等不到完成、120 秒超时。现「无 FINISHED 但有正文」视为正常完成。
- **测试污染真实用户目录**：MCP 测试改用 `CUCKOO_HOME` 环境变量隔离（此前会写入真实 `~/.cuckoo`）。
- **发送延迟取消 10 秒上限**：设置里的发送延迟最大值不再限制 10 秒。
- hello 技能 description 末尾句号（避免与 when_to_use 拼出「。；」）。

### Docs
- `.cuckoo/mcp.json` / `.cuckoo/mcp-state.json` 加入 .gitignore（本地运行时配置）。
- 新增 MCP 连接池引用计数测试（9 个）。

## [0.8.0] - 2026-09-27

### Added
- **子代理（Subagents，对齐 Claude Code）**：主对话可把任务**委派**给独立上下文的子代理，
  只回摘要——既隔离上下文（缓解长对话卡顿），又支持专门化 + 工具限制。
  代理是带 frontmatter 的 Markdown 文件（`.cuckoo/agents/` 项目级 + `~/.cuckoo/agents/` 用户级），
  支持 `name`/`description`/`tools`/`maxTurns` 字段；用 `runAgent(name, task)` 调用。
  子代理在独立窗口（共享登录态）中执行，完成判定为"无工具调用"。
- **8 个开箱即用代理**：用户级 `explore`（只读探索）/ `code-reviewer`（代码审查）/
  `test-runner`（跑测试+根因）；项目级 `arch-guard` / `tool-smith` / `build-doctor` /
  `req-writer` / `hook-surgeon`。
- **「刷新技能与代理」按钮**：对话已开始时，点一下重新扫描技能/代理目录并把最新清单发给 AI
  （解决"对话开始后新增 agent 不生效"）。
- **token 状态条支持「亿」单位**：≥1 亿显示 `X.XX亿`；「今日窗口」调整到「窗口累计」前面。
- **Skill / Agent 配置文档**（`docs/skills.md` / `docs/agents.md`）+ README 引用（中英文）。

### Fixed
- **「今日窗口」口径修正**：改为累加**当天新增**（delta），跨天归零；子代理不计入。
  旧口径（累加完整上下文，会膨胀）数据自动迁移清空。
- **系统总累计虚高**：子代理窗口共享父窗口 partition，其上报会重复计入；现子代理跳过上报，
  并忽略/清理历史遗留键。
- **代理扫描健壮性**：空 `name`（纯空白）兜底为文件名；`maxTurns` 改为严格整数解析（`Number()` + 上界 1000）。
- 子代理窗口在新对话页被 home-mode 隐藏面板 → 现抑制首页模式，正常显示完整面板。
- 子代理窗口 `return` 跳过了拦截监听器初始化 → 现照常启动。

### Docs
- 新增 `docs/skills.md`、`docs/agents.md`；README（中英文）加 Skill / Agent 两节。
- backlog 记录：Claude Code subagents / Agent Skills 未实现功能对照、dsh 的 Skill 显式调用机制、压缩刷新慢诊断。

## [0.7.1] - 2026-09-25

### Fixed
- **「发送skill信息」等按钮误报「已发送」**：4 处调用 `sendToChat` 时漏了 `await`，
  导致即使没发出也弹"已发送"。涉及按钮：发送skill信息、卡住了?点我、沉浸式交流、生成文档。
  修复后会如实提示失败。
- **MCP 使用提示改为通用「先查后用」强制流程**（删除硬编码的 playwright 提示）：
  调用任何 MCP 工具前必须先 `mcpGetTools` 查参数，对所有 server 通用。

### Added
- **地址栏下方状态条**：显示当前对话的累计 token 量（地址栏与 AI 页面之间）。
  （注：此功能真机待验证）

### Docs
- 新增工具调用错误分析（第 1 批）+ 日志归档记录。

## [0.7.0] - 2026-09-25

### Added
- **Skill 支持（对齐 Claude Code）**：纯文件驱动、无复杂界面。用户把技能写成
  `SKILL.md`（带 name/description 元数据）放到 `.cuckoo/skills/`（项目级）或
  `~/.cuckoo/skills/`（用户级），AI 按需加载执行。支持技能附带脚本（用现有 bash/pwsh 运行）。
  设置面板新增「发送skill信息」按钮可刷新技能清单。目录改为 `.cuckoo/`（兼容读旧 `.cuckooCode/`）。
- **窗口默认打开（多选）+ 记录大小位置**：窗口管理面板可为每个窗口勾选「默认」，
  启动时自动打开所有勾选的窗口（一个都没勾则回退上次活跃窗口）。
  关闭窗口时记录其大小、位置、（是否最大化）与最后访问的 URL，下次按记录恢复。
- **沙箱内可用 sleep / setTimeout**：AI 在 cuckoo 代码块里可直接 `await sleep(ms)`
  或 `new Promise(r => setTimeout(r, ms))`（如等页面加载、等操作生效）。

### Changed
- **换行符处理对齐 dsh（LF 归一化）**：编辑文件时读入归一化为 LF 匹配，写回恢复原风格；
  混合换行文件被规整为主导格式。替换旧方案（三级候选匹配）。
- **MCP 使用提示改为通用「先查后用」强制流程**：调用任何 MCP 工具前必须先
  `mcpGetTools` 查清参数，避免凭记忆猜参数导致失败（不硬编码任何具体 server）。
- **工具描述优化**：edit 强调跨行连续文本 + 注意空白缩进。
- **技能 / MCP 章节加引导语**：AI 可提示用户安装所需技能 / MCP。

### Fixed
- **压缩「不成对」修复**：长会话（含重新生成/编辑分支）压缩时，`share/create`
  报 MESSAGES_MUST_APPEAR_IN_PAIRS。改为沿 `parent_id` 回溯主对话链取消息。
- **设置面板无滚动条**：内容超出被 overflow:hidden 裁掉，现支持滚动。
- **glob/grep 空路径容错**：传空字符串/空白不再报错，视为"未提供"（用项目根）。

### Dev
- **工具失败日志（仅开发版）**：工具调用失败单独记到 `userData/wyp/log/tool-errors/<工具名>.log`，
  按工具分文件、长期保留，便于事后分析。

## [0.6.1] - 2026-09-23

### Added
- **启动恢复最后活跃窗口**：记住上次最后使用的窗口，重启后自动打开它（列表顺序不变）
- **工具遮罩「停止」按钮**：工具执行完等待回传时，可点击停止取消发送（待发内容保留在输入框）
- **限流自动重试**：DeepSeek 返回"操作过于频繁"（HTTP 429 / 业务码 40029）时，
  按"操作频繁"策略退避重试（默认 60 秒 / 20 次），不再误判为普通失败

### Changed
- **看门狗改为 SSE 流静默检测**：不再依赖"是否在工具循环"的猜测，直接监控流是否有数据；
  流静默超过阈值（默认 300 秒）才催 AI 继续，更准确
- **压缩流程改用「清 IDB + 刷新」**：让 DeepSeek 自己重建完整历史后再读取，
  数据更权威、摘要必然包含，去掉"从 SSE 补消息 id"的 hack
- **工具遮罩去掉 loading 光标**（`cursor: wait` → `default`）

### Fixed
- **hook 性能问题**：`cacheHeaders` 高频写 localStorage（去重 + 移到 send 时一次）、
  `fragmentTypes` 的 O(n²) 复制（改 push）、清理高频诊断日志、轮询仅在变化时执行

## [0.6.0] - 2026-09-21

> 本版为**架构重构版**：全仓 TypeScript + ESM + 目录按领域重组 + 工具契约自动生成。

### Added
- **窗口地址栏**：窗口改用 `WebContentsView` 架构，顶部提供地址栏
  （显示 URL、复制、粘贴跳转、前进/后退/刷新/主页）
- **工具调用执行遮罩**：工具执行期间对 AI 页面加全局遮罩，防止误操作干扰
- **AI 回复中断自动重试**：服务端截断（INCOMPLETE / 正文为空）时自动重发

### Changed
- **全仓迁移 TypeScript**：所有源码由 JS 迁移到 TS，编译产物输出到 `out/`；
  主应用开启 `strict` 模式（hook 作为独立编译单元，单独规则）
- **全面转向 ESM**：统一使用 ES 模块，原生动态 `import()`
- **依赖升级**：Electron 33 → 44、TypeScript 5 → 7、ESLint 9 → 10 等
- **目录按领域重组**：`src/{app, session, bridge, overlay, tools, providers, mcp, infra}`，
  取代原先的 `main / preload / utils / tools` 分层
- **工具系统重组**：`tools/` → `src/tools/`，内部按 `core / runtime / impl` 分层
- **工具 API 契约自动生成**：每个工具自持 API 元数据与沙箱注入函数，
  构建期自动生成 `api.d.ts` 与 `bootstrap.generated.ts`（工具成为唯一真相源）
- **Provider hook 模块化**：网络拦截器改为正常 TS 模块，构建期用 esbuild
  打包为自包含字符串（消除三平台 SSE 解码重复）
- **工具调用模式收敛**：仅保留 JS（cuckoo 代码块）调用方式

### Removed
- 旧工具别名（`FileReadTool` / `FileWriteTool` / `FileEditTool` / `GlobTool` / `GrepTool`）
- JSON 工具调用执行模式（改为仅识别并提示）
- `tool-names` 手工维护的工具白名单

## [0.5.3] - 2026-09-18

### Added
- **附件上传工具（attach_file）**：AI 可将本地文件（PDF、Word、Excel、PPT、图片等
  无法用 read 读取的二进制文件）作为附件主动上传到对话输入框，上传后随下一条
  消息发出；单文件、大小上限 30MB，按扩展名推断 MIME
- **附件上传间隔设置**：默认 0.5~1 秒可配置，触发上传后先等待再检测附件是否出现
  （保留兜底轮询，避免页面渲染慢时误判失败）
- **「卡住了?点我」快捷按钮**：原「手动解析」改为向 AI 发送
  「刚才卡住了请继续 爱你哦」，一键催促卡住的 AI 继续
- **MCP 初始化提示词注入已启用 server 列表**（含连接状态与工具数）
- **MCP 默认工作目录**：stdio server 的 cwd 固定为程序目录/mcp-cwd，
  不可写时回退用户数据目录；覆盖各平台各安装方式
- **AI 可定位 MCP 产物**：提示词注入 MCP 工作目录，AI 可用绝对路径读取/上传
  截图、下载等产物

### Fixed
- 修复 4 个提示词模板缺少 `{{MCP_SECTION}}` 占位符，导致 MCP 能力章节从未
  注入提示词的问题
- 修复 MCP 并发连接竞态（启动与初始化同时触发导致重复 spawn 子进程、连接泄漏）

### Changed
- 初始化项目不再阻塞等待 MCP 连接，改为后台异步连接，初始化更迅速

## [0.5.2] - 2026-09-17

### Added
- **请求失败自动重试**：AI 对话请求失败（网络错误 / 非 2xx / 流中断）时，
  按配置间隔自动重发提示词，触发 AI 重新回答
  - 普通失败：默认 4~10 秒间隔、10 次；操作频繁（429）：默认 60 秒、20 次
  - 倒计时浮层 + 取消按钮；次数为负数表示不限次
  - 成功回复即重置计数；压缩上下文期间自动暂停
- **工具循环看门狗**：AI 进入工具调用循环后，若某轮等待回复超时，
  自动发送「请继续」提示词催 AI 继续；超时默认 300 秒、默认 3 次
  - 工具执行期间不监控；会话切换自动失效，不打扰新会话
- **设置弹窗**：重试 / 看门狗 / 发送延迟集中配置，新增「恢复默认」按钮
- **内置 Provider 容错加载**：单个内置平台文件缺失/损坏不再拖垮应用启动

### Fixed
- 修复用户主动停止生成被误判为失败、触发自动重试的问题：
  通过拦截 DeepSeek 的 stop_stream 请求作为「用户停止」的可靠判据
- 修复 inject_js 无法处理多语句代码、顶层 await、if-return 的问题
  （改用两遍语法探测，兼容表达式与语句体）

## [0.5.1] - 2026-09-15

### Fixed
- 修复打包后系统提示词中 ts 代码围栏为空的问题：electron-builder 默认排除
  `*.d.ts` 不进 asar，导致 `tools/cuckoo-tools.d.ts` 缺失、`{{TOOL_API_TYPES}}`
  被替换为空。改用 `extraResources` 复制到 `resources/tools/`，运行时优先从
  `process.resourcesPath` 读取并回退到源码路径

## [0.5.0] - 2026-09-15

### Fixed
- 修复系统提示词中工具类型定义（cuckoo-tools.d.ts）注释里的 ``` 反引号破坏 ts 代码围栏的问题

## [0.4.0] - 2026-09-15

### Added
- **上下文压缩（手动 + 自动）**：当对话 token 过大时，生成摘要并只保留最近
  20% 对话，通过 DeepSeek 分享功能在新会话继续
  - 纯 API 实现：读 IndexedDB 全量消息，直接调用分享接口，不依赖 DOM 点击
  - 面板「压缩」按钮手动触发；「自动压缩」可配置阈值（默认 80 万 token）
  - 压缩后自动跳转新会话并初始化项目，末尾追加「请继续你之前的工作」

## [0.3.10] - 2026-09-14

### Fixed
- 修复选择平台时闪退：切换平台会先销毁旧窗口再重建，
  window-all-closed 期间窗口数短暂为 0 导致应用误退出
- 修复 userData 目录不存在时启动崩溃：app.setPath('userData') 前兜底创建目录

## [0.3.9] - 2026-09-14

### Added
- 面板显示 DeepSeek 服务端对话 token（读取 SSE 流的 accumulated_token_usage，
  过万自动简写为 x.xx万）

### Changed
- 彻底移除 DOM 抓取 AI 回复路径，仅保留网络请求拦截
  - 删除 observer / ai-response / detector 等 DOM 抓取模块
  - 抽出工具执行逻辑到 tool-executor，拦截与 DOM 共用
  - 手动解析改为复用拦截缓存文本，不再依赖 DOM
- 注释 provider 中已废弃的 DOM 抓取方法（isResponseComplete / getMessageCandidates /
  getMessageMarkdown / isUserMessage / getCodeBlockLanguage）
- 移除 token 本地估算，仅保留服务端权威数据

## [0.3.8] - 2026-09-11

### Changed
- **DeepSeek / Claude / ChatGPT 三个平台的 AI 回复获取，从 DOM 抓取改为网络请求拦截**
  - 在页面主世界（main world）注入拦截器，被动观察平台自身的 completion SSE 流，
    直接解析回复文本，不再依赖 MutationObserver + DOM 稳定性轮询
  - 仅旁路读取（response.clone / responseText 快照），不修改请求与响应
  - 正文提取区分并排除 THINK / reasoning 片段
  - DeepSeek：解析 response/fragments 的 THINK / RESPONSE 分片
  - Claude：解析 content_block_delta 的 text_delta（忽略 thinking_delta）
  - ChatGPT：解析 /backend-api/f/conversation 的裸 v 追加、patch 批量操作、
    message 快照（仅采纳 assistant）与 message/status 结束信号
  - 工具执行结果回传仍沿用原有模拟输入框发送方式

## [0.3.6] - 2026-09-08

### Fixed
- 添加标准编辑菜单，修复 macOS 无法在 DeepSeek 输入框复制/粘贴的问题

## [0.3.5] - 2026-09-08

### Fixed
- glob/grep 工具打包后 ripgrep ENOENT，通过 asarUnpack 解包二进制并修正运行路径
- 恢复 README 中 Codecov 覆盖率徽章

## [0.3.4] - 2026-09-07

### Fixed
- pwsh 工具改用 execFile，避免管道符被 cmd 预解析导致命令残缺
- 主窗口 UA 改为 Chrome 130 普通标识，避免 DeepSeek 提示隐私风险
- openBrowserWindow 工具窗口同步设置 Chrome 130 UA，不再暴露 Electron 标识
- XML invoke 检测不再要求必须位于文本开头，并避免提示语自触发循环
- 渲染进程可通过 --cuckoo-user-data 参数加载自定义 Provider

### Added
- Provider 发送扩展接口（provider.triggerSend），支持站点原生发送
- 流式稳定性双通道校验（mutation 快照 + interval 兜底）
- 完成检测兜底轮询（每 2s 主动复查），覆盖后台/最小化漏触发场景
- MCP 工具调用识别（await mcpXxx / log(await xxx））
- 无 pre 的 .md-code 代码容器兜底

### Changed
- 会话 ID 提取与跳转 URL 改为 Provider 方法，不再硬编码 DeepSeek 格式

## [0.3.0] - 2026-09-07

### Added
- 多平台 Provider 框架：支持 DeepSeek 与 Claude，按平台区分输入框/发送按钮/用户信息/消息解析
- 平台选择页：新窗口未指定平台时展示卡片式选择页（含官方品牌 logo）
- 提示词模板化：每平台独立模板，支持 `{{PLATFORM_INFO}}` `{{TOOL_API_TYPES}}` `{{TOOLS_LIST}}` `{{TOOL_SECTIONS}}` `{{PROJECT_DIR}}` `{{PROJECT_INTRO_SECTION}}` `{{MCP_SECTION}}` 占位符
- 自定义 Provider 功能：用户可通过平台选择页导入 JS 文件，支持复制到 userData、重名替换、删除前窗口占用检查
- 自定义 Provider 类型声明与模板：`src/providers/custom/provider.d.ts` + `provider.template.js`
- Provider 方法化：平台差异全部下沉到 Provider 方法（findInput/findSendButton/isResponseComplete/getMessageCandidates 等）
- Claude 自动解析：基于停止按钮边沿触发完成检测，跳过空消息，避免重复触发
- 按平台分文件记录渲染日志到 `wyp/log/{providerId}.log`
- 新增 Provider 单元测试

### Changed
- 系统提示词由单文件改为多平台模板，运行时按 providerId 选择并替换占位符
- 工具 API 类型定义从 `tools/cuckoo-tools.d.ts` 动态读取，避免多处维护
- 平台 logo 从首字母占位改为官方 SVG

### Fixed
- Claude 自动解析重复触发/漏触发问题
- 多个 `{{PROJECT_DIR}}` 占位符只替换第一个的问题
- 导入自定义 Provider 后源文件被删导致失效的问题

---

## [0.2.5-beta.1] - 2026-09-02

### Added
- 新增 MCP（Model Context Protocol）按需查询能力
  - mcpListServers() 查看已配置的 MCP server（名称/类型/状态/工具数/工具名）
  - mcpGetTools(serverName) 查看指定 server 的工具详情（描述+参数）
  - mcpCall(server, tool, args) 调用 MCP 工具
- MCP 启动时自动连接已启用的 server，初始化项目时等待连接（8 秒超时）
- MCP 配置保存前完整 JSON 结构校验（错误时明确提示且不覆盖输入）
- MCP 配置保存后弹确认框，由用户决定是否通知 AI（避免打断 AI 操作）
- showConfirmDialog 扩展支持确认/取消双按钮 + Promise 返回（向后兼容）
- 新增 McpCallTool、McpQueryTools 单元测试

### Changed
- MCP 提示词改为按需查看模式，不再全量注入工具列表（节省 token）
- MCP 保存后的自动通知改为简短格式，引导 AI 按需查询
- 移除 .cuckooCode/CUCKOO.md 作为全局项目介绍（避免干扰其他项目场景）

### Fixed
- 修复 connectEnabledServers 从未被调用导致 MCP 启动后未连接的问题
- 修复 initProject 同步逻辑中 MCP 连接时序竞态（改为 async + 等待）

---

## [0.2.0] - 2026-08-27

### Breaking Changes
- 主进程重构：main.js 拆分为 src/main/ 模块（应用生命周期、IPC、项目上下文、会话存储分离）
- preload 重构：preload.js 拆分为 src/preload/ 模块（DOM 监测、overlay UI、工具解析分离）
- 移除 MySQLTool.js（已无维护，提示词中不再暴露）
- 移除旧版工具桥接实现（ToolBridge.js、UnifiedToolManager.js、WebContentCapturer.js）
- bash/pwsh 不再强制要求 description 参数（改为可选）

### Added
- 新增 5 个对标 dsh 的工具实现：
  - read（offset/limit 分段读取，替代 readFile）
  - write（全量覆盖，替代 writeFile）
  - edit（精确替换，替代 editFile）
  - glob（ripgrep 引擎，替代旧 GlobTool）
  - grep（ripgrep JSON 输出，替代旧 GrepTool）
- 新增 todoWrite 工具（全量任务列表，对标 dsh todo_write）
- 新增 pwsh 工具（PowerShell 执行，对标 dsh tool-pwsh）
- 新增 webFetch 工具（HTML 转 Markdown，对标 dsh web_fetch）
- 新增 openBrowserWindow / injectJS 工具（打开调试窗口并注入 JS）
- 工具系统支持 section 机制（对标 dsh systemPrompt.section），每个工具有独立的 prompt section
- 系统提示词全面改版：中文 dsh 风格 + 动态平台检测（Windows/macOS/Linux）
- 发送延迟可配置（UI 设置 + localStorage 持久化）
- UI 全面改版：悬浮球模式（48px 右下角 FAB + 小面板），不再占用全高侧边栏
- 跨平台启动脚本 start.js（Windows/macOS/Linux 通用）
- 完整单元测试覆盖（tools / main / preload）

### Changed
- package.json start 脚本改为 node start.js（修复 macOS chcp: command not found）
- start.js 自动根据平台选择 UTF-8 编码设置
- 工具返回格式统一为 dsh 风格（纯文本 envelope / marker）
- 错误提示统一为英文 dsh 风格
- package.json 增加 allowScripts 配置（npm 新版本 electron postinstall 被阻止问题）

### Fixed
- edit 工具 CRLF 适配（LF 的 old_string 能匹配 CRLF 文件）
- bash/pwsh 非零退出不再报错，改用 [exit code: N] 标记
- glob 路径去掉 ./ 前缀
- Windows 平台信息动态生成（不再硬编码）
- Electron postinstall 被 npm allowScripts 阻止导致二进制缺失的问题
- JS 脚本无输出时提示使用 log()

### Security
- bash/pwsh 危险命令黑名单保留（Windows + PowerShell 特有命令）
- 命令执行超时限制保持 30 秒
- 输出缓冲 1MB 限制保持

### Dependencies
- 新增 @vscode/ripgrep（glob/grep 底层引擎）
- 新增 turndown + @joplin/turndown-plugin-gfm（webFetch HTML 转 Markdown）

---

## [1.0.0] - 2026-08-11

### Added
- 初始版本发布
- Electron 桌面应用，嵌入 DeepSeek 网页版
- 自动检测 AI 回复中的 cmd/powershell 代码块，弹窗确认后执行
- 工具调用系统：支持 file_write、file_read、file_edit、file_glob、file_grep、bash、file_delete 等工具
- 会话级项目目录绑定，工具操作以项目目录为基础
- 侧边覆盖层面板，显示命令预览、执行结果和历史记录
- Ctrl+Shift+C 快捷键切换覆盖层
- 项目初始化功能，自动生成目录树并注入系统提示词
- 支持危险命令检测与额外警告
- 会话持久化（cookies/localStorage 保存到 %APPDATA%/cuckoo-code-session）

### Security
- 命令执行前必须用户确认
- 危险命令（rm -rf /、format、shutdown 等）触发额外警告
- 30 秒命令执行超时限制
- 1MB 命令输出缓冲区限制

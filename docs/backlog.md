# 待办清单（Backlog）

> 收集所有"想做但还没做"的事。**做之前先看本文件**，做完把它挪到"已完成"或删掉。
> 每条尽量写清：**是什么 / 为什么 / 怎么算完成**。
> 需要动手时，用提示词 `docs/prompts/work-backlog.md`。

---

## 🔴 高优先（影响质量/指标诚实）

### ~~1. 覆盖率口径修正 + 配置 Codecov~~ ✅ 已完成（2026-09-26）

**结果**：
- `vitest.config.mjs` 加 `coverage.exclude`（排除 `src/app/**`、`bridge/entry.ts`、`bridge/api.ts`、注入式 hooks、`updater/**`、`*.d.ts`）
- 新建 `codecov.yml`（project target: auto + threshold 2%；patch target 50%）
- 修复 `.github/workflows/coverage.yml` 上传路径（`./coverage.lcov` → `./coverage/lcov.info`，原路径错误）
- 确认 `@vitest/coverage-v8` 已在 devDependencies
- 顺带：`testTimeout/hookTimeout` 放宽到 30s（治 coverage 插桩下 beforeAll 超时的 flaky）

**口径修正**：31.73% → **45.23%**（Stmts），CI 将显示真实"可测代码覆盖率"。

### 2. 补单元测试（B 计划）

**原则**（见 `docs/arch/06-testing.md`）：只写真实集成测试，不 mock 内部模块；可测的补，Electron-only 的标注跳过（靠真机验证）。

**已补（2026-09-26，+40 测试，覆盖率 45.2% → 50.1%）**：
- [x] `src/session/compaction.ts`（`_pickRecentPairedIds`：parent_id 回溯、成对裁剪、分支/回退/边界）
- [x] `src/mcp/config.ts`（读写、upsert stdio/http、启停、删除、覆盖；mock electron app.getPath）
- [x] `src/overlay/chat-input.ts`（randomDelay 边界、isInputVisible、findInputArea 兜底）
- [x] `src/overlay/panels/window-manager.ts`（空列表/平台名映射/autoOpen/失败兜底）
- [x] `src/overlay/panels/mcp-manager.ts`（handleMcpSave 的 8 条校验失败路径 + 成功 upsert/删除旧 server）

**仍可补（可选）**：
- [ ] `src/providers/hooks/*.ts` 的纯函数（如 deepseek 的 `resolveStatus`）—— 嵌套在 IIFE 内，需先导出才能测

**失败路径（重点，D20 教训）**：
- [ ] 各工具的异常分支（参数缺失、文件不存在、命令失败）
- [ ] `retry.ts` 的退避/计数边界
- [ ] `watchdog.ts` 的会话切换/暂停

**跳过（标"需真机验证"）**：
`src/app/**`、`attach-file`、`open-browser-window`、`browser-window-manager`、`updater/**`

---

## 🟡 中优先（体验/一致性）

### 3. 中断判定扩展到 claude / chatgpt

**现状**：`resolveStatus` 的"服务端截断→重试"判定只在 deepseek hook。

**要做的**：
- [ ] 研究 claude/chatgpt 的流式结束特征，识别"截断"
- [ ] 在对应 hook 实现

### 4. 清理诊断代码

**现状**：`deepseek.ts`（dbg/snapshot/statusFrames）与 `observer.ts`（诊断 log）留有调试代码。

**要做的**：
- [ ] bug 稳定不复现后，清理 dbg/snapshot/statusFrames 与诊断日志
- [ ] 保留 thinkLen/textLen（真实逻辑）

### ~~5. README 修正~~ ✅ 已完成（2026-09-26）

- [x] 删"项目结构"里的 `main.js` / `preload.js`（已不存在）
- [x] 工具表补 `attachFile`
- [x] 工具示例的 `src/utils/` 路径改掉（→ `src/infra/paths.ts`）
- [x] "自动重试"描述过时（改为两个机制：退避重试 + 看门狗流静默）
- [x] "主要功能"补：地址栏、工具遮罩、上下文压缩、Skill、窗口默认打开
- [x] Node 版本统一（README 22 → 16，与 engines 一致）
- [x] allowScripts 提示过时（改为 `npm install-scripts ls` / `approve --all`）
- [x] **额外**：README.en.md 项目结构整段重写（原为旧架构 `src/main/`、`src/preload/`，与实际完全不符）

### 6. 清理历史分支

**现状**：60+ 本地分支 + 40+ 远程分支。

**要做的**：
- [ ] 列出"已并入 master 的分支"，批量删除
- [ ] 保留有未合并提交的

### 7. 系统提示词长度控制（防超输入框上限）★ 用户重点关注

**现状**：系统提示词是**拼接式**的——`{{TOOL_API_TYPES}}`（api.d.ts 全文，几千行，**占大头**）、`{{TOOL_SECTIONS}}`、`{{TOOLS_LIST}}`、MCP、项目介绍、skills、agents 等，全部拼进一个 prompt。**实测已达 ~21854 字符**。而**网页版 AI 的输入框有最大长度限制**，超长会被**静默截断**（子代理首轮消息已踩过此坑），导致 AI 收不到完整提示词。

**要做的**：
- [ ] 评估各 provider（deepseek/claude/chatgpt）输入框的实际上限
- [ ] `buildPrompt` 末尾做长度预算：超限时按优先级裁剪（`{{TOOL_API_TYPES}}` 最可裁——只保留常用工具的声明）
- [ ] **按当前窗口"允许的工具"过滤**（子代理只发它 tools 里的工具提示，不发全量）—— 子代理场景最该做
- [ ] 技能/代理清单设上限（对齐 Claude Code 的 1536 字符截断）
- [ ] 超限时给可诊断的日志/提示
- [ ] 工具 API 类型定义改为**按需拉取**（如 `getToolApi(name)` 工具，AI 需要时才查）—— 大幅缩短固定 prompt

**分析结论（2026-09-30）：工具信息散在 3 处，但"合并"是错的方向**
- 3 处**粒度不同、各司其职**，纯"合并成 1 处"会让 AI **变差**：
  - `{{TOOL_API_TYPES}}`（api.d.ts，~10467 字符）：**完整类型** → 服务"写正确调用"
  - `{{TOOLS_LIST}}`（`getFormattedJsApiForPrompt`）：**一行速览** → 服务"快速选工具"
  - `{{TOOL_SECTIONS}}`（`getPromptSection`）：**用法/流程** → 服务"复杂工具正确使用"
- **真问题不在"重复"，在 `api.d.ts` 太肥**（含大段 JSDoc，占 ~10K）。
- **推荐方向（不是合并，是分层瘦身）**：
  - [ ] `build-tool-api.mjs` 生成 `api.d.ts` 时**省略 JSDoc 正文**（只留类型签名），描述已在 `{{TOOLS_LIST}}` → 预计省 ~6K 字符
  - [ ] （可选）`{{TOOLS_LIST}}` 简化为"只列名字"（签名已在 api.d.ts）
- 真相源已是 TS（`apiMetas` 自动生成 api.d.ts），"能否合并到 ts"——**已经是**。

**完成标准**：prompt 长度有硬上限保障，任何 provider/子代理都不会因超长失败。

---

## 🟢 低优先（长期/技术债）

### 8. ESLint 覆盖 .ts（D22 遗留）

**现状**：`eslint.config.js` 只查 `*.js`/`*.mjs`，`src/**/*.ts` 未 lint，依赖护栏对 .ts 无效。**阻塞**：typescript-eslint 与 TS7 不兼容。
- [ ] 待 typescript-eslint 支持 TS7 后配置

### 9. AOP 重赋值改造

**现状**：`retry.ts` 用 `let foo = function(){}` + `withLog` 重赋值，与类型系统别扭。
- [ ] 考虑换成显式包装或移除

### 10. 工具 API 契约类型化（D12 深化）

- [ ] 评估：让工具声明真实 TS 类型，构建期同时生成 `api.d.ts` + JSON Schema（避免漂移）

### 11. 其它想法（持续添加）

> 以后有什么想法，都写在这里。

- [ ] （示例）快捷键自定义
- [ ] （示例）深色/浅色主题

---

### 12. DSH 插件兼容（长期工程，需求 022）

> **目标**："鸿蒙兼容 Android"——DSH 插件**原样**在 Cuckoo 跑（不依赖 DSH 代码）。
> **进度**：P1 + C1 + C2 已交付（详见 `docs/requirements/022-dsh-plugin-compat.md`）。
> **本清单列出"DSH 每一项能力"在 Cuckoo 的状态。**

#### 12.1 核心机制

| 能力 | Cuckoo | 状态 |
|---|---|---|
| 工具定义 `defineTool` | shim 实现 | ✅ |
| 工具注册 `ctx.tools.register` | 转 Cuckoo Tool | ✅ |
| 工具列表 `ctx.tools.list` | registry.listNames | ✅ |
| 参数 schema（schemastery/zod）| 递归转 JSON Schema | ✅ |
| 服务注入 `ctx.inject/provide/get` | 简化（inject 回调传 ctx）| ⚠️ 部分 |
| 可逆副作用 `ctx.effect/scope` | 空转（不真清理）| ⚠️ 空 |
| **事件总线 `ctx.on/emit`** | EventBus（接 Cuckoo 事件）| ✅ |
| 会话投影 `ctx.sessionProjections` | 内存实现 | ✅ |
| 会话事件流 `session.append` | 内存实现 | ✅ |
| 落盘 `ctx.storage` | 无 | ❌ |
| Service 基类 | 简化占位 | ⚠️ 简化 |
| 模块解析 | esbuild 劫持 + 通配 stub | ✅（够用）|
| TS 支持 | 只 JS | ❌（价值低）|

#### 12.2 DSH 的 ctx 服务逐项对照

> 状态：✅ 已接真 / 🟡 简化-stub（不崩，功能空）/ ❌ 无（stub 兜底）
> 优先级：🔴 高（常用）/ 🟡 中 / 🟢 低（特定场景，或**不做**）

| 服务 | 用途 | Cuckoo | 状态 | 优先级 |
|---|---|---|---|---|
| **tools** | 工具注册/列表 | registry | ✅ | — |
| **sessions** | 会话信息 | sessionStore | ✅ | — |
| **sessionProjections** | 会话投影 | 内存实现 | ✅ | — |
| **settings** | 插件配置 | plugins-config | ✅ | — |
| **events**（on/emit）| 事件订阅/广播 | EventBus | ✅ | — |
| **fs** | 文件读写 | fs-service（node:fs）| ✅ | — |
| **systemPrompt** | 系统提示词段 | prompt-sections | ✅ | — |
| **agents** | 子代理 | agents-service（会话视图）| ✅ | — |
| **skills** | 技能 | Cuckoo skills | ✅ | — |
| **commands** | 命令 | snippets | ✅ | — |
| **storage / storageDomain** | 持久化 | plugin-storage（JSONL）| ✅ | — |
| **sessionQuery** | 会话查询 | ❌ | ❌ | 🟡 |
| **sessionTitle** | 会话标题 | sessionStore | ✅ | — |
| **compaction** | 上下文压缩 | Cuckoo 压缩 | ✅ | — |
| **subagents** | 子代理管理 | runAgent | ❌ | 🟡 |
| **goals / planMode** | 目标/计划 | Goal/Plan 面板 | ✅ | — |
| **shell / shellEnv** | 命令/环境 | bash/pwsh | ❌ | 🟡 |
| **workspaceFiles / Registry / Changes** | 工作区 | 文件树 | ✅ | — |
| **tokenMeter** | token 统计 | token-stats | ✅ | — |
| **mcpResources** | MCP 资源 | Cuckoo MCP | ❌ | 🟢 |
| **web / webServer** | 网络/HTTP | webFetch | ❌ | 🟢 |
| **terminals / ssh / lsp** | 终端/SSH/LSP | ❌ | ❌ | 🟢 |
| **browserUse / computerUse** | 浏览器/电脑 | openBrowserWindow | ❌ | 🟢 |
| **attachments / approval / userQuestions** | 附件/审批/询问 | attachFile | ❌ | 🟢 |
| **sandbox / jobs / schedule / spillStore** | 沙箱/任务/调度 | ❌ | ❌ | 🟢 |
| **llm** | LLM 调用 | **Cuckoo 用网页**（无此层）| ❌ | 🟢 **不适用** |
| **telemetry / otel / hmr / typert / …** | 遥测/框架内部 | ❌ | ❌ | 🟢 **不做** |

#### 12.3 分期计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P1** | 工具类插件 | ✅ |
| **C1** | settings/tools/sessions 接真 | ✅ |
| **C2** | 内存流水 + 投影 | ✅ |
| **C3** | **事件总线**（`ctx.on/emit` 接 Cuckoo 事件）| ✅ **已完成（2026-10-08）** |
| **C4-A** | **systemPrompt**（提示词段）| ✅ **已完成（2026-10-08）** |
| **C4-B** | **fs**（文件读写）| ✅ **已完成（2026-10-08）** |
| **C4-C** | **agents**（子代理）| ✅ **已完成（2026-10-08）** |
| **C5** | **storage 落盘**（JSONL + 重放）| ✅ **已完成（2026-10-08）** |
| **C6** | skills / commands / goals / compaction 等（7 个）| ✅ **已完成（2026-10-08）** |
| **P3** | UI/主题等 DSH 客户端能力 | 🟢 待做 |

**完成标准**：主流 DSH 插件（工具/事件/存储类）**原样能跑、行为一致**（对照测试验证）。

---

## 已完成

- [x] 架构重构 P0–P5
- [x] 窗口地址栏
- [x] 工具调用执行遮罩
- [x] AI 回复中断自动重试（deepseek）
- [x] 需求档案机制 + 架构文档

---

## 长对话卡顿（已诊断，暂不处理）

**现象**：对话约 20 万 token 后，AI 回复时页面卡顿（卡住不渲染，结束后突然全刷出来）。

**诊断结论（2026-09-26，用性能探针实测）**：
- **非我方原因**：hook 解析 4152 帧仅 7ms（占流时长 0.04%）；XHR 读取只 16 次、无 O(n²)
- **真凶**：DeepSeek 页面自身——对"当前正在生成的消息"的 Markdown 重渲染是 **O(n²)**
  - 实测：文本 82ms → 5613 字符时单次重渲染 **2378ms**，16 秒流里主线程被占 **6.8 秒**
  - 长任务与数据到达**严格对齐**（每来一段数据触发一次重渲染，且时长递增）
- **关键**：DeepSeek **已用虚拟列表**（ds-virtual-list-visible-items），屏幕外消息本就不渲染
  - → 我们"给历史消息加 content-visibility"的方案**无效**（无屏幕外冗余可省）
  - → 卡的是"当前消息"，虚拟列表救不了（它必须实时可见）

**结论**：这是 DeepSeek 网页架构的固有成本，**我们改不了它的渲染代码**。

**可选缓解（未做）**：
- 长对话自动/提示压缩（换新对话 = 重置当前消息长度）
- 提示词引导 AI 回复简短
- 上下文超阈值时提醒用户开新对话

**备注**：诊断用探针已撤（见提交 ac49800）。

---

## 提示词检查发现的问题（2026-09-27，用户要求先记录，暂不改）

来源：用户贴出的完整系统提示词，逐段检查后发现：

1. **🔴 自相矛盾**：「关于工具调用」说"代码块外不要有任何文字"，末尾却写"如果你觉得需要使用工具，请直接回答工具指令及入参"——一个说只输出代码块、一个说要回复说明，会让 AI 困惑。
2. **🟡 表述别扭**：工具使用规则第 5 条"log() 只在 cuckoo 代码块内可用"——log() 是沙箱注入的 JS 函数，"只在代码块内"说法不准。
3. **🟢 示例技能**：`可用技能` 里的 `hello` 是示例技能，正式使用可删（否则 AI 总看到"演示技能"）。
4. **🟡 位置乱**：工具指导段里 `runAgent` 的说明夹在 `attachFile` 和 `mcpCall` 之间，应单独成段或归入 Agent 段。
5. **🟡 悬空引用**：底部"见 systemPrompt.md 末尾"——**该文件不存在**（工具定义在 `src/tools/api.d.ts`），引用失效。
6. **🟡 硬编码路径**：MCP 段硬编码本机路径 `C:\Users\61519\...`，打包分发时会错，应动态生成。

（注：CUCKOO.md 反引号转义 bug 已于 2026-09-27 修复，见 83e662a。）


---

## 压缩刷新慢问题（2026-09-27，用户要求先记录，暂不改）

**现象**：点「压缩」后，AI 摘要已生成（网页上可见），但要等很久（实测约 60~80 秒）才刷新页面。

**日志证据**（时间戳为 UTC）：
- 01:51:11 已触发发送, 压缩-摘要
- 01:52:31 收到摘要回复，长度=8071（80 秒后）
- 01:52:31 清除 IDB → 刷新

**根因分析**（代码层）：
- 压缩段1 走 waitForResponse(120000)，等的是 hook 派发的 cuckoo-ai-response（finished=true）
- hook 的 feed() 逻辑：收到 FINISHED 帧就立即 dispatch，中间无任何延迟
- finished 来自解析 SSE 的 response/status = FINISHED（或 quasi_status = FINISHED）帧
- 结论：慢的不是我方代码，而是 DeepSeek 服务端——正文生成完后 SSE 连接保持打开，FINISHED 帧延迟下发

**验证方法**（未做）：
- dispatch 的 dbg.path 字段标明派发路径：
  - feed-finished-frame = 收到 FINISHED 帧立即派发
  - stream-end = 流关闭才派发（说明 FINISHED 帧未到或解析失败）
- 加日志打「FINISHED 帧到达时间 / dispatch 时间 / 派发路径」即可确认

**可选改进（未做）**：
- A. 复用 hook 已有的 cuckoo-stream-idle（看门狗）：正文 N 秒无新增即提前当完成
- B. 在 waitForResponse 加正文静默检测：连续 N 秒无新增即认为完成
- C. 先加诊断日志确认根因，再决定

**另**：压缩段3（分享页初始化）本次也疑似卡住（01:52:36 检测到待初始化后无后续日志），待一并排查。


---

## Claude Code subagents 未实现功能对照（2026-09-27 记录）

已完成（016 实现）：Markdown+frontmatter 定义、name/description/tools/maxTurns 解析、
渐进式披露、runAgent 委派、独立上下文（新窗口+共享 partition）、完成判定、防递归、
超时+maxTurns 兜底、项目级>用户级优先级。

### 未实现清单

| # | 功能 | Claude Code 行为 | 我们的差距 | 优先级 |
|---|---|---|---|---|
| 1 | `model` 字段 | 指定子代理用 sonnet/opus/haiku/inherit | 未解析；子代理用主对话同款模型 | 中（DeepSeek 单模型，暂不适用；多平台后有用） |
| 2 | `/agents` 管理命令 | 列出/创建/编辑/删除代理 | 无 UI，只能手改文件 | 低（文件系统已够用） |
| 3 | 显式调用 `@agent-name` | 用户可显式指定代理 | 只能 AI 自己判断委派 | 低 |
| 4 | 并行多个子代理 | 一次调多个 | 同步串行 | 低（MVP 明确选同步） |
| 5 | 后台运行 `run_in_background` | 后台跑，不阻塞主对话 | 同步阻塞 | 低 |
| 6 | 恢复/追溯子代理会话 | resume 之前的子代理 | 窗口关了就没了，无记录 | **高**（排查困难） |
| 7 | 主对话显示委派进度 | UI 显示"正在委派给 xxx" | 只有关闭时的 console 日志 | 中（工作量小，体验提升） |
| 8 | `color` 字段 | 子代理在 UI 里的颜色 | 无（我们无代理 UI） | 低 |
| 9 | `tools` 过滤工具提示词 | 只给子代理它允许的工具说明 | 半成品：解析了 tools，但提示词仍发**全量**工具（2 万字） | **高**（与 backlog 第 7 条「提示词长度优化」同一件事） |
| 10 | hook（PreToolUse 等） | 代理可挂 hook | 无 | 低 |
| 11 | plugin/企业级代理 | 多级作用域 | 只有项目级 + 用户级 | 低 |

### 建议
- **优先做 #9**（按 tools 过滤工具提示词）——与 backlog 第 7 条合并，一举两得
- **其次 #6**（子代理会话可追溯）——目前窗口关闭即无痕迹


---

## Claude Code Agent Skills 未实现功能对照（2026-09-27 记录）

已完成：SKILL.md + frontmatter、name/description/when_to_use/allowed-tools 解析、
渐进式披露（只放 name+description+路径，AI 按需 read）、项目级+用户级（项目优先）、
description 截断 1536 字符、初始化时自动注入提示词、「发送 skill 信息」按钮、
提示词说明"技能若有附带脚本用 bash/pwsh 运行"。

### 未实现清单

| # | 功能 | Claude Code 行为 | 我们的差距 | 优先级 |
|---|---|---|---|---|
| 1 | `/skills` 管理命令 | 列出/查看/启用/禁用技能 | 只有「发送 skill 信息」按钮，无查看/管理界面 | 中 |
| 2 | 技能启用/禁用开关 | 可单独开关某技能 | 扫描到就全部注入，无法禁用 | 中 |
| 3 | 内置技能 | 自带一批（pdf/docx/xlsx 处理等） | 无内置，全靠用户装 | 低 |
| 4 | 技能市场/安装命令 | 可从市场安装 | 只有"提示用户手动安装" | 低 |
| 5 | 技能引用目录内其他文件 | SKILL.md 可让 AI read 同目录 reference.md 等 | 能力上有（AI 能 read），但无约定说明；提示词只给 SKILL.md 路径 | 低 |
| 6 | `allowed-tools` 强制生效 | 声明后实际限制工具 | 我们只解析不强制（注释明说"仅声明不强制"） | 低 |
| 7 | 技能依赖声明 | 声明需要某 MCP/工具 | 无 | 低 |
| 8 | 技能版本管理 | 有版本/更新机制 | 无 | 低 |
| 9 | 技能的 `model` 字段 | 指定技能用某模型 | 无（DeepSeek 单模型，暂不适用） | - |
| 10 | 自动热更新 | 改技能文件后自动生效 | 需手动点「发送 skill 信息」 | 中 |
| 11 | 作用域 plugin/企业 | 多级作用域 | 只有项目级 + 用户级 | 低 |

### 建议优先
- **#10 自动热更新**：现在改技能后需手动点按钮，体验割裂；可改为"每次初始化自动重扫"或"文件监听"
- **#2 启用/禁用开关**：有些技能只想临时用；全量注入会让提示词变长
- **#1 /skills 查看界面**：让用户看到装了哪些技能、路径、描述

### 观察：skills 与 agents 高度对称
两者同构实现（`.cuckoo/{skills,agents}/` + frontmatter + 渐进式披露 + 项目/用户级）。
差异：agents 有 `runAgent` 工具（主动调用），skills 无对应工具——skills 靠 AI 自己 read SKILL.md。
符合本质差异：agent = 独立上下文委派，skill = 当前上下文的流程/知识。


---

## dsh 的 Skill 显式调用机制（2026-09-27 记录，参考实现）

**来源**：读上游 `deepseek-harness2`（dsh）源码（`packages/skill/{skill,tool-skill}`、`packages/subagent/tool-subagent`）。

### dsh 怎么"显式告诉 AI 用某个 skill"

**两条路径，都不改用户原话：**

**路径 1：用户打 `/技能名`（最硬）**
- dsh 有 `agent/pre-step` 钩子（"发请求前"时机）
- 扫用户消息 → 发现调用了技能 → 读技能全文 → **在消息列表末尾追加一条新用户消息**：
  ```
  <skill_content name="pdf">
  <skill_resources>Base directory: ...</skill_resources>
  <skill_instructions>（SKILL.md 全文）</skill_instructions>
  </skill_content>
  ```
- 代码注释原文："the user's own words ride a plain user message, and the rendered skill body follows as injected instructions-form context"
- **用户原话照发，技能全文追加在后** → AI 收到两条消息

**路径 2：自然语言"用 pdf 技能帮我X"（靠提示词硬约定）**
- 会话里发一条 `<system-reminder>` 用户消息，含 `<available_skills>` 清单 + 硬指令：
  - "If the user names a skill, or the task clearly matches a skill's description, **call the `skill` tool with the exact skill name before taking task actions**. Load all applicable skills, then follow their full instructions."
  - "This catalog contains summaries only; **do not infer or follow a skill's instructions until it has been loaded**."
- `skill` 工具描述呼应："Load the full instructions for a skill. Call it before acting on a task that names or clearly matches a skill in the session skill catalog."
- **目录变化时重发一条**：`renderCatalogUpdate()` → "The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session"（用新消息覆盖，而非改系统提示词）

### dsh 的 Agent：不点名
- 只有一个通用 `subagent` 工具，**没有 name 参数**；专项化靠 `persona`/`toolFilter`/`provider`/`model` 配置
- "何时用"写进工具 description（`providerWording`，按 spawn/fork 生成不同措辞）

### 对我们的启示（可落地）
| # | 改进 | 说明 |
|---|---|---|
| 1 | **技能加统一工具** `loadSkill(name)` | dsh 有 `skill(name)`、Claude Code 有 `Skill` 工具；我们只让 AI 自己 `read`，容易偷懒 |
| 2 | **显式调用：把技能全文塞进输入框** | 模仿 dsh 路径1——overlay 按钮/命令 → 往 DeepSeek 输入框塞 `<skill_content>...</skill_content>` 全文 + 用户需求 → 一起发 |
| 3 | **提示词措辞写硬** | "用户点名技能时必须先用工具加载，不许凭简介瞎猜"（比"你必须先 read"更硬） |
| 4 | **技能清单可重发** | dsh 用 `<system-reminder>` 新消息覆盖；我们已加「刷新技能与代理」按钮（e9bd7ff），方向一致 |

**我们的难点**：dsh 自己写客户端，能在"发请求前"钩子里追加消息；我们用 DeepSeek 输入框，**没有该钩子**——只能"往输入框塞文本再发"（效果等价）。


---

## MCP 不支持 uvx/uv 命令（2026-09-28 记录）

**现象**：用户配了 `windows-mcp`（`command: "uvx"`），连不上。

**根因**：
- `uvx` / `uv`（Python 包管理器 uv 的命令）**不在用户机器上**（只有 Python 3.9）
- MCP 子进程 spawn 时找不到 `uvx` → 启动失败 → 连接失败

**问题**：
- 我们 spawn MCP 时**依赖系统 PATH 里的命令**（npx 能跑是因为 npx 在 PATH）
- **uvx 需要用户自己装 uv** —— 但我们的**错误提示不友好**（用户只看到"连不上"，不知道为什么）

**要做的**：
- [ ] 连接失败时，**给出明确原因**（如"命令 uvx 未找到，请先安装 uv"）
- [ ] 可选：内置/引导安装常用运行时（npx 有，uvx 没有）
- [ ] 文档说明：哪些命令需要用户自己装

**优先级**：中（错误提示友好性）

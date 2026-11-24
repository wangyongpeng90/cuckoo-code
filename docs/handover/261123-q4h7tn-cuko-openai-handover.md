# Cuko 接入 OpenAI 兼容接口：交接文档

> 需求 ID：`261123-q4h7tn-cuko-openai`；分支：`feat/261123-q4h7tn-cuko-openai`；整理时间：2026-11-24 12:10（Asia/Shanghai）
> 接手进度：2026-11-24 12:30 第 2 节第 1~3 项已完成，第 4~6 项（文档收尾、push / 合并决定）进行中
> 项目根目录：`C:\d\SourceCode\2026\cuckoo-code`
> 接手方：在 Cuko 窗口里、用 OpenAI 协议模型工作的 AI

## 0. 接手须知（先看这一节）

- 你运行在 Cuko 窗口里，而 Cuko 就是本项目做出来的程序。你改的运行时代码（界面 / 主进程）要等用户手动重启 Cuckoo 才生效；你不能自己重启（会把自己关掉），也不要给用户写重启脚本，用文字告诉用户做什么、做完看什么即可。
- 阅读顺序：本文件 → 需求档案 `docs/requirements/261123-q4h7tn-cuko-openai.md` → `git status -sb` 与 `git log master..HEAD --oneline` → `src/ui/cuko/composer-stats.ts` → `src/ui/cuko/app.tsx` 里的 `ComposerSlotsContext` / `CukoUsage` / `usageView`。
- 从第 2 节「未完成」第 1 项开始做；每完成一项跑 typecheck / test / lint，全绿再继续。
- 第 8 节是必须遵守的坑。

## 1. 任务背景与目标

- 让 Cuko 除 Cuko API 外，还支持标准 OpenAI Chat Completions 协议：Provider 选了 OpenAI 协议，聊天里选它的模型就走 OpenAI 协议，选 Cuko API 的模型就走 Cuko API，不加中间转换服务。
- 约束（用户原话要点）：不用 function calling、不用 system 角色，工具调用仍是对话内联的 cuckoo 代码块，用户能看到 AI 在做什么；兼容 DeepSeek 的 `reasoning_content`；尽最大努力命中 DeepSeek 前缀缓存，即每次发送时前面的对话一字不变；这一版不支持附件。
- 请求日志要像 Chrome 开发者工具的网络面板：请求头（密钥打码）/ 请求体原文 / 响应原文。
- 验收标准见需求档案「验收标准」一节。

## 2. 当前进度

分支状态：本地比 origin 多 4 个提交（都没 push）；工作区只剩未跟踪的 `deepseek-web-attachments/`（不要动、不要提交）。

### 已完成（提交按时间顺序）

| 提交 | 内容 |
|---|---|
| 2294d82 | 需求档案 |
| 38db2bc / 1cb6b18 | 纯函数 `src/app/cuko-openai.ts`、SSE 解码器 `flush()`、补列与运行器小修 |
| 3c0ac66 / f5c1c40 / 1189cd6 / 278375e | 运行器接入 OpenAI（原文重放、停止 / 出错、自动重试、切模型补齐原文、用户消息由主进程落库）与集成测试 |
| 4c36f3d / 98dcb1d | Provider 协议与参数、模型目录、设置页 |
| 901000f / 9fb8ad0 | 请求日志原始报文 / 用量 / 缓存命中；交接文档 |
| 99f3f2d | chore(lint)：`eslint.config.js` 全局 ignores 加 `tmp/**` `.cuckoo/plugins/**` `resources/runtime/**` |
| ab5c953 | 步骤 4：模型选择器两级菜单（模型 / 推理等级）、推理等级按会话保存、输入框下方「xxx tok · 缓存命中 · 上下文」与 60% 提醒 |
| 973ee8b | 请求日志测试断言（协议 / 尝试次数 / 用量归一 / 原文一致 / 密钥打码 / 列表不含原文 / 超过 20 条释放原文） |
| 本文件所在提交 | 交接文档更新；需求档案记录胶囊方案与进度 |

验证情况（2026-11-24 11:58）：`npm run typecheck` 0 错误；`npx vitest run cuko` 6 个文件 117 个用例全过；`npx eslint .` 0 错误（34 个警告是旧的）；`npm run compile` 成功。用户用真实 DeepSeek 实测：第二轮起缓存命中 98%；切换推理等级后的第一次请求命中 0% 属正常（缓存还没写好），下一次恢复。

### 接手进度（2026-11-24 12:30）

1. 输入框下方「胶囊 + 点击浮动面板」（方案 A）：已完成，提交 `899bcbf`。两个胶囊 + `createPortal` 浮动面板；模块级组件 + `ComposerSlotsContext` 读数据，流式输出时面板不会自己关掉；`tokenTotalsTip` 换成 `usageDetailRows`。
2. 界面验证（第 6 节清单）：用户确认功能正常。
3. DeepSeek `/models` 扩展字段：已实测。`context_window` / `max_output_tokens` / `input_modalities` 与 `parseModelList` 一致，无需改动；另发现 `effort`（`supported_levels` + `default_level`），用户选 A，已接入：解析后写进 `api_meta` 并自动打开推理档位总开关，用户修改仍存 `user_meta` 且优先（同样在 `899bcbf`，含 3 个新测试）。
4. 需求档案：验收项已逐项打勾、`status` 改为 review、已跑 `npm run docs:index`。
5. 交付报告：见本次会话的最终报告。
6. push / 合并 / 版本号：已 push 到 origin 与 github（`4bf3891`）；合并与版本号待定。
7. 修掉一个打断使用的主进程弹窗（用户实测遇到）：`A JavaScript error occurred in the main process / Error: EPIPE: broken pipe, write`，堆栈偶然落在 `GrepTool` 的日志行上。提交 `d270edf`，详见第 9 节第 4 条。
8. 用户反馈「刷新模型自动读取接口档位后没有 off 档位，关不掉思考」：已修，提交 `70cb496`。规则是接口没给 `off` 就自动补一个放最前面；连带把默认档位兜底与「档位未知」的请求参数兜底都改成跳过 `off`（否则补了 `off` 后会默认把思考关掉）。
9. 用户反馈「设置页 API 参数值那列空着像没填」：已改，提交 `f34258b`。表头写「留空 = 用档位名」，占位符显示「留空则发 low」，表下补说明。留空时实际发出去的就是档位名本身。
10. 用户问「能否根据接口自动判断是 OpenAI 还是 Cuko 协议」：已实现，提交 `c1589f1` + `d7a3654`。获取模型时用 `guessProtocolFromModelList` 推断（实测差异见需求档案第 5 节）。提示时机按用户反馈调整过两次：**最初做的是获取模型时内联提示 → 改成只在保存时弹 `ckConfirm` 确认框 → 用户反馈两处都要，最终是黄色内联提示 + 保存时弹窗并存**；另外没点过「获取可用模型」直接保存时会主动探一次接口（只为判断协议，不改模型列表、失败不拦保存）。只提示不自动改，判断不保证 100% 准。顺带给 `ck-dialog-msg` 加了 `white-space: pre-line`、弹窗放宽到 340px，多行说明才看得出层次。
11. 用户反馈「保存时确认框不弹」：根因是 **Cuko 窗口没有 `#ck-dialog` 的 DOM**——`src/ui/cuko/index.html` 只带了壳页面的 CSS，没带 `partials/modals.html` 的 DOM，而 `ckDialog` 找不到元素时直接 `resolve(true)`（当成点了「确定」）。已修（提交 `bdf85bd`）：补上 DOM，并在缺 DOM 时打 `console.warn`。教训：Cuko 窗口复用了壳页面的设置页与共享模块，但**DOM 骨架不会自动带过来**，以后在 Cuko 窗口里用新的壳页面组件要确认 DOM 齐全。`src/ui/cuko/built.html` 是 `.gitignore` 的构建产物，不进提交。
12. 用户要求「明文放数据库太不好，要加密存储」：已实现，提交 `e38eca5`。用 Electron 内置 `safeStorage`（Windows DPAPI / macOS Keychain / Linux libsecret），密钥永不出主进程（`list-providers` 只给掩码）。**Linux 必须显式判断后端**：无密钥环时 Electron 回退 `basic_text`（假加密）而 `isEncryptionAvailable()` 仍返回 `true`，所以读 `getSelectedStorageBackend()`，`basic_text` / `unknown` 一律拒绝保存（用户选 A）。存储格式 `enc1$` + base64，旧明文启动时自动迁移（幂等）。细节见需求档案第 9 节。

### 剩余待办（2026-11-24 13:00）

1. **等用户重启 Cuckoo 验证密钥加密**（`e38eca5`）：需验证 ① 已有 Provider 的明文密钥启动后自动变成 `enc1$` 开头 ② 编辑 Provider 时密钥框显示掩码、留空保存不影响原密钥 ③ 发消息 / 获取模型正常 ④ 设置页能看到当前加密后端。
   - 已验证过的：EPIPE 弹窗（不再出现）、off 档位（符合预期）、API 参数值文案（符合预期）、协议提示与保存弹窗（符合预期）。
2. 验证通过后 push 新提交到 origin 与 github（当前 ahead 15）。
3. 问用户是否 / 何时合并回 master，版本号怎么定（当前 0.9.2）。

### 若重启后仍弹窗怎么办

1. 把新的完整堆栈发出来（看第一行 `at` 落在哪个文件哪一行）。
2. 检查 `src/app/entry.ts` 第 24~53 行的兜底是否在 `out/src/app/entry.js` 里（`findstr /c:"EPIPE" out\src\app\entry.js`）；没有就是没重新编译，跑 `npm run compile` 再来。
3. 若堆栈落在 `console.log` 之外（例如 `process.stdout.write` 直接调用），说明还有别的写控制台路径，需要同样包一层。

## 3. 关键决策

### 3.1 2026-11-24 新确认（步骤 4）

| 事项 | 结论 |
|---|---|
| 范围 | 只对 OpenAI 协议会话生效；Cuko 协议会话的显示和行为不变 |
| 上下文 | 最近一次请求的 `prompt_tokens`（照 harness 的 `pressureTokens`）；不估算、不加 `~`，比实际慢一拍可以接受；格式照 harness：小于 1000 原样，小于 100K 保留 1 位小数（8.2K），其余取整（350K），百万用 M |
| 60% 提醒 | 模型填了上下文窗口且用量 ≥ 60% 变橙色，显示「82.3K / 128K（64%）」，不拦发送 |
| 缓存命中 | 整个会话累计：Σ`cache_read_tokens` ÷ Σ(`cache_read_tokens` + `cache_miss_tokens`)，固定两位小数；没全中最多 99.99%，全中 100.00%；从没返回命中字段的会话不显示 |
| 会话用量 xxx tok | 当前会话每条落库回复的 `input_tokens` + `output_tokens` 求和（缺字段用 `total_tokens`），格式同上下文；与 harness 的差别：harness 还计入后来被重试的尝试，我们只算落库回复，实际几乎一样 |
| 排列 | 两个胶囊：① 数据库图标 + xxx tok · 缓存命中 xx.xx%（可点开面板）② 上下文 x.xK |
| 明细 | 先做的是悬停提示（`title`），用户实测「排版不好看、点了没浮窗」，改为方案 A（第 5 节），已实现（`899bcbf`） |
| 模型选择器 | 两级菜单：按钮显示「模型名 + 档位」（去掉 Default）；一级「模型 >」「推理等级 >」；运行中「模型」置灰、推理等级仍可改 |
| 推理等级 | 按会话存 `cuko_sessions.reasoning_effort`；新会话用模型默认档位；切模型同名沿用否则默认；未建会话先记在界面，建会话后保存；改档位不更新 `updated_at`（避免会话列表跳动）。2026-11-24 追加：接口没给 `off` 时自动补一个（`70cb496`），默认档位兜底跳过 `off` |
| 不支持时 | Cuko 协议或模型未开推理档位：「推理等级」行置灰、显示「不支持」，悬停提示原因 |
| 附件 | 本次完全不做（包括按钮置灰 / 发送前拦截）；主进程已有拦截（`cuko-runner.ts` 搜「当前模型暂不支持附件」） |
| 纯函数位置 | `src/ui/cuko/composer-stats.ts`（聊天界面不引用 `src/app`）；测试里与 `src/app/cuko-openai.ts` 交叉校验 60% 阈值与档位规则 |
| lint | 把 git 已忽略、且不含被跟踪文件的本地目录加进全局 ignores，单独 chore 提交 |

### 3.2 之前的决策（详见需求档案第 1~9、12 节，仍然有效）

- 接口用 Chat Completions；按 Provider「API 协议」分流；工具用 cuckoo 代码块；不用 system 角色，系统提示词与用户第一句合成第 1 条 user（分隔 `\n\n---\n\n`）。
- 历史来自 `cuko_messages.sent_role / sent_text`，写入即固定，每轮原样重放；思考内容不发回，只存 `think`。
- 停止 / 出错 / 断开：用户停止保留已输出正文；出错和断开整条不进历史。
- 重试仅 OpenAI：网络 / 断开 / 429 / 5xx，最多 3 次，间隔 2s / 4s / 8s，原样重发；400 / 401 / 403 / 404 与用户停止不重试。
- 跨协议切换：切到 OpenAI 直接改绑定并补齐旧原文；切到 Cuko 照旧 compress。
- 请求参数优先级：额外参数 < 最大输出 < 思考强度 < 必需字段；off 不发强度字段并合并「关闭思考参数」。DeepSeek 推荐：字段 `reasoning_effort`，关闭参数 `{"thinking":{"type":"disabled"}}`。
- 模型目录 `api_meta` / `user_meta` 分存，刷新不覆盖用户修改。
- 请求日志：保留 100 条摘要、最近 20 条原文；原文点开时经 IPC `cuko:get-request-log-raw` 读取。

## 4. 环境与约定

### 4.1 用户与沟通方式

- 用户自称小白，时区 Asia/Shanghai。
- 给用户的代码放在以三个反引号加 cuckoo 开头的代码块里；只用 `//` 单行注释，不用可选链 `?.`，不用 `throw`（用 `log` + `if/else` 收尾），工具函数都要 `await`，多行文本用反引号模板字符串。
- 需求确认一次只问一题：选项写成纯文本（A / B / C），给推荐和理由，用户回字母。
- 需要用户手动操作的步骤（重启、在界面上点击检查等），只用文字说明做什么、做完看什么，不给脚本，也不帮用户重启。
- 不要动 `deepseek-web-attachments/`；push / 合并前先问用户。
- 长任务（测试 / 类型检查 / lint / compile / 提交）放后台，再用只读脚本查结果。

### 4.2 运行环境

- Windows x64；`bash` 是 cmd.exe，`pwsh` 是 Windows PowerShell 5.1。
- 可用工具：`read` `readLines` `write` `edit` `glob` `grep` `bash` `pwsh` `deleteFile` `mysql` `webFetch` `mcpCall` 等；`runAgent` 在 Cuko 窗口必定失败（`src/app/entry.ts` 里「父窗口上下文不存在」）。
- 一个脚本 60 秒没有输出就判超时；`bash` 默认超时 30 秒；长输出会被截断或变成附件。

### 4.3 后台任务写法（已验证可用）

- 在 JS 里拼好 `.cmd` 文本（只能是 ASCII，不能有中文），base64 后用 `pwsh` 的 `[IO.File]::WriteAllBytes` 写到 `%TEMP%\cukoN.cmd`，再 `Start-Process -FilePath ... -WindowStyle Hidden` 启动。
- 每步输出写 `%TEMP%\cukoN-<步骤>.log`，末行 `EXIT=0` / `EXIT=1`；全部完成写 `%TEMP%\cukoN.done`。
- 查结果：`pwsh` 里循环最多 50 次、每次 1 秒等 done 文件（`timeoutMs: 58000`），再 `Get-Content -Tail` 读日志。
- 已用批次：`cuko` ~ `cuko17`（17 是本次文档提交）；下一个从 `cuko18` 开始。`%TEMP%\cuko-restart.cmd` 是之前的自动重启等待窗口，用户已要求不再使用。
- 中文提交说明：在 JS 里自己做 UTF-8 编码再 base64，写成无 BOM 的文件，`git commit -F` 提交。pre-commit 钩子会生成并带上 `docs/requirements/INDEX.md`，属正常。
- compile 完整约 1~2 分钟。

### 4.4 项目常用命令与产物

- `npm run typecheck`（三套 tsconfig：主应用 / hooks / cuko）、`npx vitest run cuko`、`npx eslint .`、`npm run compile`（含 `build-cuko`，生成 `src/ui/cuko/built.html`）。
- `npm start` 只编译主进程，不重建界面：改了界面必须先 `npm run compile`。
- `built.html` 里中文被转成 `\uXXXX`，检查构建产物时用 `findstr /m /c:"英文标识符"`。
- 生成物禁止手改：`src/ui/shell.html`、`src/ui/cuko/built.html`、`*.generated.ts`、`src/tools/api.d.ts`。
- 远程：`origin` = 阿里云 Codeup（本分支推这里，SSH）；`github` 本分支没推，是否同步待用户决定。
- 参考项目：`C:\d\SourceCode\2026\deepseek-harness2`（标签 `dsh-v0.2.2-rc.5`，只读参考）。
- 版本 `cuckoo-code@0.9.2`。

### 4.5 代码位置（行号会变，以 grep 为准）

| 位置 | 内容 |
|---|---|
| `src/ui/cuko/composer-stats.ts`（LF） | `CONTEXT_WARN_RATIO` `sessionCacheTotals` `formatHitPercent` `formatTokenCount` `lastPromptTokens` `contextDisplay` `reasoningLevelsOf` `effectiveEffort` `effortLabel` `reasoningUnsupportedReason` `sessionTokenTotals` `formatExactCount` `tokenTotalsTip` |
| `test/cuko-composer-stats.test.js`（LF） | 上述纯函数的测试（21 个用例） |
| `src/ui/cuko/app.tsx`（CRLF） | `ModelSelector`（两级菜单）；`ComposerSlotsContext` / `CukoComposerExtra` / `CukoUsage`（模块级稳定组件，数据从 context 读）；`ChatApp` 里的 `effort` 状态、`modelMetaOf`、`handleEffortChange`、return 前的 `usageView` / `composerExtra` |
| `src/app/ipc/cuko.ts`（CRLF） | `cuko:update-session-effort`；`cuko:update-session-model` 按规则算档位并返回 `reasoningEffort` |
| `src/app/cuko-preload.ts`（CRLF） | `updateSessionEffort`、`getRequestLogRaw` |
| `src/app/cuko-runner.ts`（CRLF） | 请求日志（`pushRequestLog` `redactHeaders` `tapRequestRaw` `tapResponseRaw` `releaseOldRaw` `listCukoRequestLogs` `getCukoRequestLogRaw`）；`openAiAttempt` `streamOpenAiRound` `switchToOpenAiModel` |
| `src/app/cuko-openai.ts` | OpenAI 协议纯函数（`normalizeUsage` `parseModelList` `resolveEffortAfterSwitch` 等） |
| `src/components/assistant-ui/elements/thread.aui.tsx` | `ComposerFooter` 插槽在 Composer 下方渲染（外层 `-mt-3`）；`ComposerExtra` 在附件按钮旁 |
| harness 参考 | `packages/client/ui-chat/src/client/chat/StatsPills.tsx` 296-348（`UsagePill` 与明细对话框）；`.../chat/token-format.ts`（`formatTokens` `formatExactTokens` `formatCacheHitPercent`）；`.../client/locale.ts`（中文文案）；`packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx`（弹出面板：`createPortal`、点外面关闭、Esc 关闭） |

## 5. 胶囊 + 浮动面板（方案 A，已完成）

- 只对 OpenAI 协议会话；Cuko 会话保持原来的「上下文 x.xx k」。
- 胶囊 1（可点击的 button）：数据库图标 + 「106K tok · 缓存命中 79.69%」。没有命中数据时只显示 tok；没有 tok 时这个胶囊不显示。
- 胶囊 2（只显示）：「上下文 9.3K」；≥ 60% 时橙色并显示「82.3K / 128K（64%）」。
- 样式：浅色底、圆角、细边框；图标和文字垂直居中（`inline-flex items-center`）；两个胶囊之间留间距，整体居中。用户反馈的问题是图标偏上、三项挤成一行、看不出哪项能点。
- 浮动面板（照 harness 的 UsagePill 对话框）：点击胶囊 1 打开，再点一次 / 点外面 / 按 Esc 关闭，显示在胶囊上方；标题「Token 用量」，右侧是精确合计（千分位）；下面几行：缓存命中 xx.xx%（无数据省略）、未缓存输入、缓存读取、输出，都用精确数字千分位。我们没有缓存写入字段，不显示这一行。
- 数据已备好：`sessionTokenTotals` 返回 `total / uncachedInput / cacheRead / output`，`formatExactCount` 做千分位，`sessionCacheTotals` + `formatHitPercent` 算命中率。不再使用的 `tokenTotalsTip` / `totalTip` 删掉，测试同步调整。
- 组件必须定义在模块级，数据从 `ComposerSlotsContext` 读；不要在 `ChatApp` 的渲染函数里定义组件，否则流式输出时组件被重新挂载，面板会自己关掉。
- 面板别被父元素裁剪：用 `createPortal` 挂到 `document.body`，或确认外层没有 `overflow: hidden`；注意 z-index。
- 已改完（`899bcbf`）：typecheck 0 错误；`npx vitest run cuko` 6 文件 120 用例全过；`eslint .` 0 错误 34 个旧警告；compile 成功，`built.html` 里已确认含 `fixed z-50 w-56 -translate-x-1/2 -translate-y-full`（面板样式），旧的 `tokenTotalsTip` 已不在产物里。
- 需求档案第 6 节的胶囊方案已在 `899bcbf` 里改成正式描述（原来那句「悬停显示明细」已替换）。

## 6. 界面验证清单（用户手动重启 Cuckoo 后检查）

OpenAI 协议会话（最好用 DeepSeek）：

1. 模型按钮显示「模型名 + 档位」，如 `DeepSeek-V4.1-Flash High`。
2. 点开有「模型 >」「推理等级 >」两行，鼠标移上去右边弹出对应面板。
3. 推理等级选 Max 后按钮变成 Max；切到别的会话再切回来仍是 Max。
4. 输入框下方是两个胶囊：「数据库图标 xxx tok · 缓存命中 xx.xx%」和「上下文 x.xK」，排版整齐。
5. 点击第一个胶囊弹出「Token 用量」面板，明细数字正确；点外面 / Esc 能关闭；流式输出时面板不会自己关掉。
6. 请求日志：记录上有「OpenAI」「命中 xx%」；点开有请求头 / 请求体 / 响应三块；Authorization 显示 `Bearer ****` 加后 4 位；请求体里有 `"reasoning_effort":"max"`。

Cuko API 会话：

7. 「推理等级」行置灰、显示「不支持」，悬停有原因。
8. 输入框下方仍是原来的「上下文 x.xx k」。

重启前提醒用户：如果标题为 cuckoo-restart 的黑色窗口还开着，先关掉它（它会在 Cuckoo 退出后自动 `npm start`，造成多开）。

## 7. DeepSeek /models 实测的做法

- 地址和密钥在本机 Cuko 数据库的 `cuko_providers` 表（`base_url` / `api_key` / `protocol`）。数据库文件位置看 `src/session/db.ts`（搜 `DatabaseSync` / `getPath`），再到 `%APPDATA%` 下带 cuckoo 的目录或 `%USERPROFILE%\.cuckoo` 里找 `.db` / `.sqlite`。
- 先确认本机 `node -e "require('node:sqlite')"` 可用，以只读方式打开数据库，取 `protocol = 'openai'` 且地址是 DeepSeek 的 Provider，在本机发 `GET {base_url}/v1/models`（地址末尾已有 `/v1` 不重复拼，规则同 `joinApiUrl`）。
- 只打印字段名和前两个模型的结构；密钥只在本机请求里用，不打印、不写文件、不放进日志。
- 现在 `parseModelList` 只读 `context_window` / `max_output_tokens` / `input_modalities`（从 harness 源码推出来的，未实测）；有出入就改并补测试。

## 8. 交接注意事项（别再踩的坑）

1. 判断分支是否存在不要用 `git branch --list`（空输出显示成 `(no output)`）；用 `git rev-parse --verify --quiet refs/heads/<分支>` 看退出码。
2. 脚本里不要 `throw`，否则前面的 `log` 全部丢失。
3. 长任务放后台，再用只读脚本查结果；后台编译时不要让用户 `npm start`。
4. `built.html` 里中文是 `\uXXXX`，搜英文标识符。
5. 改界面后必须 `npm run compile` 再让用户重启；安装版看不到改动。
6. 保持每个文件原来的换行符：`app.tsx` / `ipc/cuko.ts` / `cuko-preload.ts` / `cuko-runner.ts` / 需求档案 是 CRLF；`composer-stats.ts` / `cuko-openai.ts` 与 cuko 测试文件、**本文件** 是 LF（本文件此前写成了 CRLF，已更正；改它时保持 LF）。
7. 改文件前核对每个锚点只出现 1 次，并把读到的行用文件换行符拼回去，长度必须等于 `[IO.File]::ReadAllText` 的长度（或只差末尾一个换行）才写；多处改动按行号从后往前应用；有一处对不上就全部不写。
8. 聊天界面会把 secret / password 字样的变量赋值打码成 `[REDACTED_...]`，这不是源文件内容；新代码里不要用这类变量名。
9. 给用户的脚本只用 `//` 注释；块注释在后台报过「Unary operator used immediately before exponentiation expression」；不用 `?.`。
10. PowerShell 输出里 ✅ 会显示成 `?`；`npm warn Unknown env config "electron-mirror"` 和 git 的「LF will be replaced by CRLF」警告都可以忽略。
11. PowerShell 5.1 把数组通过管道交给 git 等外部命令时，每行末尾会多一个回车，`git check-ignore --stdin` 会一个都匹配不上；改成逐个调用。
12. 用 `Get-CimInstance Win32_Process` 按命令行找进程时，筛选字符串也在自己的命令行里，会把检查命令自己算进去；要限定进程名并排除 `$PID`。
13. `eslint .` 之前因 `tmp/` 等本地目录报 2553 个错误，已加 ignores；如果再出现大量错误，先按目录统计并确认是不是 git 已忽略的本地目录，别去修第三方文件。
14. 写 Markdown 时反引号就写反引号，不要用其它符号占位（旧需求档案第 12 节出现过占位符没替换回来的问题，已修）。
15. 遵守项目说明与 `.cuckoo/rules/*.md`；每一步都跑 typecheck / test / lint。

## 9. 已知问题（写进交付报告）

1. lint 覆盖缺口：`src/app/*.ts`、`src/ui/cuko/*.ts(x)` 等 ts 文件在 eslint 里提示「File ignored because no matching configuration was supplied」，实际没被 lint，只靠 typecheck 和测试；建议以后单独补 eslint 的 ts 配置。
2. 会话用量 tok 与 harness 的统计口径差异（见 3.1）。
3. 请求日志面板（`src/ui/cuko/request-log-dialog.tsx`）有自己的一份命中率算法（取整），和 `composer-stats.ts` 不共用。
4. OpenAI 会话的附件：界面按钮没置灰，发送时由主进程拦下并提示「当前模型暂不支持附件」。
   - 已修（`d270edf`，2026-11-24）：主进程 / 启动器写控制台遇到断管道（EPIPE）不再弹未捕获异常窗。
     原因是用 `npm start` 启动时 stdout 是管道，启动器窗口关掉后管道读端消失，之后任何 `console.log` 都会抛错；
     开发版 `ipc/logs.ts` 直接 `return` 没有兜底。修法：`entry.ts` 与 `start.js` 给 stdout/stderr 挂 `error` 兜底，
     并把 `console` 的 log/info/warn/error/debug/trace 包一层——Windows 上 stdout 指向管道时是同步写，
     写失败会同步抛错（堆栈落在 `console.log` 上，所以光挂 `stream.on('error')` 兜不住）。
     只拦写控制台这一步的失败，其余异常照旧上抛。
5. DeepSeek `/models` 扩展字段已实测（2026-11-24）：`context_window` / `max_output_tokens` / `input_modalities` 与解析一致；`effort`（`supported_levels` / `default_level`）已接入，自动预填推理档位。仍有未读字段 `output_modalities` / `api_capabilities`，本版不需要。
6. 旧问题清单（不在本次范围）：`runAgent` / `nameConversation` 在 Cuko 窗口必定失败；Cuko 协议切模型时 compress 没拿到 `providerSessionId` 会存 null；`switchModelWithHistory` 没有超时、不能取消；compress 历史时 `write` 的结果被替换；`select-directory` 用 `showOpenDialogSync` 会卡主进程；删 Provider 后绑定它的会话无人处理；自定义回复语在主进程不生效；`api_key` 明文保存且会返回给界面；`friendlyError` 缺 `idempotency_conflict`；`db.ts` 回填工作区用 UTC 时间；旧需求档案 `261109-8ms69z-cuko-api.md` 有 4 处与代码不一致。
7. push 走 SSH：后台 push 要设 `GIT_SSH_COMMAND=ssh -o BatchMode=yes -o ConnectTimeout=20`，避免卡在密码或指纹确认。

## 10. 需要用户决定的事

1. 是否 push 到 origin（Codeup）；是否同步到 github；是否需要合并请求。
2. 是否、何时把 `feat/261123-q4h7tn-cuko-openai` 合并回 `master`，版本号怎么定（当前 0.9.2）。
3. 界面验证结果（第 6 节）：用户已确认功能正常。

# Cuko 接入 OpenAI 兼容接口：交接文档

> 需求 ID：`261123-q4h7tn-cuko-openai`；分支：`feat/261123-q4h7tn-cuko-openai`；整理时间：2026-11-24（Asia/Shanghai）
> 项目根目录：`C:\d\SourceCode\2026\cuckoo-code`

## 1. 任务背景与最终目标

### 1.1 用户的原始需求
- 先读懂 Cuckoo Code 的 Cuko API 部分，再让 Cuko 支持标准 OpenAI 接口。用户原话：
  > “我不想转换……如果用户选择了 OpenAI Chat Completions 的协议供应商，那么在 cuko api 对话框下方的模型选择，选择了设置了 OpenAI Chat Completions 的模型就用 OpenAI Chat Completions 协议，选择 cuko api 就用 cuko api”
- 后加：请求日志要像 Chrome 开发者工具的网络面板，原始请求报文是什么样就显示什么样。

### 1.2 约束条件
> “我们不用 function calling，我们的 agent 的特点就是对话内联工具调用，包括系统提示词我们也不用系统提示词，我们都用用户提示词，原因是我们是一个开放的、能让用户看到 ai 到底在做什么的 agent，还有要兼容 deepseek 的思考内容响应，还要考虑 deepseek 的命中缓存，尽最大努力去命中缓存，也就是每次发送之前的对话不要变化”

- 不用 `tools` / function calling，不用 `system` 角色；工具调用继续用 cuckoo 代码块；兼容 `reasoning_content`。
- 每轮发出的历史只在末尾追加，前面一字不变（命中 DeepSeek 前缀缓存）。
- 这一版不支持附件。

### 1.3 验收标准（需求档案 `docs/requirements/261123-q4h7tn-cuko-openai.md`）
- 纯函数单测通过；OpenAI 协议多轮对话 + 工具循环可用；DeepSeek 第二轮起缓存命中 > 0。
- 设置页可选协议、刷新模型不丢用户修改；聊天窗口：思考强度选择、命中率、60% 提醒、附件拦截。
- Cuko 协议行为不变；`typecheck` / `test` / `lint` / `compile` 全绿。
- 请求日志能看请求头（密钥打码）/ 请求体原文 / 响应原文。

## 2. 当前进度

### 已完成
| 状态 | 内容 | 依据 |
|---|---|---|
| ✅ | 需求讨论 21 题 + 请求日志 2 题全部确认（见第 3 节） | 对话 |
| ✅ | 步骤 1：`src/app/cuko-openai.ts`（纯函数）+ SSE 解码器 `flush()` + `test/cuko-openai.test.js` | 后台检查全绿 |
| ✅ | 2-1 / 2-2：补列、flush、出错不执行工具、断开标记不完整 | 提交 `1cb6b18` |
| ✅ | 2-3：运行器接入 OpenAI 协议（原文重放 / 停止出错 / 自动重试） | 提交 `3c0ac66` |
| ✅ | 2-3b：切到 OpenAI 模型时直接改绑定并补齐旧原文 | 提交 `f5c1c40` |
| ✅ | 2-5：`test/cuko-runner-openai.test.js`（5 个用例：前缀不变 / 工具循环 / 503 重试 / 401 / 停止） | 提交 `278375e` |
| ✅ | 3-1：Provider 协议与参数读写、模型目录合并写入、按表单获取模型 | 提交 `4c36f3d` |
| ✅ | 3-2：设置页支持 OpenAI 协议、请求参数、可编辑模型目录与推理档位 | 提交 `98dcb1d`；用户确认页面已有 |
| ✅ | 请求日志：协议 / 第几次尝试 / 用量与缓存命中 / 本轮新增条数；点开看请求头（密钥打码）、请求体原文、响应原文；只保留最近 20 条原文 | 本次提交（后台批次 cuko4 检查、cuko6 提交） |

> 2-x / 3-x 的提交不是本对话写的代码，执行者待确认。完整提交列表：`git log master..HEAD`。

### 待确认 / 未开始
- ❓ 步骤 2-4：没看到对应提交，内容待确认。
- ❓ 步骤 4 聊天窗口：思考强度选择器、输入框下方「上下文 x.xx k · 缓存命中 xx%」、60% 提醒、OpenAI 会话附件拦截，是否已做待确认。
- ⬜ 请求日志的测试断言。
- ⬜ 用户重启（`npm start`）后验证请求日志面板。
- ⬜ 真实 DeepSeek 验证第二轮起 `prompt_cache_hit_tokens > 0`。
- ⬜ 实测 DeepSeek `/models` 返回的扩展字段。
- ⬜ 需求档案验收项逐项打勾；是否合并回 `master`（待用户决定）。

## 3. 关键决策与原因

| # | 事项 | 结论 | 原因 / 放弃的方案 |
|---|---|---|---|
| 1 | 接口 | Chat Completions（`/v1/chat/completions`） | 兼容面最广；放弃 Responses API、放弃两种都做 |
| 2 | 分流 | 按 Provider「API 协议」分流，不加转换服务 | 用户要求 |
| 3 | 工具 | cuckoo 代码块，不用 function calling | 用户要求；所有模型可用 |
| — | 角色 | 不用 system，只有 user / assistant | 开放透明 |
| 4 | 系统提示词 | 与用户第一句话合成第 1 条 user，分隔 `\n\n---\n\n` | 角色交替、缓存友好 |
| 5 | 历史来源 | `cuko_messages.sent_role / sent_text` 写入即固定，每轮原样重放 | 照 deepseek-harness「会变的东西写入时固定」；放弃按规则重拼、放弃只存内存 |
| 6 | 思考内容 | 不发回，只存 `think` 并折叠显示 | DeepSeek 文档：请求不带 tools 时无需回传，回传也被忽略 |
| 7-8 | 附件 | 本版不做；OpenAI 会话发送前拦下并提示 2 秒 | 用户决定；不悄悄丢 |
| 9 | 跨协议切换 | 切到 OpenAI 直接改绑定，旧消息缺的原文切换时补齐后固定；切到 Cuko 照旧 compress | 不多发请求，历史完整 |
| 10 | 停止 / 出错 | 用户停止：已输出正文进历史；出错 / 断开：整条不进历史；未执行脚本写「（运行被停止，脚本未执行）」 | 照 harness 的 assistant/attempt 与 assistant/message 区分 |
| 11 | 重试 | 仅 OpenAI：网络 / 断开 / 429 / 5xx，最多 3 次，间隔 2s / 4s / 8s，原样重发；400 / 401 / 403 / 404 与用户停止不重试 | 前缀不变，缓存不受影响 |
| 12 | 设置页 | 协议下拉可选；获取模型走主进程；`joinApiUrl` 不重复拼 `/v1` | 原下拉写死、渲染进程跨域 |
| 13 | 缓存命中 | 归一 `cache_read_tokens` / `cache_miss_tokens`，存库并显示 | DeepSeek：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；OpenAI：`prompt_tokens_details.cached_tokens` |
| 14 | 顺带修 bug | 只修 #1 出错仍执行工具、#4 末帧丢失、#5 断开显示完成、#9 用户消息由界面保存、#10 改标题失败卡住 | 新功能依赖，其余留到以后 |
| 15 | 超长 | 不压缩；用量 ≥ 60% 提醒但允许继续发送；真超出时提示新开会话 | 用户要求 |
| 16 | 额外参数 | Provider「额外请求参数（JSON）」原样合并，不能覆盖必需字段 | 各家特殊参数通用 |
| 17 | 模型目录 | 每模型：名称 / 上下文窗口 / 最大输出 / 输入类型（本版不生效）/ 推理档位表；`api_meta` 与 `user_meta` 分存，刷新不覆盖用户修改；可手动添加；不内置模型表 | 用户要求必须有思考强度设置 |
| 18 | 思考强度存哪 | 按会话（`cuko_sessions.reasoning_effort`）；新建用模型默认档位；切模型同名档位沿用 | 多会话并行互不干扰 |
| 19 | 思考强度怎么发 | 字段名可改（默认 `reasoning_effort`）；off 不发该字段并合并「关闭思考参数（JSON）」；优先级 额外参数 < 最大输出 < 思考强度 < 必需字段 | DeepSeek 默认开思考（强度 high） |
| 日志 1 | 请求日志补齐 | 协议、第几次尝试（2/4）、用量与命中率、本轮新增条数 | 验证缓存 / 参数的唯一途径 |
| 日志 2 | 原始报文 | 请求头（密钥打码）/ 请求体原文 / 响应原文；保留最近 20 条；点开时经 IPC 读取 | 放弃只看请求体、放弃 100 条全存 |

DeepSeek 推荐配置：字段名 `reasoning_effort`；关闭思考参数 `{"thinking":{"type":"disabled"}}`；档位 off / low / high / max（medium、xhigh 按 high，ultra 按 max）。

## 4. 重要上下文与事实

### 4.1 用户与沟通方式
- 用户自称小白，只能通过一个老旧后台的 JS 窗口操作这台 Windows x64 机器。给用户的代码必须放在以 ```cuckoo` 开头的代码块里，工具函数都要 `await`，多行文本用反引号模板字符串。
- 需求确认一次只问一题，给选项 + 推荐 + 理由；选项直接写成纯文本，不用选择卡，用户回复字母。时区 Asia/Shanghai。

### 4.2 JS 窗口环境
- 可用工具：`read` `readLines` `write` `edit` `glob` `grep` `bash`（cmd.exe）`pwsh` `deleteFile` `mysql` `webFetch` `runAgent` `mcpCall` 等。
- 60 秒无输出就判超时；`bash` 默认超时 30 秒；长输出会被截断或变成附件。
- 脚本一旦 `throw`，前面的 `log` 全部丢失。
- `runAgent` 在这个窗口和 Cuko 窗口都会失败（「父窗口上下文不存在」，`src/app/entry.ts:941-943`）。

### 4.3 项目
- Electron 44 / TypeScript / 纯 ESM / Vitest；规则：`.cuckoo/rules/overlay.md`、`shell-ui.md`、`test.md`。
- 生成物禁止手改：`src/ui/shell.html`、`src/ui/cuko/built.html`、`*.generated.ts`、`src/tools/api.d.ts`。
- 需求档案 `docs/requirements/`；`npm run docs:index` 生成 `INDEX.md`。
- 常用命令：`npm run typecheck`、`npx vitest run cuko`、`npm run compile`、`node scripts/build-cuko.mjs`、`npm start`。
- 远程 `origin`（地址见 `git remote -v`）。未跟踪目录 `deepseek-web-attachments/`：不要动、不要提交。
- 参考项目 `C:\d\SourceCode\2026\deepseek-harness2`：停在标签 `dsh-v0.2.2-rc.5`（`9c2670d3bc`，detached HEAD），远程 github.com/deepseek-ai/deepseek-harness。
- 当前版本 `cuckoo-code@0.9.2`。

### 4.4 代码位置（行号会变，以 grep 为准）
| 位置 | 内容 |
|---|---|
| `src/app/cuko-openai.ts` | 纯函数：`normalizeProtocol` `joinApiUrl` `composeFirstUserText` `buildToolSentText` `backfillSentRows` `buildChatMessages` `buildChatCompletionsBody` `normalizeUsage` `cacheHitRatio` `createChatStreamParser` `classifyFailure` `retryDelayMs` `MAX_RETRIES=3` `parseModelList` `effectiveModelMeta` `reasoningRequestOf` `contextUsageOf`（`CONTEXT_WARN_RATIO=0.6`） |
| `src/app/cuko-run-protocol.ts` | `createSseDecoder`（含 `flush()`、CRLF 跨数据块）；`friendlyError` 缺 `idempotency_conflict` |
| `src/app/cuko-runner.ts`（CRLF 换行） | `CukoRequestLogEntry`、`requestParamsOf`、`pushRequestLog`、`redactHeaders`、`tapRequestRaw`、`tapResponseRaw`、`releaseOldRaw`、`getCukoRequestLogRaw`；`openAiAttempt`、`streamOpenAiRound`、`switchToOpenAiModel` |
| 常量 | `REQUEST_LOG_MAX=100` `REQUEST_LOG_PREVIEW=10` `REQUEST_LOG_RAW_KEEP=20` `RESPONSE_RAW_MAX=2000000` |
| `src/app/ipc/cuko.ts` | `cuko:get-request-logs`、`cuko:get-request-log-raw` |
| `src/app/cuko-preload.ts` | `getRequestLogRaw(id)` |
| `src/ui/cuko/request-log-dialog.tsx` | 日志面板：每 1.5 秒刷新摘要，点开读原文，原文 / 格式化切换，复制按钮 |
| `src/ui/shell/scripts/pages/settings-cuko.tsx` | Cuko 设置页（eslint 有一条「文件被忽略」警告，可忽略） |
| `src/session/db.ts` | 建表 / 兜底 `ALTER TABLE`；`CURRENT_DB_VERSION=5` 未升 |
| 测试 | `test/cuko-openai.test.js`、`test/cuko-run-protocol.test.js`、`test/cuko-runner-openai.test.js` 等，cuko 相关共 5 个文件 93 个用例 |

新增列的实际名称由 2-x / 3-x 实现，待确认：`grep "ADD COLUMN" src/session/db.ts`。

### 4.5 后台任务的写法（已验证可行）
- 用 `pwsh` 把一个 `.cmd` 写到 `%TEMP%`，再用 `Start-Process -WindowStyle Hidden` 启动。
- 每步输出写 `%TEMP%\cukoN-<步骤>.log`，末行 `EXIT=0` / `EXIT=1`；全部完成写 `%TEMP%\cukoN.done`（第一批叫 `cuko-check.done`）。
- 已用批次：`cuko`、`cuko2`、`cuko3`、`cuko4`（请求日志改动的检查）、`cuko5`（上一次提交尝试，结果待确认）、`cuko6`（本次提交 + push）。
- 中文提交说明要先用 PowerShell 按 UTF-8（无 BOM）写成文件再 `git commit -F`；`.cmd` 文件本身用 ASCII 编码，不能含中文。

## 5. 产出物清单
- `docs/requirements/261123-q4h7tn-cuko-openai.md`（含第 12 节与进度记录）、`docs/requirements/INDEX.md`
- `docs/handover/261123-q4h7tn-cuko-openai-handover.md`（本文件）
- `src/app/cuko-openai.ts`、`src/app/cuko-run-protocol.ts`、`src/app/cuko-runner.ts`、`src/app/ipc/cuko.ts`、`src/app/cuko-preload.ts`、`src/ui/cuko/request-log-dialog.tsx`、`src/ui/shell/scripts/pages/settings-cuko.tsx`
- `test/cuko-openai.test.js`、`test/cuko-runner-openai.test.js`
- 生成物 `src/ui/cuko/built.html`、`src/ui/shell.html`（是否被 git 跟踪待确认）

## 6. 未解决问题与风险
1. 步骤 4 状态待确认。
2. 请求日志没有测试。
3. 缓存命中没有用真实 DeepSeek 验证，只有单测和假服务测试证明前缀不变。
4. DeepSeek `/models` 的扩展字段是从 harness 源码推出来的，未实测。
5. 问题清单遗留（不在本次范围）：
   - `runAgent` / `nameConversation` 在 Cuko 窗口必定失败（`entry.ts:941-943`、`:959-961`）；
   - Cuko 协议切模型时 compress 没拿到 `providerSessionId` 会存 null；
   - `switchModelWithHistory` 没有超时、不能取消；
   - compress 历史时 `write` 的结果被替换（`compress-history.ts`）；
   - `select-directory` 用 `showOpenDialogSync` 会卡主进程；
   - 删 Provider 后绑定它的会话无人处理；
   - 自定义回复语在主进程不生效（`setSharedSettingReader` 只在 `src/bridge/entry.ts:254` 注入）；
   - `api_key` 明文保存且会返回给界面；
   - `friendlyError` 缺 `idempotency_conflict`；
   - `db.ts:217` 回填工作区用 UTC 时间；
   - 旧需求档案 `261109-8ms69z-cuko-api.md` 有 4 处与代码不一致。
6. push 需要凭据时会直接失败（已关闭交互提示），需要用户自己配置。
7. pre-commit 钩子耗时不确定，所以提交放在后台执行。

## 7. 下一步行动清单（按优先级）
1. 查 `%TEMP%\cuko6-*.log`：commit / push 是否 `EXIT=0`，`git status -sb` 是否与 origin 同步。
2. 请用户关掉 Cuckoo 后运行 `npm start`，用 OpenAI 模型发两轮，打开请求日志检查：「OpenAI」「命中 xx%」、点开有请求头 / 请求体 / 响应三块、密钥显示为 `Bearer ****` + 后 4 位。
3. 核对步骤 4：`grep "reasoningEffort|reasoning_effort|cacheHitRatio|contextUsageOf" src/ui/cuko`；没做就按第 3 节第 15、18 题实现。
4. 在 `test/cuko-runner-openai.test.js` 补断言：`usage.cache_read_tokens` 有值；503 重试后日志 `attempt` 依次 1、2，`maxAttempts` 为 4；`getCukoRequestLogRaw(id).requestBody` 等于假服务收到的请求体；Authorization 已打码；超过 20 条后旧记录 `rawReleased` 为 true；列表接口不含 `requestBody`。
5. 用真实 DeepSeek 跑多轮 + 工具，确认第二轮起命中 > 0（密钥不要贴在聊天里）。
6. 实测 DeepSeek `/models`，有出入就调整 `parseModelList`。
7. 需求档案验收项打勾，`status` 改为 done 或 review，运行 `npm run docs:index`。
8. 问用户是否合并回 `master`、版本号怎么定。

## 8. 交接注意事项（别再踩的坑）
1. 判断分支是否存在不要用 `git branch --list`：空输出会显示成 `(no output)`，被当成分支名。用 `git rev-parse --verify --quiet refs/heads/<分支>` 看退出码。
2. 脚本里不要 `throw`，用 `log` + `if/else` 结束，否则前面的输出全丢。
3. 长任务（测试 / 类型检查 / 编译 / 提交）放后台，再用只读脚本查结果。
4. `built.html` 里的中文被 esbuild 转成 `\uXXXX`，检查构建产物要搜英文标识符（如 `getRequestLogRaw`）。
5. 改界面后必须 `npm run compile` + `node scripts/build-cuko.mjs`，再用 `npm start` 启动；安装版看不到改动；不要在后台编译时 `npm start`。
6. `cuko-runner.ts` 是 CRLF 换行，整文件重写时要保留。
7. 改代码前先核对每处原文的出现次数，有一处对不上就全部不写。
8. 聊天界面会把带 secret / password / token 字样的变量名打码成 `[REDACTED_...]`，代码里不要用这类名字。
9. 给用户的脚本只用双斜杠单行注释：用「斜杠加两个星号」开头的块注释时，后台报过「Unary operator used immediately before exponentiation expression」；稳妥起见也不用可选链 `?.`。
10. PowerShell 输出里 ✅ 会显示成 `?`；`npm warn Unknown env config "electron-mirror"` 可以忽略。
11. 遵守项目说明与 `.cuckoo/rules/*.md`；生成物禁手改；每一步都跑 typecheck / test / lint。

接手前先读：本文件 → 需求档案 → `git log master..HEAD --stat` → `src/app/cuko-openai.ts` → `src/app/cuko-runner.ts` 的 `streamOpenAiRound` 与请求日志部分。

## 9. 需要用户补充的信息
1. 2-x / 3-x 是哪个 AI 或对话做的，有没有它的交接记录；步骤 2-4 和步骤 4 是否已完成。
2. `origin` 能否直接 push，是否需要提 PR。
3. 是否、何时把 `feat/261123-q4h7tn-cuko-openai` 合并回 `master`，版本号怎么定。
4. 重启后请求日志面板的验证结果（截图或文字）。

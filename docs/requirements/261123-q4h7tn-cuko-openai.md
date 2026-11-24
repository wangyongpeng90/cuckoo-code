---
id: 261123-q4h7tn-cuko-openai
type: feature
title: Cuko 接入 OpenAI 兼容接口（Chat Completions）
status: review
branch: feat/261123-q4h7tn-cuko-openai
created: 2026-11-23
updated: 2026-11-24
---

# Cuko 接入 OpenAI 兼容接口（Chat Completions）

## 背景

Cuko 目前只支持 Cuko API（Stateful Provider 保存上下文，客户端只发增量）。本需求新增 OpenAI 兼容的 Chat Completions 协议（DeepSeek、通义、Kimi、Ollama、OneAPI 等），同时保持 Cuckoo 的特点：工具调用内联在对话里、所有内容用户可见；并尽最大努力命中 DeepSeek 前缀缓存（每轮发送的历史只在末尾追加，前面一字不变）。

设计参考 deepseek-harness（dsh-v0.2.2-rc.5）：会变的东西写入时固定、只追加不修改、失败尝试不进历史、重试原样重发。

## 1. 协议选择

- `cuko_providers.protocol` 新增取值 `openai`；空值 / `cuko` / `cuko-api` 一律按 Cuko 处理，原有逻辑不变。
- 按会话绑定的 Provider 协议分流，不加任何中间转换服务。
- OpenAI 协议：`POST {baseUrl}/v1/chat/completions`；地址末尾已有 `/v1` 时不重复拼（`joinApiUrl`），获取模型列表同规则。

## 2. 消息与历史（前缀不变）

- 不使用 `system` 角色，不使用 `tools` / function calling；工具调用仍是 cuckoo 代码块。
- 第一条 user 原文 = 系统提示词全文 + `\n\n---\n\n` + 用户第一句话。
- `cuko_messages` 新增 `sent_role`（user / assistant）、`sent_text`（发给模型的原文），写入时固定、以后不再修改。每轮按 rowid 顺序取 `sent_text` 非空的行原样重放。
  - 用户消息：用户原话（第一条拼系统提示词；提示词仍留档在 `cuko_sessions.system_prompt` 与 role=system 行）。
  - AI 回复：只存模型输出的正文，不含 think、不含 Cuckoo 追加的提示。
  - 工具卡片：`sent_role=user`，原文 = 随机回复语 + 每个脚本「标题 + 结果」；标题沿用网页模式的脚本标题模板。
- 相邻同角色消息发送时用 `\n\n` 合并（只在末尾追加，前缀不变）。
- 思考内容（reasoning_content）不发回，只存 `think` 并在界面折叠显示。DeepSeek 官方文档：请求不带 tools 时无需回传，回传也会被忽略。

## 3. 停止 / 出错 / 重试（照 harness）

- 用户停止且已有输出：模型已输出的正文作为 assistant 原文保留。
- 用户停止且无输出：不存 assistant 原文。
- 出错 / 中途断开：界面照常显示、库里照常保存，但 `sent_text` 为空，不进历史。
- 工具被停止：未执行的脚本结果写「（运行被停止，脚本未执行）」。
- 自动重试（仅 OpenAI 协议）：网络错误、未收到结束标记即断开、HTTP 429、5xx 重试，最多 3 次，间隔 2s / 4s / 8s；401 / 403 / 400 / 404 与用户停止不重试。重试原样重发同一请求体；新增运行事件 `round-retry`（界面清掉本轮已显示内容并提示「正在重试（2/3）」）；每次尝试都记请求日志。

## 4. 请求参数

- 必需字段：`model`、`messages`、`stream: true`、`stream_options: {include_usage: true}`。
- Provider 新增：额外请求参数（JSON）、推理强度字段名（默认 `reasoning_effort`）、关闭思考参数（JSON）。
- 合并优先级（低 → 高）：额外请求参数 → 模型最大输出（`max_tokens`）→ 思考强度 → 必需字段。选 off 时删掉推理强度字段，再合并「关闭思考参数」。
- DeepSeek 推荐配置：字段名 `reasoning_effort`，关闭思考参数 `{"thinking":{"type":"disabled"}}`（DeepSeek 默认开启思考，强度 high）。

## 5. 模型目录

- `cuko_models` 新增：`api_meta`（接口返回：上下文窗口 / 最大输出 / 输入类型）、`user_meta`（用户修改：名称 / 上下文窗口 / 最大输出 / 输入类型 / 推理档位表 / 默认档位）、`source`（接口 / 手动）、`listed`（最近一次刷新接口是否返回）。
- 刷新只更新 `api_meta`，不删模型、不覆盖用户修改；接口不再返回的标「接口未返回」；「恢复默认」= 清空 `user_meta`；可手动添加模型。
- 获取模型改走主进程（新增按表单地址 / 密钥获取的 IPC）；扩展字段读 `context_window` / `max_output_tokens` / `input_modalities`，以及 DeepSeek 实测到的 `effort`（`supported_levels` + `default_level`）。
- 2026-11-24 追加（已实现，提交 899bcbf）：`effort` 解析规则——`supported_levels` 只认非空字符串并去重；`default_level` 不在档位表里就忽略；解析结果写进 `api_meta` 并自动打开推理档位总开关；一个档位都没返回（或字段类型不对）就当作没返回，不凭空打开总开关；用户修改仍存 `user_meta` 且优先于接口值。
- 实测记录（2026-11-24）：DeepSeek `GET /v1/models` 返回 200，字段 `id` / `object` / `owned_by` / `name` / `context_window`（1048576）/ `max_output_tokens`（393216）/ `input_modalities`（`["text","image"]`）/ `output_modalities` / `effort` / `api_capabilities`；原有三个字段的类型与解析规则一致，无需改动。
- 推理档位：每档一个 API 参数值（为空时用档位名），总开关，可标默认档位；打开总开关时预填 off / low / high / max。
- 2026-11-24 追加（已实现，提交 70cb496）：**接口没给 `off` 时自动补一个**。模型能思考就应当能关掉思考，DeepSeek 只返回 `["low","high","max"]` 会让界面没有 off 档位。规则：
  - 接口档位里没有 `off` 就补一个、放最前面（与设置页预填顺序一致）；接口自己给了 `off` 就不重复、顺序也不动。
  - 连带修正默认档位兜底：从「第一个档位」改为「第一个非 off 档位」。补了 `off` 后它排第一位，若接口没给有效默认档位，会话会默认把思考关掉。
  - 档位未知时的请求参数兜底同理（`reasoningRequestOf`）：不因为认不出档位就悄悄关闭思考；用户明确选 `off` 仍然照旧发关闭参数。
  - 界面侧 `effectiveEffort`（`src/ui/cuko/composer-stats.ts`）与上述规则一致，测试里交叉校验。
- 2026-11-24 追加（已实现，提交 f34258b）：设置页「API 参数值」写清留空含义——表头改成「API 参数值（留空 = 用档位名）」，输入框占位符显示「留空则发 low」，表下补说明。留空时实际发出的就是档位名本身，只有接口要求别的值（如档位叫 high、要发 high-effort）才需要填。不再使用的 `tokenTotalsTip` / `totalTip` 已删除。
- 2026-11-24 追加（已实现，提交 c1589f1）：**获取模型时推断 API 协议并在不一致时提示**。Cuko API 与 OpenAI 兼容接口的 `GET /v1/models` 路径相同但返回格式不同，用户选错协议要等到发消息才报错：
  - 实测差异：OpenAI（DeepSeek）= `{ object: "list", data: [{ id, object: "model", owned_by, ... }] }`；Cuko API（本地 3000）= `{ data: [{ id, name }] }`。
  - 判据（`guessProtocolFromModelList`）：顶层 `object=list` / 模型项 `object=model` / 有 `owned_by` 任一成立 → `openai`；所有模型项只有 `id` 和 `name` 且至少一项带 `name` → `cuko`；其它情况返回 `null`（判断不了就不打扰用户）。
  - **只提示、不自动改**（判断不保证 100% 准，猜错不能改坏配置）。
  - 提示时机（2026-11-24 用户反馈后调整，提交 d7a3654 → 恢复内联提示并加主动探测）：**两处都提示**——① 获取模型后在协议下拉下方显示黄色内联提示（带「改为 xxx」「忽略」）；② 点「保存」时弹自定义确认框（`ckConfirm`，不是系统 alert），文案说明接口返回更像哪个协议、当前选的是哪个，两个选择：「取消」回去改协议、「确定」没选错、照常保存。
  - 没点过「获取可用模型」直接点保存时：主动调一次 `fetchModels` 只为判断协议（不改模型列表、不弹「已获取 n 个模型」、失败不拦保存），再按推断结果决定要不要弹窗。
  - 推断结果只在本次编辑期间保留：换 API 地址、保存成功后清掉；手动改协议不清（推断针对的是接口返回，与用户最终选哪个无关）。没点过「获取可用模型」就没有推断结果，不弹窗打扰。
  - 连带修复：`ck-dialog-msg` 加 `white-space: pre-line`、弹窗宽度 280px → 340px，让多行说明能正常换行（插件启用 / 卸载等已有的多行确认框一并受益）。
  - **Cuko 窗口没有通用确认弹窗 DOM（提交 bdf85bd）**：`src/ui/cuko/index.html` 只带了壳页面的 CSS，没带 `partials/modals.html` 里的 `#ck-dialog`，`ckDialog` 找不到元素时直接 `resolve(true)`（当成点了「确定」），导致协议确认框静默通过。补上 DOM，并在缺 DOM 时打 `console.warn` 便于排查。`built.html` 是 `.gitignore` 的构建产物，不进提交。
- 输入类型保存但本版不生效（界面标注「暂未生效」）。

## 6. 聊天窗口（2026-11-24 确认）

只对 OpenAI 协议会话生效；Cuko 协议会话的显示与行为不变。

- 模型选择器改成两级菜单（参考 deepseek-harness）：
  - 按钮显示「模型名 + 推理等级」，如 `DeepSeek-V4.1-Flash Max`；Cuko 协议或未开推理档位的模型只显示模型名；去掉固定的「Default」字样。
  - 一级菜单两行：「模型 >」「推理等级 >」，悬停或点击展开二级面板。
  - 模型面板：保留搜索、「重新获取」、按 Provider 分组、选中打勾；切模型流程不变（有历史先确认）；运行中「模型」行置灰。
  - 推理等级面板：列出模型在设置页配置的档位（显示时首字母大写，如 max → Max），选中打勾；点击即按会话保存（`cuko_sessions.reasoning_effort`），下一次请求生效；运行中也可以改（只改请求参数，不改历史，不影响缓存）。
  - Cuko 协议会话、或未开推理档位的模型：「推理等级」行置灰、不能展开，右侧显示「不支持」，悬停提示原因（「Cuko API 协议不支持选择推理等级」/「该模型未设置推理档位，可在设置页开启」）。
  - 档位规则：新会话用模型默认档位；还没建会话时先记在界面，建会话后保存；切模型时同名档位沿用，否则用新模型默认档位；会话里存的档位不在模型档位表里时，按默认档位显示和发送。
- 输入框下方显示 `12.3M tok · 缓存命中 97.35% · 上下文 3.7K`（tok 前有数据库图标）：
  - 会话累计用量（照 harness UsagePill）：当前会话每条已保存回复的 `input_tokens` + `output_tokens` 求和（缺字段时用 `total_tokens`），格式同「上下文」，后缀 ` tok`，前面数据库图标；累计为 0 不显示；悬停显示明细「合计 / 未缓存输入 / 缓存读取 / 输出」（精确数字，千分位）。与 harness 的差别：harness 计入每次尝试上报的用量（含之后被重试的尝试），本项目只统计落库的回复；会触发重试的失败通常还没收到用量，实际几乎一致。
  - 缓存命中：整个会话累计（照 harness），只统计带命中字段的请求，Σ`cache_read_tokens` ÷ Σ(`cache_read_tokens` + `cache_miss_tokens`)（DeepSeek 即 Σ命中 ÷ Σ`prompt_tokens`）；固定两位小数；没全部命中时最多显示 `99.99%`，全部命中显示 `100.00%`；从没返回过命中字段的会话不显示。
  - 上下文：最近一次请求的 `prompt_tokens`（接口准确值，即 harness 的 `pressureTokens`；不估算、不加 `~`，比实际慢一拍）；格式照 harness：小于 1000 原样，小于 100K 保留 1 位小数（`8.2K`），100K 及以上取整（`350K`），百万用 `M`。
  - 60% 提醒：模型填了上下文窗口且用量 ≥ 60% 时变提醒色，显示 `上下文 82.3K / 128K（64%）`，百分比取整；不拦发送。
  - 真正超出上下文时，沿用运行器现有提示（新开会话或换更长上下文的模型）。
- 2026-11-24 追加（已实现，提交 899bcbf）：输入框下方改成两个胶囊（照 harness）：① 可点击的「数据库图标 + xxx tok · 缓存命中 xx.xx%」，点击弹出浮动面板「Token 用量」（标题旁精确合计；行：缓存命中、未缓存输入、缓存读取、输出，精确数字千分位；再次点击 / 点外面 / Esc 关闭；面板用 `createPortal` 挂到 `document.body`，避开输入框的 `overflow` 裁剪）；② 只显示的「上下文 x.xK」（≥ 60% 提醒色）。替代上面「悬停显示明细」的做法（用户实测悬停不明显、点击无反应、排版不整齐）。
- 实现细节：胶囊与面板组件都定义在模块级、数据从 `ComposerSlotsContext` 读，流式输出时不会被重新挂载，面板不会自己关掉；会话用量明细由 `usageDetailRows`（`src/ui/cuko/composer-stats.ts`）返回，原来的 `tokenTotalsTip` 删除。
- 附件：本次不做（见第 10 节）。

## 7. 跨协议切换模型

- OpenAI → OpenAI、Cuko → OpenAI：直接改绑定，不发 compress。缺原文的旧消息在切换时按第 2 节规则补齐（补好即固定）：旧回复去掉「（已停止）」「⚠️ …」，只剩提示的不补；旧附件只写一行文件名。
- 切到 Cuko：维持原 compress 流程。

## 8. 顺带修复（问题清单）

1. 收到 error 后仍执行工具：退出条件加 `round.error`。
2. 最后一帧丢失：SSE 解码器加 `flush()`，读完流调用；同时修复 CRLF 跨 chunk 无法识别。
3. 中途断开仍标记完成：OpenAI 协议进入重试；Cuko 协议标记「连接中断，回复不完整」。
4. 用户消息由渲染层保存且不等待：`startRun` 携带用户消息，由主进程落库（`saveMessage` IPC 保留）。
5. 改标题失败导致不发送：改为不等待，失败只记日志。

## 9. 数据库

- 沿用启动兜底的幂等 `ALTER TABLE` 加列，不升 `CURRENT_DB_VERSION`。

## 10. 不在本次范围

附件相关（发送附件、OpenAI 会话附件按钮置灰 / 发送前拦截）、历史压缩、Cuko 协议重试、问题清单中其余 P1 / P2。

## 11. 实施步骤

1. 纯函数 `src/app/cuko-openai.ts` + 解码器 `flush` + 测试 `test/cuko-openai.test.js`。
2. 运行器：协议分流、原文重放、停止 / 出错、重试、主进程保存用户消息、修复 1～5。
3. 数据库加列、IPC、设置页（协议下拉、三项 Provider 参数、模型卡片、档位表、主进程获取模型）。
4. 聊天窗口：模型选择器两级菜单（模型 / 推理等级）、会话累计用量（xxx tok）、缓存命中率（会话累计）、上下文用量与 60% 提醒。

## 验收标准

- [x] 步骤 1：纯函数单测通过（原文重放前缀不变、流解析、usage、请求体优先级、重试判定、模型列表、档位）
- [x] 步骤 2：OpenAI 协议多轮对话 + 工具循环可用；DeepSeek 第二轮起缓存命中 > 0（实测第二轮 98%）
- [x] 步骤 3：设置页可选协议、刷新不丢用户修改
- [x] 步骤 4：两级菜单选推理等级（Cuko 置灰）、会话累计用量 xxx tok（点击胶囊看明细）、缓存命中（会话累计，两位小数）、上下文用量与 60% 提醒
- [x] 刷新模型自动读取接口推理档位（`effort` 扩展字段），用户修改优先；接口没给 `off` 时自动补一个，思考可关闭
- [x] 获取模型时推断 API 协议（OpenAI / Cuko），与所选不一致时在保存时弹窗确认（只提示不自动改）
- [x] Cuko 协议行为不变
- [x] typecheck / test / lint / compile 全绿（2026-11-24：typecheck 0 错误；`vitest run cuko` 6 文件 120 用例全过；`eslint .` 0 错误 34 个旧警告；compile 成功）

## 12. 请求日志（2026-11-23 追加）

- 列表摘要：协议、第几次尝试（`attempt` / `maxAttempts`，显示「第 2/4 次」）、用量（归一后含 `cache_read_tokens` / `cache_miss_tokens`）与命中率、总条数 / 字数、OpenAI 协议本轮新增条数 / 字数、HTTP 状态、耗时。
- 点开看原始报文（像开发者工具的网络面板）：
  - 请求头：方法 + URL + 全部请求头，`Authorization` 打码为 `Bearer ****` + 后 4 位；
  - 请求体：实际发出的 JSON 原文，可切「原文 / 格式化」，可复制；
  - 响应：服务端返回的原始文本（SSE 原样），可复制，单条最多保留 200 万字符。
- 主进程只保留最近 20 条请求的原文（`REQUEST_LOG_RAW_KEEP`），更早的显示「原文已释放」；列表接口只返回摘要，点开时经 IPC `cuko:get-request-log-raw`（preload `getRequestLogRaw`）读取。
- 日志不再保存完整的 input / messages 数组。

## 进度记录（截至 2026-11-24）

已提交：

- bdf85bd fix(cuko): 补上通用确认弹窗 DOM，修复 Cuko 窗口里确认框不弹
- d9ada1c fix(settings): 恢复协议不一致的黄色提示，保存时没探过就主动探一次
- d7a3654 feat(settings): 协议不一致改成保存时弹窗确认
- c1589f1 feat(settings): 获取模型时推断 API 协议，不一致就提示
- f34258b feat(settings): 推理档位的「API 参数值」写清留空含义
- 70cb496 feat(cuko): 模型接口没给 off 档位时自动补一个，思考可以关掉
- d270edf fix(app): 控制台管道断开（EPIPE）不再弹未捕获异常窗
- 899bcbf feat(cuko): 输入框用量改胶囊 + 浮动面板，刷新模型自动读取接口推理档位
- 973ee8b test(cuko): 请求日志断言（协议 / 尝试次数 / 用量归一 / 原始报文 / 密钥打码 / 原文释放）
- ab5c953 feat(cuko): 聊天窗口两级菜单选推理等级、会话用量 / 缓存命中 / 上下文显示（步骤 4）
- 99f3f2d chore(lint): eslint 忽略 git 已忽略的本地目录（tmp / .cuckoo/plugins / resources/runtime）
- 9fb8ad0 docs(cuko): 交接文档补充步骤 2-4、远程地址与 SSH 推送说明
- 901000f feat(cuko): 请求日志显示原始报文、用量与缓存命中
- 98dcb1d feat(cuko): 设置页支持 OpenAI 协议、请求参数、可编辑模型目录与推理档位（261123-q4h7tn 步骤 3-2）
- 4c36f3d feat(cuko): Provider 协议与参数读写、模型目录合并写入、按表单获取模型（261123-q4h7tn 步骤 3-1）
- 278375e test(cuko): 运行器 OpenAI 协议集成测试（假服务 + 内存库：前缀不变 / 工具循环 / 重试 / 401 / 停止）（261123-q4h7tn 步骤 2-5）
- 1189cd6 fix(cuko): 用户消息改由主进程落库 / 改标题不阻塞发送 / 显示自动重试（261123-q4h7tn 步骤 2-4）
- f5c1c40 feat(cuko): 切到 OpenAI 协议模型时直接改绑定并补齐原文（261123-q4h7tn 步骤 2-3b）
- 3c0ac66 feat(cuko): 运行器接入 OpenAI 协议（原文重放 / 停止出错处理 / 自动重试）（261123-q4h7tn 步骤 2-3）
- 1cb6b18 fix(cuko): 补列 + 运行器 flush / 出错不执行工具 / 断开标记不完整（261123-q4h7tn 步骤 2-1、2-2）
- 38db2bc feat(cuko): OpenAI 兼容协议纯函数 + SSE 解码器 flush（261123-q4h7tn 步骤 1）
- a2ebf65 merge: 合入 grep/glob 流式读取修复（RangeError: Invalid string length）
- 0a96d37 fix(tools): grep/glob 改流式读取，修复主进程 RangeError: Invalid string length
- 2294d82 docs(req): 新增 261123-q4h7tn Cuko 接入 OpenAI 兼容接口需求档案

待确认 / 未完成（截至 2026-11-24 13:10）：功能已全部完成——胶囊 + 浮动面板（899bcbf）、DeepSeek `/models` 扩展字段实测（`effort` 已接入）、接口没给 `off` 时自动补一个（70cb496）、EPIPE 弹窗修复（d270edf）、界面真机验证（用户确认功能正常）、验收打勾与 status=review。剩余：等用户重启验证 EPIPE 修复 → push → 决定是否合并回 master 与版本号。已完成：步骤 4（ab5c953）、请求日志测试（973ee8b）、DeepSeek 真实缓存命中（第二轮 98%）。

交接文档：`docs/handover/261123-q4h7tn-cuko-openai-handover.md`


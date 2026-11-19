---
id: 261109-8ms69z-cuko-api
type: feature
title: Cuko API 客户端与独立工作窗口
status: done
branch: feat/261109-8ms69z-cuko-api
created: 2026-11-09
updated: 2026-11-17
---

# Cuko API 客户端与独立工作窗口

## 背景

Cuckoo 当前作为 Agent 工具，强依赖内嵌网页解析来获取 AI 回复。为了将 Cuckoo 转变为完全纯粹的 Agent 工具，我们需要支持通过 **Cuko API** 调用外部的 Stateful Provider（如浏览器扩展、本地服务或远端 API）。

Cuko API 是一套纯粹的增量交互协议：客户端只发送当前用户的提示词（支持多模态文件），由 Stateful Provider 维护上下文并流式返回结果。

## 目标

1. 在 Cuckoo 侧实现 Cuko API 的客户端调用逻辑（HTTP + SSE）。
2. 提供一个完全独立的 Cuko 工作窗口（UI），不影响现有的主界面和侧边栏。
3. 使用 `assistant-ui` 作为聊天界面组件。
4. 提供一个 DSH 风格的 Provider 管理面板，支持多 Provider 与模型目录。
5. 确保该功能的代码和构建产物与主应用隔离，为未来剥离成独立组件做准备。

## 方案

### 整体架构

- **UI 层**：新建独立的 `src/ui/cuko/` 目录，使用 React 19 + `assistant-ui` 官方源码组件（通过 shadcn 拉取）。
- **业务层**：SSE 客户端、工具执行循环、Cuko API 请求逻辑内联在 `src/ui/cuko/app.tsx`，不依赖网页解析、不依赖现有 Provider 系统。
- **协议层**：严格遵循 `docs/protocols/cuko-api-v1.md`。
- **构建层**：独立的 `scripts/build-cuko.mjs`，依次编译 Tailwind CSS + esbuild 打包 JS，内联成一个 `built.html`。
- **主进程**：独立的 BrowserWindow 加载 `built.html`，独立 session partition，禁止任意导航。

### 数据库设计（对齐 DSH 工业级结构）

六张表：

- `cuko_config`：杂项配置（当前激活的 providerId / modelId / active_workspace）。
- `cuko_providers`：Provider 列表（id / name / base_url / api_key / protocol / created_at / updated_at）。
- `cuko_models`：模型目录（provider_id + model_id 复合主键 / name / created_at / updated_at）。
- `cuko_sessions`：会话，记录 `provider_id`、`model_id`、`project_dir`，实现会话级模型锁定和项目绑定；
  首轮注入的系统提示词留档在 `system_prompt`（便于事后核对）。
- `cuko_messages`：消息（含 think、usage_json 和 JSON 格式的 tool-call）。
- `cuko_workspaces`：工作区目录（path / name）。

数据库通过标准的 `PRAGMA user_version` 做版本迁移，并在启动末尾执行幂等的 `CREATE TABLE IF NOT EXISTS` 和 `ALTER TABLE` 兜底。

### 系统提示词分段注入

- 首次新建对话时（无 providerSessionId），主进程调用主项目的 `buildPrompt` 获取完整提示词。
- 通过正则 `/^# /` 按一级标题切分成字符串数组。
- 将分段注入 `input` 数组的前面，最后跟上用户消息。
- 续接对话时不重复发送。

### 工具执行循环

- SSE 流式接收结束后（且收到 `done` 事件），提取回复中的 cuckoo 代码块。
- 逐个调用主进程的 `cuko:execute-js` 执行代码。
- 执行完成后，将结果拼装成下一轮的 `input` 数组：`[0]` 为随机回复语（从回复语池抽取），`[1..n]` 为每个代码块的执行结果。
- 不设轮数上限：只要 AI 继续输出 `cuckoo` 代码块就一直执行（原 10 轮上限已移除）。

### 切换模型（历史压缩发送）

- 对话开始后**不再锁死模型选择器**；只在当前会话有任务运行中时禁用。
- 有历史消息时切换模型会先弹确认框，提示「历史对话会发给新模型，产生大量未命中缓存的 token」。
- 确认后主进程发一次 `type: "compress"` 的 `/v1/responses` 请求：
  - `input` 为数组，**每条历史消息一个元素**（`type: "text"`，带「用户:」「助手:」前缀）
  - AI 的思考内容（`think`）不发送
  - 工具调用：代码里没有 `edit` / `deleteFile` 的不发送真实执行结果，统一写成
    `(该工具调用不涉及edit或delete,如需调用结果请重新调用)`；涉及写操作的结果保留
  - 先补发留档的系统提示词分段（否则新模型不知道工具怎么用）
  - 请求体带 `type: "compress"`，不带旧的 `providerSessionId`
- 请求成功后才更新 `provider_id` / `model_id` / `provider_session_id`；
  失败保持旧绑定并弹窗内联报错，可重试。
- 历史压缩规则在 `src/ui/cuko/compress-history.ts`，由 `test/cuko-compress-history.test.js` 覆盖。

### 首轮系统提示词留档

- 首次对话（无 `provider_session_id` 且绑定了工作区）时，主进程 `buildPrompt` 组装完整提示词，
  按 `# ` 分段注入 `input`；同时把**完整提示词**写入 `cuko_sessions.system_prompt`。
- 会话菜单「系统提示词」可查看 / 复制留档；没有注入过的会话会说明原因。
- 续接对话（已有 providerSessionId）不会重复注入，也不会覆盖已留档的内容；
  手动清空会话 ID 后下一轮会重新注入并覆盖留档。

### 时间戳格式

- Cuko 表统一写「本地时间 + 偏移」的 ISO：`2026-11-19T12:05:45.216+08:00`
  （`src/infra/time.ts` 的 `nowLocalIso()`，见 `src/app/ipc/cuko.ts` / `cuko-runner.ts`）。
- 原因：`new Date().toISOString()` 是 UTC（会写成 `04:05:45Z`），直接打开 SQLite
  会以为时间错了；带偏移既显示本地墙钟，又无歧义、可被 `new Date()` 解析。
- 历史数据不迁移（用户确认）：老行仍是 UTC，但新旧混排不会影响「新增行晚于老行」的排序。
- 依赖 SQLite `CURRENT_TIMESTAMP` 默认值的写入点（工作区）已改成显式传 `nowLocalIso()`。

### 后台运行（关窗继续 + 多会话并行）

- 运行循环从渲染进程搬到主进程 `src/app/cuko-runner.ts`：每个会话一个运行实例，
  同时可以跑多个会话，关掉 Cuko 窗口也不会中断（消息直接由主进程落库）。
- IPC：`cuko:start-run`（立即返回，循环在后台跑）、`cuko:cancel-run`、
  `cuko:get-runs`（窗口重开时取快照恢复现场）、`cuko:subscribe-runs`（订阅事件）。
- 事件 `cuko:run-event`：`run-start` / `delta` / `round-complete` /
  `tool-start` / `tool-update` / `tool-complete` / `provider-session` /
  `run-complete`。渲染层只负责把事件投影成消息，不再自己发请求。
- 同一会话同时只允许一个运行，重复启动返回「该会话正在运行」；
  删除会话会先 `cancel`，避免删完还在往库里写。
- 窗口重开 / 切回正在跑的会话：`getRuns` 返回未落库的进行中消息
  （流式 assistant 内容、工具卡片 parts），渲染层补进消息列表后继续吃增量。
- 侧边栏对正在后台运行的会话显示转圈（`ThreadListItem` 的 `running` 插槽）。
- SSE 解析 / 代码块提取 / 提示词分段抽到 `src/app/cuko-run-protocol.ts`，
  由 `test/cuko-run-protocol.test.js` 覆盖。

### 跟随主程序主题

- 主程序设置里的 深色 / 浅色 / 跟随系统 由主进程 `theme-manager` 权威维护，变化时广播 `theme-changed`。
- Cuko 窗口不在 `windowState` 的窗口上下文里，收不到兜底广播，所以：
  - preload 暴露 `themeSubscribe`（新增，走 `theme-subscribe` IPC 订阅到当前 webContents）；
  - `app.tsx` 的 `useCukoTheme` 先 `themeGet` 取当前快照，再监听 `onThemeChanged` 实时切换。
- 投影到 DOM：`html.dark`（Tailwind 变量）、`html[style.color-scheme]`（原生控件）、
  `body[data-ck-dark]`（设置弹窗用的 `--ck-*` 变量）。
- `index.html` 里保留一段首帧内联脚本，按 `prefers-color-scheme` 预先决定明暗，避免深色闪白色。
- 原来的硬编码 `dark`（`body class="dark"` 与根 div 的 `dark`）已移除。

### 修改会话 ID（providerSessionId）

- 入口：Cuko 侧边栏会话菜单「会话 ID」（`ThreadListItem` 的可选 `onEditSessionId` 插槽，主界面不传即不显示）。
- 行为（方案 A）：只更新 `cuko_sessions.provider_session_id`，下一次请求生效；历史消息、当前上下文都不变。
- 留空 = 下次请求重新开始：因为 `onNew` 用空的 providerSessionId 判定首轮，会重新注入系统提示词。
- 同一个值也用于续接对话（`body.providerSessionId`），所以手动填入别的会话 ID 即可续接那段服务端状态。

### 附件持久化（方案 C：原文件落盘 + 消息记路径）

- 发送时主进程把附件原文件写到 `<userData>/cuko-attachments/<sessionId>/<messageId>/<index>.<ext>`，
  消息里只保存相对路径（换模型 / 换供应商后历史附件仍可读）。
- 附件不塞进 `message.content`：assistant-ui 的用户消息附件只认 `message.attachments`，
  且 `content` 里的 `file` part 会被 `UserFilePart` 当成 data URL 渲染成坏图。
- 落库的 `cuko_messages.content` 形如 `{ v:1, text, attachments:[{filename,mimeType,path}] }`；
  无附件的消息仍存纯文本，历史消息不回填。
- 前端 `useAttachmentSrc` 通过 `cukoAPI.readAttachment` 异步读盘 → base64 → data URL，
  内存里做 40 条 LRU 缓存；图片按 `mimeType` 判定（file part 会被映射成 `type:"document"`）。
- 渲染：图片 = 96px 缩略图（点开看原图），其他文件 = 文件名卡片（Cuko 通过 `Thread` 的
  `UserAttachment` 插槽注入，不影响主界面）。
- 落库格式的序列化 / 解析抽到 `src/ui/cuko/persisted-content.ts`（纯函数，无 React 依赖），
  由 `test/cuko-attachment-content.test.js` 覆盖，含「普通文本长得像 JSON」的回归用例。

### UI 交互定制

- 左侧使用官方 `ThreadList`，支持新建 / 切换 / 重命名 / 删除。
- 顶部模型选择器按 Provider 分组，展示所有可用模型。
- **会话锁定**：一旦当前会话已有消息，模型选择器自动置灰。
- 设置面板通过 `settings-cuko.tsx` 独立组件实现，沿用主项目 `--ck-*` 设计 token。
- **UI 魔改**：为了让界面贴近用户预期，直接修改了 `assistant-ui` 的源码（详见验收标准中的细节）。

### 关键约定

- Cuko 窗口与主应用完全隔离：独立入口 `src/ui/cuko/app.tsx`，独立 tsconfig（`tsconfig.cuko.json`，bundler 解析），独立 Tailwind 配置。
- 不出现"桥接"字样：Provider 定位为中性的 Stateful Provider。
- 不含阻塞式弹窗：所有提示改为 2 秒自动消失的内联 tip，避免 Electron 无边框窗口下 UI 失焦。

## 验收标准

- [x] 主界面侧边栏和原有功能 100% 保持不变。
- [x] 能够打开独立的 Cuko 窗口，UI 风格与 Cuckoo 整体一致。
- [x] 能够配置 Provider 地址、Token，并成功拉取模型列表。
- [x] 能够通过 `assistant-ui` 发送消息，并正确解析 SSE 流式事件（包含新建和续接对话）。
- [x] 支持多 Provider、多模型切换，并在会话内锁定模型。
- [x] 支持思维链（think）折叠展示；token 用量写入库并在输入框下方显示「上下文 x.xx k」。
- [x] 多会话持久化，切换会话时恢复历史消息和绑定模型。
- [x] **工作区绑定**：支持选择工作区目录，新建会话时绑定 `project_dir`。
- [x] **系统提示词注入**：首次对话自动按 `# ` 分段注入系统提示词。
- [x] **工具执行循环**：自动提取 `cuckoo` 代码块并执行，将结果回传（不设轮数上限）。
- [x] **UI 深度定制**：
  - [x] 去除冗余的 `1 tool call` 外层分组。
  - [x] 去除纯工具消息底部的复制/重试操作栏。
  - [x] 思考块流式展开、结束后折叠。
  - [x] cuckoo 代码块默认折叠，带复制按钮。
  - [x] 工具卡片折叠时多行展示 `await xxx` 参数解析，展开后代码/结果限高滚动。
  - [x] 多个工具调用合并到同一消息，消除巨大间距。
- [x] 支持传入多模态文件（Base64 随 `input` 发送，原文件落盘用于历史回看）。
- [x] **修改会话 ID**：会话右键菜单可编辑 `provider_session_id`，只改库值、下次请求生效；留空则下次请求重新注入系统提示词。
- [x] **跟随主程序主题**：Cuko 窗口跟随主程序设置的 深色 / 浅色 / 跟随系统，主程序改主题时实时同步。
- [x] **后台运行**：关掉 Cuko 窗口任务继续跑；多个会话可同时运行；窗口重开后恢复进行中的消息。
- [x] **首轮系统提示词留档**：注入时写入 `cuko_sessions.system_prompt`，会话菜单可查看 / 复制。
- [x] **切换模型**：有历史时确认后压缩历史（去 think、非写操作工具结果替换）以 `type:"compress"` 发给新模型，成功后才切换。
- [x] `typecheck / test / lint / compile` 全绿。

## 遗留 / 后续

1. **附件目录清理**：删除会话时暂不清理 `<userData>/cuko-attachments/<sessionId>/`，长期使用会积累孤儿文件（用户已确认暂不做）。
2. **大图缩略图**：当前用原图 + CSS 缩放，后续可在 `cuko:save-attachments` 里用 `nativeImage.resize` 生成缩略图，降低读盘体积。
3. **会话标题智能生成**：当前使用前 15 个字符作为标题，未来可接入 AI 自动起标题。
4. **同名会话去重**：侧边栏常出现多个「你好」，仅在切换时才改标题，未做去重。
5. **多 Provider 同时激活**：目前同时只有一个 Provider 处于激活状态，未来若需并行调用多个 Provider，需要扩展 `cuko_config` 的激活状态模型。

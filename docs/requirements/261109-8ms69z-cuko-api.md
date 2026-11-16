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
- `cuko_sessions`：会话，记录 `provider_id`、`model_id`、`project_dir`，实现会话级模型锁定和项目绑定。
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
- 最多执行 10 轮，防止死循环。

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
- [x] 支持思维链（think）折叠展示和 token 用量（usage）记录。
- [x] 多会话持久化，切换会话时恢复历史消息和绑定模型。
- [x] **工作区绑定**：支持选择工作区目录，新建会话时绑定 `project_dir`。
- [x] **系统提示词注入**：首次对话自动按 `# ` 分段注入系统提示词。
- [x] **工具执行循环**：自动提取 `cuckoo` 代码块并执行，将结果回传，最多 10 轮。
- [x] **UI 深度定制**：
  - [x] 去除冗余的 `1 tool call` 外层分组。
  - [x] 去除纯工具消息底部的复制/重试操作栏。
  - [x] 思考块流式展开、结束后折叠。
  - [x] cuckoo 代码块默认折叠，带复制按钮。
  - [x] 工具卡片折叠时多行展示 `await xxx` 参数解析，展开后代码/结果限高滚动。
  - [x] 多个工具调用合并到同一消息，消除巨大间距。
- [ ] 支持传入多模态文件（Base64）。
- [x] `typecheck / test / lint / compile` 全绿。

## 遗留 / 后续

1. **多模态附件上传**：协议已定义 `{ type: "file", filename, mimeType, data }`，前端附件按钮（`ComposerAddAttachment`）已由官方 `Thread` 提供，缺的是 `AttachmentAdapter` 把文件转 Base64 并拼入 `input` 数组。
2. **usage 展示**：数据已存入数据库，但官方气泡没有位置展示，需定制 `AssistantMessage` 组件或使用 `assistant-ui` 的自定义插槽。
3. **会话标题智能生成**：当前使用前 15 个字符作为标题，未来可接入 AI 自动起标题。
4. **多 Provider 同时激活**：目前同时只有一个 Provider 处于激活状态，未来若需并行调用多个 Provider，需要扩展 `cuko_config` 的激活状态模型。

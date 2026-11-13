# Cuko API v1 — Stateful Provider Protocol

> Status: Draft (冻结待开发)
> Version: 1.0-draft
> Date: 2026-11-09

本文定义 Cuckoo 与 Stateful Provider 之间的统一业务协议。协议不绑定任何具体传输方式（本地中转、远端服务器均可接入）。

## 1. 协议定位与设计哲学

Cuko API 是专为 **Stateful Provider** 设计的业务协议，区别于传统的无状态 LLM API（如 OpenAI Chat Completions）。

**核心特征：**
1. **增量输入**：客户端（Cuckoo）每次**只发送当前的用户提示词**，不发送历史上下文、不发送 System Prompt、不发送 Tools。
2. **状态黑盒**：Provider 负责维护外部服务的上下文状态。
3. **通用抽象**：Provider 可以是任何形式的实现（本地服务、远端服务器等）。

## 2. 认证

所有 HTTP 请求可携带标准认证头：

```http
Authorization: Bearer <token>
```

（此 Header 为选填）

## 3. 接口说明

### 3.1 获取模型列表

`GET /v1/models`

**响应格式：**
```json
{
  "data": [
    { "id": "deepseek", "name": "DeepSeek" },
    { "id": "kimi", "name": "Kimi", "supported_inputs": ["text", "file"] }
  ]
}
```

**说明：**
- `id` (必需): 模型唯一标识，用于发送消息时使用。
- `name` (必需): 用户可见名称，用于 UI 下拉框展示。
- 允许 Provider 在对象中附加任意可选字段（如 `supported_inputs`、`context_window` 等），Cuckoo 首版将忽略未知可选字段。

### 3.2 发送消息 (流式)

`POST /v1/responses`

请求体：
```json
{
  "cuckSessionId": "cuck_uuid_123",
  "providerSessionId": "prov_uuid_abc", 
  "model": "deepseek",
  "requestId": "req_uuid_456",
  "input": [
    { "type": "text", "text": "帮我看看这份文档" },
    { "type": "file", "filename": "a.pdf", "mimeType": "application/pdf", "data": "base64..." }
  ]
}
```

**参数说明：**
- `cuckSessionId` (必需): Cuckoo 侧生成的会话唯一标识。
- `providerSessionId` (可选): Provider 侧的会话标识。**首次请求不携带（表示新建对话）；后续请求携带上一次返回的 ID（表示续接对话）。**
- `model` (必需): 指定的模型 ID。
- `requestId` (必需): Cuckoo 侧生成的请求唯一标识，用于幂等控制。
- `input` (必需): 输入内容数组，支持多模态。
  - 文本对象: `{ "type": "text", "text": "..." }`
  - 文件对象: `{ "type": "file", "filename": "...", "mimeType": "...", "data": "base64..." }`

## 4. 流式响应 (SSE)

响应必须使用 `Content-Type: text/event-stream`。

### 4.1 事件类型

**1. 增量消息 (`event: message`)**
```text
event: message
data: {"cuckSessionId": "cuck_uuid_123", "providerSessionId": "prov_uuid_abc", "output": ["你"]}
```
- **重要**：如果本次请求是新建对话（请求未带 `providerSessionId`），**必须**在推送的第一帧中包含 `providerSessionId`，以便 Cuckoo 保存用于下次续接。
- 后续帧可以只包含增量 `output`。

**2. 结束事件 (`event: done`)**
```text
event: done
data: {
  "finishReason": "stop",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 5,
    "total_tokens": 15
  }
}
```
- 表示本次生成正常结束。
- 必须包含 `usage` 统计（若 Provider 无法获取真实 token 数，请提供估算值）。

**3. 错误事件 (`event: error`)**
```text
event: error
data: {"code": "provider_unavailable", "message": "连接已断开"}
```
- 流式传输中途发生错误时推送。
- 推送后应主动断开连接。

## 5. 错误处理

HTTP 请求层面及 `event: error` 中的错误对象结构：

```json
{
  "code": "invalid_request",
  "message": "人类可读的错误描述"
}
```

**标准错误码字典：**
- `authentication_required`: 需要认证。
- `provider_unavailable`: Provider 当前不可用。
- `rate_limit_exceeded`: 触发限流。
- `invalid_request`: 请求参数不合法。
- `request_timeout`: 请求超时。
- `idempotency_conflict`: 重复的 requestId。
- `internal_error`: Provider 内部兜底错误。

*注：Cuckoo 将优先根据 `code` 映射 UI 提示，若匹配不到，则直接展示 `message`。*

## 6. 幂等与连接管理

1. **幂等**：Provider 需记录处理过的 `requestId`。若收到重复的 `requestId`，必须直接拒绝，返回 `idempotency_conflict`（HTTP 409 或在 SSE 中推 `event: error`）。
2. **连接断开**：若 Cuckoo 在流式生成过程中主动断开连接（如用户点击“停止生成”），Provider 需感知连接断开，并尽可能停止底层的生成。

## 7. Cuckoo 侧 UI 交互映射 (参考)

- **首次对话**：用户发送 prompt -> Cuckoo 生成 `requestId`、`cuckSessionId` -> 携带 `input` 请求 `POST /v1/responses`。
- **流式展示**：解析 `event: message` -> 提取 `output[0]` -> 渲染到 `assistant-ui` 气泡中。
- **续接对话**：用户再次发送 -> Cuckoo 取出上次存下的 `providerSessionId` -> 发起请求。
- **异常处理**：解析 `event: error` -> 检查 `code` -> UI 弹窗提示。

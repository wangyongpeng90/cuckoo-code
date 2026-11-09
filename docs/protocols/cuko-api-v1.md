.cuko-temp/cuko-api-v1.md 全读完了，一共 146 行，内容如下：

1: # Cuko API v1 — Stateful Provider Protocol
2: 
3: > Status: Draft (冻结待开发)
4: > Version: 1.0-draft
5: > Date: 2026-11-09
6: 
7: 本文定义 Cuckoo 与 Stateful Provider 之间的统一业务协议。协议不绑定任何具体传输方式（本地中转、远端服务器均可接入）。
8: 
9: ## 1. 协议定位与设计哲学
10: 
11: Cuko API 是专为 **Stateful Provider** 设计的业务协议，区别于传统的无状态 LLM API（如 OpenAI Chat Completions）。
12: 
13: **核心特征：**
14: 1. **增量输入**：客户端（Cuckoo）每次**只发送当前的用户提示词**，不发送历史上下文、不发送 System Prompt、不发送 Tools。
15: 2. **状态黑盒**：Provider 负责维护外部服务的上下文状态。
16: 3. **通用抽象**：Provider 可以是任何形式的实现（本地服务、远端服务器等）。
17: 
18: ## 2. 认证
19: 
20: 所有 HTTP 请求可携带标准认证头：
21: 
22: ```http
23: Authorization: Bearer <token>
24: ```
25: 
26: （此 Header 为选填）
27: 
28: ## 3. 接口说明
29: 
30: ### 3.1 获取模型列表
31: 
32: `GET /v1/models`
33: 
34: **响应格式：**
35: ```json
36: {
37:   "data": [
38:     { "id": "deepseek", "name": "DeepSeek" },
39:     { "id": "kimi", "name": "Kimi", "supported_inputs": ["text", "file"] }
40:   ]
41: }
42: ```
43: 
44: **说明：**
45: - `id` (必需): 模型唯一标识，用于发送消息时使用。
46: - `name` (必需): 用户可见名称，用于 UI 下拉框展示。
47: - 允许 Provider 在对象中附加任意可选字段（如 `supported_inputs`、`context_window` 等），Cuckoo 首版将忽略未知可选字段。
48: 
49: ### 3.2 发送消息 (流式)
50: 
51: `POST /v1/responses`
52: 
53: 请求体：
54: ```json
55: {
56:   "cuckSessionId": "cuck_uuid_123",
57:   "providerSessionId": "prov_uuid_abc", 
58:   "model": "deepseek",
59:   "requestId": "req_uuid_456",
60:   "input": [
61:     { "type": "text", "text": "帮我看看这份文档" },
62:     { "type": "file", "filename": "a.pdf", "mimeType": "application/pdf", "data": "base64..." }
63:   ]
64: }
65: ```
66: 
67: **参数说明：**
68: - `cuckSessionId` (必需): Cuckoo 侧生成的会话唯一标识。
69: - `providerSessionId` (可选): Provider 侧的会话标识。**首次请求不携带（表示新建对话）；后续请求携带上一次返回的 ID（表示续接对话）。**
70: - `model` (必需): 指定的模型 ID。
71: - `requestId` (必需): Cuckoo 侧生成的请求唯一标识，用于幂等控制。
72: - `input` (必需): 输入内容数组，支持多模态。
73:   - 文本对象: `{ "type": "text", "text": "..." }`
74:   - 文件对象: `{ "type": "file", "filename": "...", "mimeType": "...", "data": "base64..." }`
75: 
76: ## 4. 流式响应 (SSE)
77: 
78: 响应必须使用 `Content-Type: text/event-stream`。
79: 
80: ### 4.1 事件类型
81: 
82: **1. 增量消息 (`event: message`)**
83: ```text
84: event: message
85: data: {"cuckSessionId": "cuck_uuid_123", "providerSessionId": "prov_uuid_abc", "output": ["你"]}
86: ```
87: - **重要**：如果本次请求是新建对话（请求未带 `providerSessionId`），**必须**在推送的第一帧中包含 `providerSessionId`，以便 Cuckoo 保存用于下次续接。
88: - 后续帧可以只包含增量 `output`。
89: 
90: **2. 结束事件 (`event: done`)**
91: ```text
92: event: done
93: data: {
94:   "finishReason": "stop",
95:   "usage": {
96:     "input_tokens": 10,
97:     "output_tokens": 5,
98:     "total_tokens": 15
99:   }
100: }
101: ```
102: - 表示本次生成正常结束。
103: - 必须包含 `usage` 统计（若 Provider 无法获取真实 token 数，请提供估算值）。
104: 
105: **3. 错误事件 (`event: error`)**
106: ```text
107: event: error
108: data: {"code": "provider_unavailable", "message": "连接已断开"}
109: ```
110: - 流式传输中途发生错误时推送。
111: - 推送后应主动断开连接。
112: 
113: ## 5. 错误处理
114: 
115: HTTP 请求层面及 `event: error` 中的错误对象结构：
116: 
117: ```json
118: {
119:   "code": "invalid_request",
120:   "message": "人类可读的错误描述"
121: }
122: ```
123: 
124: **标准错误码字典：**
125: - `authentication_required`: 需要认证。
126: - `provider_unavailable`: Provider 当前不可用。
127: - `rate_limit_exceeded`: 触发限流。
128: - `invalid_request`: 请求参数不合法。
129: - `request_timeout`: 请求超时。
130: - `idempotency_conflict`: 重复的 requestId。
131: - `internal_error`: Provider 内部兜底错误。
132: 
133: *注：Cuckoo 将优先根据 `code` 映射 UI 提示，若匹配不到，则直接展示 `message`。*
134: 
135: ## 6. 幂等与连接管理
136: 
137: 1. **幂等**：Provider 需记录处理过的 `requestId`。若收到重复的 `requestId`，必须直接拒绝，返回 `idempotency_conflict`（HTTP 409 或在 SSE 中推 `event: error`）。
138: 2. **连接断开**：若 Cuckoo 在流式生成过程中主动断开连接（如用户点击“停止生成”），Provider 需感知连接断开，并尽可能停止底层的生成。
139: 
140: ## 7. Cuckoo 侧 UI 交互映射 (参考)
141: 
142: - **首次对话**：用户发送 prompt -> Cuckoo 生成 `requestId`、`cuckSessionId` -> 携带 `input` 请求 `POST /v1/responses`。
143: - **流式展示**：解析 `event: message` -> 提取 `output[0]` -> 渲染到 `assistant-ui` 气泡中。
144: - **续接对话**：用户再次发送 -> Cuckoo 取出上次存下的 `providerSessionId` -> 发起请求。
145: - **异常处理**：解析 `event: error` -> 检查 `code` -> UI 弹窗提示。
146: 

(已经到底了，共 146 行)
---
id: 261108-sse2
type: fix
title: 适配 DeepSeek 新版 SSE 流（命名事件 + 正文提取为 0）
status: doing
branch: fix/261108-sse-stream-v2
created: 2026-11-08
updated: 2026-11-08
---

# DeepSeek 新版 SSE 适配

## 现象

DeepSeek 侧协议更新后，Cuckoo 的 SSE 拦截**收到了流但提取不到正文**：

```
cuckoo-ai-stream: { text: 0, think: 11309 ... 12579, finished: false }   ← 只有思考，正文恒为 0
cuckoo-ai-error : { dbg: { path: 'xhr-finished-frame', thinkLen: 12579, textLen: 0,
                           statusFrames: ['quasi_status=FINISHED', 'response/status=FINISHED'] } }
```

- 传输层正常（XHR 通道能读到流，思考内容都能累计）
- 终态帧 `response/status=FINISHED` 也收到了
- **正文（RESPONSE 片段）一个字都没进 `text`** → 触发 `finished && textLen===0` → 判为 error

## 根因（已用实抓帧确认）

从站点最新 bundle（`main.9120333998.js`）看，流已改为**命名化 SSE 事件**：

```js
onServerEvent(e) {
  switch (e.event) {
    case "delta":  deltaParser.parse(e.data)      // 仍是 {p,o,v} 补丁
    case "ready":  { response_message_id, request_message_id, model_type }
    case "close":  { close_behavior }             // 新的终态事件
    case "finish": ...
  }
}
```

即帧形如 `event: delta\ndata: {...}`。现有 hook（`src/providers/hooks/deepseek.ts`）：

- **完全忽略 `event:` 行**（只取 `data:`）；
- 正文依赖 `p` 以 `/fragments` 结尾的 APPEND，或 `response/fragments/{i}/content` 补丁；
- 结束依赖 `{"p":"response/status","v":"FINISHED"}`。

正文为 0 说明「新流里的正文补丁路径变体」没被上述规则命中，而思考走了 `reasoning_content` 分支（`isThinkingPatch`）所以一切正常。

### 实抓帧（XHR tee，2026-11-08）

```
event: ready
data: {"request_message_id":1,"response_message_id":2,"model_type":"default"}

data: {"v":{"response":{...,"fragments":[{"id":2,"type":"THINK","content":"我们需要",...}],...}}}   ← 初始快照（无名帧）

data: {"p":"response/fragments/-1/content","o":"APPEND","v":"回答"}   ← 追加到当前片段
data: {"v":"用户"}                                                    ← 无 p 增量，追加到"当前片段"
data: {"v":"。"}

data: {"p":"response/fragments","v":[{...THINK 全量...}]}             ← ★ 片段数组 SET（无 o）
data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":67},{"p":"quasi_status","v":"FINISHED"}]}
data: {"p":"response/status","o":"SET","v":"FINISHED"}
event: close
data: {"click_behavior":"none","auto_resume":false}
```

**真正的断点**：旧代码只认 `o==='APPEND' && p 以 /fragments 结尾` 的帧。
新流用 `{"p":"response/fragments","v":[...]}`（SET，无 `o`）下发**片段全量快照**，
这一帧被整体忽略 → `fragmentTypes` 永远停在初始的 `['THINK']` →
之后所有无 `p` 的 `{"v":"..."}` 增量都被 `typeAt(currentIndex)` 判成 THINK →
**正文全进 think，text 恒为 0** → `finished && textLen===0` → 判 error。

（与 `event:` 命名无关：命名事件不影响 `data:` 里的补丁解析。）

## 方案

1. `shared/sse.ts` 增加 `parseFrame(block)`：同时返回 `event` 与 `data`（保留 `parseBlock` 兼容）；
2. `deepseek.ts` 按事件名分派：
   - `delta` → 走原有补丁消费
   - `ready` → 直接取 message id（不依赖 patch）
   - `finish` / `close` → 终态（`close_behavior` / `close_reason` 映射 finished / incomplete）
   - 无 `event:` 的无名帧 → 回退到旧逻辑（向后兼容）
3. **诊断增强**：hook 内部保留最近 N 帧原始文本的环形缓冲；判 error 时把它塞进 `dbg.frames`（截断），以后同类问题不必再装探针。

## 修复

`src/providers/hooks/deepseek.ts`：

1. 新增 `consumeFragments(frags, append)`：
   - `APPEND` → 追加片段类型 + 累计内容（原逻辑）
   - `SET/无 o` → **全量快照**：以它为准重建 `fragmentTypes` 与 `think/text`（快照的 content 是累计值，重建幂等，不会重复累计）
2. `consume()` 改为同时识别两种形态（`p` 结尾为 `fragments` 且 `v` 是数组即进入），不再要求 `o==='APPEND'`
3. 顶层快照 `{"v":{"response":{"fragments":[...]}}}` 复用同一函数
4. 诊断增强：extractor 保存最近 12 个原始帧（截断），判错时随 `dbg.frames` 上报——下次协议再变不用再挂探针

## 验收

- [x] 真实流帧已抓到并据此确认断点（片段 SET 帧被丢弃）
- [x] 普通对话：`cuckoo-ai-response` 的 text 长度 > 0（实测 `len=232`，日志 `收到完整回复，长度=232`）
- [x] 思考内容仍归入 think（同一次 `think=110`，未混入 text）
- [x] typecheck / compile 全绿
- [ ] 用户停止（stop_stream）仍判 stopped（逻辑未改动，真机抽验）
- [ ] `npm test` 全量（提交前跑）

## 遗留

- 抓帧依赖作者发一条普通消息（页面已挂 XHR tee，重启即失效）

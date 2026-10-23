---
id: 029
type: fix
title: 安全审核伪回复导致工具循环误判完成——自动续接
status: done
branch: fix/029-ds-safety-resume
created: 2026-10-21
updated: 2026-10-21
---

## 背景

DeepSeek 在部分请求下会在回复流末尾注入一条**内容安全审核元信息**，形如：

```
<ds_safety>[用户未成年]否
[分类]其他
[判定]用户要求继续读取 VS Code Copilot 会话记录，属于正常技术任务，不涉及政治敏感内容。
[规则]无</ds_safety>Safe
```

这段内容并非 AI 的真实回答，但它会作为一条**完整文本回复**被 hook 拦截、派发
`cuckoo-ai-response`（status=finished），随后进入
`src/bridge/intercept/observer.ts` 的 `processInterceptedResponse`：

- 不是 JS 工具代码块
- 不是 JSON / XML 工具调用
- → 落到「第 4 步：普通文本回复 → 任务完成，退出工具循环」，调用 `emitTaskIdle()`

结果是**工具循环被误判为"任务已完成"而停止**，AI 实际并没有继续干活，任务无声中断。
用户观感即「明明没有敏感内容，会话却停了」。

## 目标

当拦截到的回复是「DeepSeek 安全审核伪回复」（匹配 `<ds_safety>…</ds_safety>`）时：

- **不判定任务完成**：不发通知、不 `emitTaskIdle()`
- **自动续接**：发送续接提示词让 AI 继续原任务
- **有次数上限**：连续自动续接达到上限后放弃并 toast 提示，避免死循环

## 方案

在 `src/bridge/intercept/observer.ts` 的 `processInterceptedResponse` 中，
函数最前面（去重之后、正文标记处理之前），以便任何正常回复都能重置计数：

1. 用正则匹配回复是否**仅由** `<ds_safety>…</ds_safety>`（含尾随 `Safe` 字样）构成
   —— 即去掉该结构后无实质正文。仅处理此一种结构（不泛化到其它平台）。
2. 命中则：
   - 累计 `safetyResumeCount`；超过上限（3 次）→ toast 提示并放弃（仍不 emitTaskIdle）
   - 未超限 → `sendMessageToChat` 发送续接提示词（tag 加入 `SYSTEM_MSG_TAGS`，
     不上报飞书、纯净模式只反馈状态）
   - 直接 `return`，**不进入第 4 步**（不判定完成）
3. 正常回复到达时（进入后续任一步），重置 `safetyResumeCount` 与去重状态。

## 验收标准

- [x] 收到纯 `<ds_safety>…</ds_safety>` 回复时不触发"任务完成"（不 emitTaskIdle、不通知）
- [x] 命中后自动发送续接提示词，AI 继续原任务
- [x] 连续命中超过上限（3 次）后停止续接并 toast 提示
- [x] 正常文本回复、工具调用流程不受影响
- [x] typecheck / test / lint / compile 全绿

## 遗留 / 后续

- 只处理 DeepSeek 的 `<ds_safety>` 结构；其它平台若出现类似系统注入伪回复，可后续按需扩展

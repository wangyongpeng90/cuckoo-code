---
id: 005
type: refactor
title: 压缩改用「清 IDB + 刷新」获取完整历史
status: done
branch: refactor/005-compact-idb-refresh
created: 2026-09-21
updated: 2026-09-25
---

## 背景

压缩流程要读取会话全量消息（取最近 20% 做分享）。现状**只读 IndexedDB**，但实测发现：

| 实验 | 结果 |
|---|---|
| 同会话内 AI 回复后 | **IDB 不更新**（version 不变） |
| 刷新页面后 | IDB 更新（补齐新消息） |
| 清 IDB → 刷新 | DeepSeek **自动重新拉取完整数据**写回（`cache_control: REPLACE`） |

因此现状只能靠 **SSE 拿 msgId 补入**（`summaryRespId` 那段 hack）+ `sleep(500)` 猜测写入时机，**不可靠**。

## 目标

改为「**清 IDB + 刷新**」让 DeepSeek 自己把完整数据（含摘要）写回 IDB，再读取：

- 数据**权威**（DeepSeek 自己写的，格式必然正确）
- 摘要**必然包含**（可删掉 SSE 补 msgId 的 hack）
- 删掉 `sleep(500)` 猜测

## 方案

### 段 1（当前页 `runCompaction`）

1. 发摘要指令，等 AI 回复完成（沿用 `waitForResponse`）
2. **清当前会话在 IDB 的记录**（`history-message` store，key=sessionId）
3. 存项目目录（`localStorage['cuckoo-compact-project-dir']`，跨页需要）
4. **URL 加参数** `?cuckoo-compact=1` → `location.reload()`

### 段 2（刷新后同页）

1. init 时检测 URL 参数 `cuckoo-compact`
2. **立即清掉 URL 参数**（`history.replaceState`）——避免重复触发（这也是不用 localStorage 的原因：URL 天然不持久）
3. **等 IDB 写好**：订阅 hook 派发的 `cuckoo-idb-history-written` 事件
4. 读 IDB 全量消息 → 取最近 20% 成对
5. 调 `/api/v0/share/create` 拿 share_id
6. 存 `cuckoo-compact-pending-init` 标记 → 跳分享链接

### 段 3（分享页）

沿用现有 `checkPendingInit`（不变）。

### hook 侧（`deepseek.ts`）

**包装 `IDBObjectStore.prototype.put`**：当 store 名为 `history-message` **且** URL 含 `cuckoo-compact` 时，
写入成功（`request.onsuccess`）→ 派发 `cuckoo-idb-history-written` 事件。

- 只有带标记时才发事件，日常无开销
- 主世界包装，不改 DeepSeek 行为

## 待定

- **失败兜底**：IDB 一直不写好（事件不来）时的处理——用户决定"先标记，后续再处理"
- 是否需要超时保护

## 验收标准

- [x] 摘要完成后自动清 IDB + 刷新
- [x] 刷新后检测到 URL 参数
- [x] 收到 IDB 写入事件后正确读数据
- [x] share/create 成功 + 跳转（修复：沿 parent_id 回溯主链，见下）
- [x] 分享页自动初始化项目
- [x] 不带参数时（正常使用）不受影响
- [x] typecheck / test / lint / compile 全绿

## 实现记录（补充 2026-09-25：修复 share/create 不成对）

真机测试发现：长会话（1418 条，点过重新生成）压缩时 `share/create` 报
`{"biz_code":6,"biz_msg":"MESSAGES_MUST_APPEAR_IN_PAIRS"}`，拿不到 share_id。

**根因**：原 `pickRecentPairedIds` 假设"message_id 顺序 = 对话顺序"，直接按 id 排序取尾部。
但 DeepSeek 消息是**树**——重新生成/编辑会产生分支（一个 parent 多个 child），
message_id 全局递增，按 id 排序会把"被丢弃的分支"混进来，角色序列不再是
USER/ASSISTANT 交替 → 服务端判"不成对"。

**修复**（对齐 DeepSeek 官方 `rs()` + `parent_id` 回溯）：
- `getMessagesFromIndexedDB` 额外返回 `chat_session.current_message_id`（叶子）
- `pickRecentPairedIds(msgs, leafId, ratio)`：从叶子沿 `parent_id` 回溯主链（`seen` Set 防环），
  再取最近 20% 成对；回溯失败（`chain.length <= 1`）回退旧的 id 排序
- 调用处传 `currentMessageId`

**验证**：真机测试通过（压缩不再报错）。

## 遗留 / 后续

- 失败兜底（待定）
- 超时保护（待定）

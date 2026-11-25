---
id: 261126-q7mxk2-cuko-message-queue
type: feature
title: Cuko 消息发送队列与插话
status: in_progress
branch: feat/261126-q7mxk2-cuko-message-queue
created: 2026-11-26
updated: 2026-11-26
---

# Cuko 消息发送队列与插话

## 背景

Cuko 窗口在 AI 回复期间不能发消息，只能等这一轮结束或先停止。本需求让回复期间也能继续输入：消息先进入排队区，可编辑、删除，到合适的时机自动发出，或插进正在进行的这一轮。

界面效果参考 deepseek-harness 的排队区（可折叠的「N 条排队消息」，每条带编辑 / 删除 / 插话按钮）。原则：只参考 harness 的实现思路，代码全部自己写，不复制。

assistant-ui（已装 @assistant-ui/react 0.15.34）自带队列能力，本需求在此基础上实现：

- `useExternalStoreRuntime` 的 `queue` 选项（`ExternalThreadQueueAdapter`：`items` / `steerItems` 两条通道，`enqueue` / `steer` / `move` / `edit` / `remove`）。
- 界面零件 `ComposerPrimitive.Queue`、`QueueItemPrimitive.Text / Steer / Remove`。
- 已过期写法不用：条目的 `prompt` 字段、条目的 `steer()` 方法（标注 2026-11-05 后移除）。文字从 `parts` 取，插话用 `move({ lane: 'steer', insertAfter: null })`。

## 1. 已确定的决定（2026-11-26）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 队列放在哪 | 主进程。窗口关掉队列不丢，照样自动发 |
| 2 | 插话怎么发 | 不打断当前回复：等本轮工具执行完，和工具结果一起发 |
| 3 | 点停止时 | 排队消息保留，队列暂停；下次手动发送时恢复 |
| 4 | 快捷键 | 用 assistant-ui 默认：回复中 Enter / Ctrl+Shift+Enter 发出的消息进插话通道 |
| 5 | 附件 | 第一版排队消息只支持文字；回复中发带附件的消息给出提示 |
| 6 | 重启后 | 队列只在内存，程序重启后清空 |

关于决定 4：回复中发出的消息默认都进插话通道，不进普通排队。普通排队通道保留在数据结构里（接口的 `enqueue` 仍可用），第一版界面没有专门入口，以后需要再加快捷键。

## 2. 行为规则

### 2.1 发送入口

- 空闲时发送：照原流程（必要时新建会话 → 落附件 → 改标题 → 启动运行），同时恢复已暂停的队列。
- 回复中发送：消息进主进程队列（默认插话通道），输入框清空，排队区显示。

### 2.2 插话通道（steerItems）

- 本轮 AI 调了工具：工具执行完后，取出插话通道全部消息，作为用户消息和工具结果一起发下一轮。
- 本轮 AI 没调工具就要结束：插话通道有消息时不结束运行，把它作为新的用户消息继续下一轮（界面一直是运行中）。
- 被停止 / 出错：不发，留在队列里。

### 2.3 普通排队通道（items）

- 本次运行正常结束且队列没暂停：取第一条自动开始新的运行。
- 出错 / 被停止：队列暂停，不自动发。

### 2.4 停止

- 只停当前运行，不清空队列，队列标为暂停。
- 暂停的队列在下次手动发送，或手动点某条的插话按钮时恢复。

### 2.5 两种协议

- Cuko 协议：插话文字追加到下一轮的 `currentInput`（在工具结果之后）。
- OpenAI 协议：插话存成一条独立的用户消息（`sent_role=user`，`sent_text` = 原话）。`buildChatMessages` 按「相邻同角色用空行合并」把它和前面的工具结果拼在一起；库里只追加，前缀不变，不影响前缀缓存。
- 两种协议都把插话消息存进 `cuko_messages`，界面上显示成一条用户消息，位置在工具卡片之后。

### 2.6 排队区界面

- 位置：输入框上方。标题「N 条排队消息」，可折叠。
- 每条：文字（单行截断）+ 编辑 / 删除 / 插话三个按钮。
  - 编辑：原地修改，保存后提交主进程；取消则不变。
  - 删除：直接删除。
  - 插话：回复中把普通排队条目移到插话通道（已在插话通道的条目标「将插话」）；空闲且队列暂停时，立即发送这一条并恢复队列。
- 回复中发送按钮和停止按钮同时显示。

## 3. 实现

### 3.1 主进程

- 新文件 `src/app/cuko-queue.ts`：每个会话一份队列（插话 / 排队两条通道 + 暂停标记）；条目 = id、文字、窗口 id、创建时间。不依赖 Electron，便于真实测试。
- `cuko-runner.ts` 接入：
  - 工具执行完、发下一轮前（runLoop 工具分支）：取出插话通道 → 落库 + 推送 → 拼进下一轮。
  - 没有 cuckoo 块、本轮要结束时：插话通道非空就继续下一轮。
  - `finishRun`：complete 且未暂停且有普通排队 → 自动启动下一次运行；cancelled / error → 暂停。
  - `cancelCukoRun`：暂停队列。
  - 删除会话时清理该会话的队列。
- IPC（`src/app/ipc/cuko.ts`）：`cuko:queue-get` / `cuko:queue-enqueue` / `cuko:queue-steer` / `cuko:queue-move` / `cuko:queue-edit` / `cuko:queue-remove`；preload 暴露对应方法。
- 运行事件新增 `queue-update`（会话 id + 两条通道快照）；插话消息落库后推送给页面显示（新事件或复用现有事件，写代码时定）。

### 3.2 页面（`src/ui/cuko/app.tsx`）

- 把 `onNew` 的原流程抽成 `sendNow`。
- 自己实现 `ExternalThreadQueueAdapter`：数据来自主进程推送的当前会话队列；空闲时收到的消息走 `sendNow`，回复中交给主进程；move / edit / remove 转主进程。
- 切会话时读取该会话的队列。
- 回复中发带附件的消息：提示「回复中暂不支持附件排队」，不发送、不清空输入框。

### 3.3 界面

- 新文件 `src/ui/cuko/queue-dock.tsx`（用 `ComposerPrimitive.Queue` / `QueueItemPrimitive.*` 自己拼）。
- `thread.aui.tsx`：加插槽放排队区；回复中同时显示发送和停止按钮。

## 4. 不做（第一版）

- 排队消息带附件。
- 队列持久化（重启恢复）。
- 普通排队通道的专门快捷键。
- 拖动排序。

## 5. 测试

- `cuko-queue` 单元测试：入队 / 插话 / 移动 / 编辑 / 删除 / 暂停与恢复 / 取出顺序（插话先于排队）。
- runner 集成：插话在工具执行后拼进下一轮（两种协议）；无工具时插话继续下一轮；正常结束自动续发；停止 / 出错暂停不续发。
- 优先覆盖失败路径：停止时队列不丢、出错不自动发、会话删除时队列清理。
- 真机（npm start）：排队、编辑、删除、插话、停止后恢复、关窗口后继续。

## 6. 进度

- [x] 需求档案 + 分支
- [x] 主进程队列模块 + 测试
- [ ] runner 接入插话与自动续发
- [ ] IPC + preload
- [ ] 页面队列接口
- [ ] 排队区界面 + 输入框
- [ ] 真机验证

## 7. 已知问题

- 2026-11-26 在本分支运行 `npm test`：1184 个测试中 9 个失败，分布在 4 个文件：
  - `test/app/clipboard-paste.test.js`（5 个）：还在检查 html / rtf / 图片能否还原，实现已改成只用 writeText（提交 c0d9bda）。
  - `test/tools/McpQueryTools.test.js`（2 个）、`test/tools/McpCallTool.test.js`（1 个）、`test/tools/GoalDoneTool.test.js`（1 个）：检查 `apiMetas.usage` 里的旧说明文字，工具说明已重写。
- 本分支只新增文件，没改这些测试对应的代码，失败与本需求无关；以后单独开修复需求处理。
- `npm run lint`：0 错误、34 警告，均不在本需求新增的文件里。
- eslint 配置不覆盖 `src/app/cuko-queue.ts`（报 File ignored），该文件靠 `npm run typecheck` 检查。

---
id: 261105-geaofb
type: feature
title: DeepSeek 发送提示词改为模拟真实粘贴（B 方案，最小化剪贴板占用）
status: review
branch: feat/261105-geaofb-deepseek-clipboard-paste
created: 2026-11-05
updated: 2026-11-05
---

# DeepSeek 发送提示词改为模拟真实粘贴

## 背景

当前所有发送提示词的操作（初始提示词、工具结果回传、sendToChat）都走 `setInputContent`：

1. DeepSeek 的 `findInput()` 首选命中原生 `textarea`，走「原生 value setter + input 事件」
2. contenteditable 分支走 `execCommand('insertText')`

两条路径都**不触碰系统剪贴板**，但也不是"真实用户粘贴"语义。若将来改为模拟粘贴，需要评估剪贴板污染风险。

用户诉求：把所有 DeepSeek 相关发送提示词改为模拟用户粘贴，但**不能污染用户剪贴板**。

### A/B 方案对比结论

| 维度 | A：合成 `ClipboardEvent` | B：真系统粘贴（`clipboard.writeText` + `wc.paste()`） |
|---|---|---|
| `isTrusted` | false（站点一行代码即可检测） | true（与真人无差异） |
| 剪贴板占用 | 0 | 约 10~30ms（关键：`paste()` 同步派发，数据快照即刻入渲染进程） |
| 失败模式 | 站点拒收，回退 setter | 异常路径可能残留提示词 |

**选定 B 方案**：事件层面与真人粘贴等价，规避 `isTrusted`/`inputType` 检测；通过「占用窗口最小化 + 全局串行 + 比对恢复 + finally 兜底」把对用户的影响压到不可感知。

## 目标

1. DeepSeek 的提示词填入改为真系统粘贴（`isTrusted=true`）
2. 用户可感知的剪贴板占用 ≤ 30ms，正常路径剪贴板内容完全恢复
3. 异常路径（view 销毁 / paste 抛错 / 进程异常）绝不残留提示词
4. 用户在这 30ms 内自己复制的内容不被覆盖
5. 其他平台行为零变化

## 方案

### 1. provider 开关

`src/providers/types.ts` 增加：

```ts
/** 是否使用真实系统粘贴填入输入框（B 方案）。默认 false = 走现有 setter/insertText。 */
useClipboardPaste?: boolean;
```

仅 `src/providers/deepseek.ts` 设为 `true`。

### 2. 主进程 IPC：`chat-paste-text`

文件：`src/app/ipc/renderer.ts`（接 IPC）+ `src/app/ipc/clipboard-paste.ts`（快照/恢复/串行锁的纯逻辑，依赖注入以便单测）

关键实现点：

- **全局串行队列**（`withClipboardLock`）：`clipboard` 是进程级全局资源，多窗口并发粘贴会交错备份/恢复
- **不抢 OS 窗口焦点**：不调 `win.focus()`，只用 `webContents.paste()`
- **恢复前比对**：`paste()` 后读 `clipboard.readText()`，若已不等于写入内容 → 用户自己复制了新东西 → **跳过恢复**
- **`try/finally` + 恢复再套 try**：保证任何异常路径都尝试恢复，恢复失败只记日志
- **多格式备份**：text / html / rtf / image / bookmark，恢复时用 `clipboard.write()` 一次性写回；全空则 `clear()`
- **恢复时机**：`paste()` 后 `setTimeout 16ms`（让出事件循环）立即恢复，**不等待读回校验**

### 3. bridge 暴露

`src/bridge/api.ts` 暴露 `pasteText(text)` → `ipcRenderer.invoke('chat-paste-text', text)`。

### 4. overlay 接入

`src/overlay/chat-input.ts` 的 `setInputContent` 开头插入：

```ts
const provider = getCurrentProvider();
if (provider && provider.useClipboardPaste) {
  if (await pasteViaClipboard(input, msg)) return true;
}
// 失败则继续原有 provider.fillInput → setter → execCommand 链路
```

`pasteViaClipboard` 步骤：
1. `input.focus()`（DOM 焦点，非窗口焦点）
2. **全选**现有内容（粘贴是替换语义；替代早期"setter 清空 + input 事件"，避免多写一次）
3. `await` bridge 暴露的 `pasteText(msg)`（无 bridge 时直连 IPC）
4. **不做任何输入框内容校验**：paste 派发成功即返回 true

> 2026-11-05 调整：早期版本在粘贴后读回输入框长度做校验，并设了 2000 字上限。
> DeepSeek 会把**超长粘贴直接转成 `.txt` 附件**（输入框留空），导致校验必然判失败
> → 回退 setter 再写一遍 → 变成「附件 + 正文」双份。现改为：**不校验内容、不设长度上限、
> 粘贴派发成功即成功**；站点把内容转成附件属于站点正常行为，一律接受。

### 5. 发送时序（2026-11-05 调整）

原来：填入输入框 → 等随机延迟（10~20s）→ 发送。
现在：**等随机延迟 → 粘贴 → 等 `POST_PASTE_SETTLE_MS`(600ms) → 发送**。

理由：延迟期间输入框保持干净（不把待发内容长时间摆在用户面前）；粘贴后需要给站点
一点时间消化（长文本转附件、重新启用发送按钮），否则"粘贴完立刻发"可能丢内容。

等待用可取消的 Promise 实现（`token.cancelWait`），`cancelPendingSend` /
`takePendingSendText` 能立即叫醒，避免取消后 Promise 悬挂。

## 验收标准

### 自动化

- [x] `npm run typecheck` ✅
- [x] `npm run compile` ✅
- [x] `npx vitest run` 1016 passed（新增 `test/app/clipboard-paste.test.js` 11 例）✅
- [x] 新增单测：`clipboard-paste.ts` 以 FakeClipboard（外部边界替身）覆盖
      备份/恢复、空剪贴板 clear、用户抢复制不覆盖、paste/writeText 抛错、
      串行锁不交错
- [ ] `npm run lint`：全量 3005 problems 全部来自 `tmp/`（历史脚本），
      本次改动文件无问题——与本次改动无关，未修

### 真机（必须，**尚未执行**）

1. 正常发消息 → 输入框内容正确、发送成功
2. 发消息前后手动复制一段文字 → 消息发出后剪贴板仍是那段文字
3. 复制一张图片 → 发消息后剪贴板仍是图片
4. 连续快速发 3 条 → 无交错、无恢复错误
5. 窗口关闭 / 断网时发消息 → 剪贴板不残留提示词
6. 日志实测占用窗口（paste 前后时间戳）应在 30ms 内

## 遗留（已知风险）

- **R1**：用户恰好在 10~30ms 内按 Ctrl+C，其复制结果会被覆盖（概率极低，人反应最快 ~100ms）
- **R2**：`webContents.paste()` 对非 textarea 的兼容性未验证（DeepSeek 是原生 textarea，最稳）
- **R3**：纯逻辑（快照/恢复/串行锁）已由 `test/app/clipboard-paste.test.js` 覆盖；
  但 `clipboard` 真实写回、`webContents.paste()` 的派发时序仍只能真机验证
- **R4**：`paste()` 依赖 DOM 焦点，若 DeepSeek 改版为 contenteditable 需重新验证
- **R5**：本次改动在无 GUI 环境完成，上面 6 项真机验收未执行，故 status 置
  `review`；请在 `npm start` 下逐条验证后再改 `done`

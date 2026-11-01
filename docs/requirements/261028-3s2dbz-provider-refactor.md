---
id: 261028-3s2dbz
type: refactor
title: Provider 契约重构（方法收敛与语义澄清）
status: doing
branch: refactor/261028-3s2dbz-provider-refactor
created: 2026-10-28
updated: 2026-10-30
---

## 背景

Provider 是「接入一个新 AI 平台」的唯一入口。当前接口（`src/providers/types.ts`）包含：

- 4 个必填元信息字段（id / name / homeUrl / sessionUrlBase）
- 2 个必填方法（matchesUrl / extractSessionId）
- 6 个 DOM 抓取相关可选成员（findInput / findSendButton / fillInput / triggerSend / extractUserInfo / isElementVisible + 选择器字段）
- 2 个网络拦截成员（useIntercept / getHookSource）
- 5 个平台扩展成员（getSessionListFn / getStopFn / getAttachProbeSource / getPromptTemplate / transformToolResult）

暴露出的功能层面问题：

1. **信息重复且无一致性约束**：`homeUrl`、`homeUrlPattern`、`matchesUrl` 三者都在描述「这是不是本平台 / 是不是首页」，彼此独立维护，改一处忘一处不会有任何提示。
2. **返回值形态混用**：`getSessionListFn` / `getStopFn` 返回**函数**，`getHookSource` / `getAttachProbeSource` 返回**源码字符串**，都是"注入 AI 页面执行"但形态不一，写错后错误信息无指向性。
3. **接口在撒谎**：`inputSelectors` / `inputKeywords` / `isElementVisible` 框架从不调用，却被放进 `Provider` 契约，导致写 provider 的人误以为填了就有用。
4. **框架在碰 DOM**：输入框查找、写入、读回校验、触发发送、光标移动全部由 overlay 主流程实现，provider 只提供零散钩子。每次遇到新平台怪癖（如 ChatGPT 多个 ProseMirror / 免疫合成事件）都要在框架里打补丁。
5. **能力分层不显式**：DOM 抓取、网络拦截、平台扩展三类能力平铺，新增平台需读三个内置实现才能反推"该给哪些"。

## 目标

- **框架不再碰 DOM**：输入框的查找、读写、发送全部由 provider 承担，框架只负责「决定发什么、什么时候发、何时取消」。
- 接口只列**框架真正会调用的成员**，消除死字段与形态混用。
- 引入 `apiVersion` 兼容机制，v1（现有全部 provider）行为零变化，v2（新契约）作为目标形态。
- 三个内置平台中，**DeepSeek 先行迁移到 v2**；Claude / ChatGPT 与所有自定义 provider 暂留 v1。

## 方案

### 决策总表（逐项评审结论）

| # | 议题 | 决策 | 说明 |
|---|---|---|---|
| 1 | `matchesUrl` | **保留现状** | 仍为必填方法 + 裸 URL 入参 + 子串匹配。子串语义弱、与 `homeUrlPattern` 重复记为遗留。 |
| 2 | `extractSessionId` | **补契约注释** | 签名不变；把「返回值被当作持久化绑定 key，必须稳定」「不得把中间态当 ID」两条约束上提到 `types.ts`。 |
| 3 | 版本机制 | **可选 `apiVersion`，缺省 1** | 仅"同名不同义"时递增；纯增量变更用能力探测（`typeof`）。契约注释写明何时该升、何时不该升。 |
| 4 | `inputSelectors` / `inputKeywords` / `isElementVisible` | **移出 Provider 契约** | 按「框架是否真的调用」重划边界：这三者框架从不调用，从契约删除，允许 provider 内部自定义。`inputKeywords` 为死字段直接删。 |
| 5 | DOM 逻辑归属 | **收进 `legacy-adapter` + 网关分派** | 原方案选项 C：把 overlay 的 DOM 逻辑搬到 provider 侧，registry 按版本包装。后经讨论改为**网关模式**（见 #6），核心目标「框架不碰 DOM」不变。 |
| 6 | v1/v2 分派位置 | **`chat-input.ts` 内 4 个网关函数** | `gatewaySend` / `gatewayFill` / `gatewayGetText` / `gatewayFocusEnd`。上层 20+ 调用点全部改调网关，分派只在 4 处。v1 的 DOM 逻辑原地保留，由网关调用。 |
| 7 | v2 契约 | **`sendMessage` 必填 + 3 个可选** | `sendMessage(text, { delayMs?, signal? })` 必填；`fillInput(text)` / `getInputText()` / `focusInputEnd()` 可选，缺失时框架降级。 |
| 8 | `sendMessage` 签名 | **`(text, { delayMs?, signal? }): Promise<boolean>`** | 框架决定延迟与取消时机，provider 决定用哪个 DOM、怎么填、怎么触发。 |
| 9 | 状态归属边界 | **业务意图归框架，执行过程归 provider** | 框架记事本存：待发文本、tag、是否已取消、定时器、AbortController。provider 内部存：填到第几次、按钮坐标、输入框引用等局部变量。零重叠。 |
| 10 | 取消与捞回 | **一个记事本，双手段同时做** | `cancelPendingSend` / `takePendingSendText` 签名与行为不变；内部同时 `clearTimeout`（v1）+ `controller.abort()`（v2），不判断版本。文本存在固定一格，捞回与版本无关。 |
| 11 | `signal` 语义约定 | **写进契约注释** | ① 每次 await 前后检查 `aborted`；② 填入后发送前的延迟期可被中断；③ 取消时输入框内容保留。 |

### v2 契约草案

```ts
interface Provider {
  // ── 元信息（本次不动）──
  id: string;
  name: string;
  homeUrl: string;
  sessionUrlBase: string;

  /** 可选。缺省视为 1；仅在「同名不同义」的破坏性变更时递增 */
  apiVersion?: number;

  // ── 必填方法（本次不动）──
  matchesUrl(url: string): boolean;
  extractSessionId(url: string): string | null;   // 契约注释补充稳定性约束

  // ── v2 发送链路 ──
  /**
   * 填入并发送。
   * @param opts.delayMs 填入后、发送前的等待（框架算好的延迟）
   * @param opts.signal  取消信号；abort 后不再发送，已填内容保留
   * 语义约定：① 每次 await 前后检查 aborted；② 延迟期可中断；③ 取消时内容保留
   */
  sendMessage(text: string, opts?: { delayMs?: number; signal?: AbortSignal }): Promise<boolean>;

  // ── 可选能力（缺失时框架降级）──
  fillInput?(text: string): Promise<boolean>;
  getInputText?(): string;
  focusInputEnd?(): void;

  // ── 其余现有成员（本次逐个评审中，见下方「待评审」）──
}
```

### 网关与记事本（`chat-input.ts` 内部）

```ts
interface PendingSend {
  text: string;
  tag: string;
  cancelled: boolean;
  timer: any | null;                    // v1
  controller: AbortController | null;   // v2
}

function apiVersion(p: any): number {
  return (p && typeof p.apiVersion === 'number') ? p.apiVersion : 1;
}

// 4 个网关：gatewaySend / gatewayFill / gatewayGetText / gatewayFocusEnd
// 分派只在这 4 处；v1 的 findInputArea / setInputContent / triggerSend / moveCaretToEnd 原样保留
```

### 代码落点（待实现后补行号）

| 决策 | 落点 |
|---|---|
| v2 契约字段 | `src/providers/types.ts` |
| 版本判定 + 包装 | `src/providers/registry.ts`（或 `chat-input.ts` 网关内） |
| 4 个网关 | `src/overlay/chat-input.ts` |
| DeepSeek v2 实现 | `src/providers/deepseek.ts` |
| 契约注释（signal 语义、extractSessionId 稳定性、apiVersion 升降规则） | `src/providers/types.ts` |

## 验收标准

- [ ] `types.ts` 契约注释包含：`apiVersion` 升降规则、`extractSessionId` 稳定性约束、`signal` 三条语义约定
- [ ] `inputKeywords` 从 `types.ts` 与两套模板中删除；`inputSelectors` / `isElementVisible` 从契约移出（provider 内部可保留）
- [ ] `chat-input.ts` 出现 4 个网关函数，上层调用点全部改为调网关
- [ ] `pendingSend` 增加 `controller` 字段，`cancelPendingSend` / `takePendingSendText` 双手段同时生效
- [ ] DeepSeek 设置 `apiVersion: 2` 并实现 `sendMessage`；发送/取消/上下文耗尽续接真机验证通过
- [ ] Claude / ChatGPT / 所有自定义 provider 保持 v1，行为零变化（真机验证：初始提示、工具结果回传、停止按钮）
- [ ] `npm run typecheck` / `npm test` / `npm run lint` / `npm run compile` 全绿

## 待评审（尚未决策的成员）

- `extractUserInfo`（窗口标题用户名）
- `homeUrlPattern`（首页判断，与 `matchesUrl` 的关系）
- `useIntercept` / `getHookSource`
- `getSessionListFn` / `getStopFn` / `getAttachProbeSource`（形态混用问题）
- `getPromptTemplate` / `transformToolResult`
- `fillInput` / `triggerSend` 旧签名在 v1 下的去留
- `Provider` 中文名

## 遗留

- `matchesUrl` 子串匹配语义弱，与 `homeUrlPattern` 存在重复（决策 #1）
- `provider.template.js`（custom）与 `templates/provider-dev/` 两套模板并存，待收敛
- v1 DOM 逻辑（`findInputArea` / `setInputContent` / `triggerSend` / `moveCaretToEnd` / `isInputVisible`）在 Claude/ChatGPT 迁移到 v2 后可删除

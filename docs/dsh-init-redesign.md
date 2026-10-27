# DSH 初始化对话重设计 —— 移交文档

> ⚠️ **部分过时（2026-10-26）**：本文档描述的「新窗口立刻生成 `local-xxx` 临时 ID 并落库」设计已在 `c4b889d` 中**彻底废除**。现行做法：没发消息就没有会话记录，落地首页/分享页立刻清空 `currentSessionId`。其余关于「选目录只登记」「首发合并发消息」「卡片显示条件」的设计仍然有效，仅作历史与思路参考。

> 面向：接手此任务的 AI / 开发者
> 目的：完整说明“初始化对话”的现状、新设计、两种模式（原网页 / 纯净模式）的差异、技术细节、边界情况。
> 相关文档：docs/dsh-compat-decisions.md（整体决策记录）

---

## 一、为什么改（背景）

### 1.1 现状的问题

当前逻辑（旧行为）：
    打开新页面 -> 判断“首页 && 未选目录” -> 显示“初始化项目”卡片
       ↓ 点卡片
    弹目录选择框 -> 选完
       ↓
    立即发送系统提示词（initial-prompt）
       ↓
    AI 回复“我明白了”（这是第一条消息）
       ↓
    用户再输入 -> 第二条消息

问题：
1. AI 先回“我明白了”（多一轮，浪费 token 和时间）
2. “初始化”和“发消息”绑在一起（选目录 = 立刻发系统提示词，用户没机会“先选目录，晚点再聊”）
3. 老会话（有 sessionId、未绑目录）不弹卡片（只在“首页”弹）
4. 两种模式（原版 / 纯净）行为不一致（原版是网页输入框，纯净是 Cuckoo 输入框）

### 1.2 新的目标

1. 选目录 = 只登记（不发消息）
2. 首次发消息 = 系统提示词 + 用户消息合并发（AI 直接干活，不寒暄）
3. 两种模式统一（都是“首次发消息带系统提示词”）
4. 老会话也支持（有 sessionId 但未绑目录 -> 也弹卡片）

---

## 二、现状分析（现有代码）

### 2.1 关键文件

| 文件 | 职责 |
|---|---|
| src/session/store.ts | 会话存储（sessionStore）+ URL 变化处理（handleUrlChange）|
| src/session/project-context.ts | 初始化项目（initProject：弹目录框 + 发系统提示词）|
| src/app/ipc/harness.ts | 纯净模式 IPC（harness-send / harness-new-conversation / harness-init-project）|
| src/overlay/panel.ts | 原版模式覆盖层（初始化卡片显示/隐藏）|
| src/overlay/template/overlay.html | 覆盖层的 HTML（初始化卡片）|
| src/overlay/events.ts | 覆盖层事件（“初始化项目”按钮点击）|
| src/overlay/chat-input.ts | 原版模式输入框相关（initial-prompt 监听）|
| src/session/prompt-builder.ts | 系统提示词构建（buildPrompt）|
| src/ui/harness.html | 纯净模式页面 |

### 2.2 现有流程（代码级）

① 初始化卡片显示条件（overlay/panel.ts:339-354）：
    // 只判断“是不是在首页”
    atHome = url === 'https://chat.deepseek.com/'
    showCard = atHome && !initialized

问题：老会话（URL 是 .../s/xxx）不在首页 -> 不显示。

② 点“初始化项目”按钮（overlay/events.ts:469）：
    // 调 initProject（弹目录框 + 发系统提示词）
    await window.electronAPI.initProject()

③ initProject 内部（project-context.ts）：
    // 1. 弹目录选择框
    const result = dialog.showOpenDialogSync(mainWindow, {...})

    // 2. 保存目录（如果已有 sessionId 就绑，否则存 pendingProjectDir）
    if (sessionStore.state.currentSessionId) {
      sessionStore.saveSessionDirMapping(currentSessionId, selectedDir);
    } else {
      sessionStore.state.pendingProjectDir = selectedDir;
    }

    // 3. 立即发系统提示词
    const built = buildPrompt({ providerId, selectedDir, isCompaction });
    view.webContents.send('initial-prompt', combined);

④ URL 变化时（store.ts:257-290 handleUrlChange）：
    // 从 URL 提取 sessionId
    const sessionId = extractSessionIdFromUrl(url);

    // 如果有 pendingProjectDir，绑定
    if (state.pendingProjectDir) {
      saveSessionDirMapping(sessionId, state.pendingProjectDir);
      state.selectedProjectDir = state.pendingProjectDir;
      state.pendingProjectDir = null;
      return;
    }

⑤ 纯净模式发消息（harness.ts:194-209 harness-send）：
    // 用户消息 -> 转发给 AI 页面
    ctx.view.webContents.send('harness-user-message', { text });

⑥ 原版模式发消息：用户在网页输入框直接打字，我们不拦截（没有监听）。

---

## 三、新设计（完整方案）

### 3.1 核心变化

| 项 | 旧行为 | 新行为 |
|---|---|---|
| 选目录 | 立即发系统提示词 | 只登记，不发 |
| 发消息 | 第二条消息 | 首次发消息 = 系统提示词 + 用户消息合并 |
| 卡片条件 | 只在首页弹 | 当前会话未绑目录就弹（新窗口 + 老会话都弹）|
| 两种模式 | 原版网页输入框 / 纯净 Cuckoo 输入框 | 原版：覆盖层输入框；纯净：Cuckoo 输入框（隐藏系统提示词） |
| 绑定时机 | 选目录时 | 新窗口：URL 变化时；老会话：选完目录立刻绑 |

### 3.2 完整流程图

【新窗口（无 sessionId）】
① 打开新页面（AI 首页）
   ↓
② 判断：当前会话是否绑目录？-> 否（无 sessionId 也算未绑）
   ↓
③ 显示“初始化项目”卡片（原版：覆盖层；纯净：harness 页面内）
   ↓ 用户点卡片
④ 弹目录选择框 -> 选完
   ↓
⑤ 存内存（pendingProjectDir = dir），不发消息
   ↓
⑥ 显示输入框（原版：覆盖层；纯净：harness 输入框）
   ↓ 用户输入“帮我改代码”，点发送
   ↓
⑦ 判断：这个会话发过系统提示词吗？-> 没发过
   ↓
⑧ 合并发：「系统提示词 + 用户消息」
   ↓
⑨ AI 回复 -> URL 变化（拿到 webId）
   ↓
⑩ saveSessionDirMapping(webId, dir)（绑定完成）
   ↓
⑪ 原版模式：覆盖层隐藏，交还网页原生输入框
   纯净模式：输入框恢复正常（后续消息不带系统提示词）

【老会话（有 sessionId、未绑目录）】
① 切到某个老会话（URL 是 .../s/xxx）
   ↓
② 判断：这个 sessionId 绑了目录吗？-> 否
   ↓
③ 显示“初始化项目”卡片
   ↓ 用户点卡片
④ 弹目录选择框 -> 选完
   ↓
⑤ 立刻绑定：saveSessionDirMapping(sessionId, dir)（有 sessionId，不用等）
   ↓
⑥ 显示输入框（原版：覆盖层；纯净：harness 输入框）
   ↓ 用户输入，点发送
   ↓
⑦ 合并发：「系统提示词 + 用户消息」（因为这个会话没发过）
   ↓
⑧ AI 回复
   ↓
⑨ 原版模式：覆盖层隐藏

### 3.3 两种模式的详细设计

#### A. 原版模式（AI 网页）

核心：覆盖层输入框盖住网页原生输入框。

为什么：网页原生输入框我们监控不到发送事件（用户直接打字 + 回车，是网页自己的事件），没法在发送时“合并系统提示词”。

方案：在网页输入框上方“盖”一个我们自己的输入框：
- 用户点到的都是我们的输入框
- 用户写的内容 -> 我们拿到
- 点“发送” -> 我们拼接「系统提示词 + 用户消息」-> 通过 bridge 发到网页（填输入框 + 点发送）

UI 细节：
1. 外观：做成跟网页输入框一样（用户看不出是我们画的）
2. 位置：正好盖在网页原生输入框上（各平台位置不同，要适配）
3. “重新选择目录”按钮：小按钮，点了退回“初始化卡片”（选错了能重选）
4. 等待期间（AI 回复中）：
   - 禁用输入框（灰色）
   - 显示“AI 正在处理…”
   - 提供“停止”按钮（转发 stopGeneration）
5. 绑定成功后：覆盖层隐藏，交还网页原生输入框（用户回到原版体验）

技术细节：
- 已有能力：src/overlay/ 目录（overlayView 透明置顶层，插件 UI 已经在用）
- “填输入框”：网页输入框是 React/Vue 受控的，直接改 value 会被覆盖 -> 要用 nativeInputValueSetter + input 事件模拟
- “点发送”：bridge 已有 sendToChat（纯净模式在用）

关键风险：
- 覆盖层要对齐网页输入框位置（DeepSeek/Claude/ChatGPT 各不同）
- 平台改版 -> 位置变了 -> 覆盖层错位（要维护）

#### B. 纯净模式（harness.html）

核心：Cuckoo 自己的输入框，隐藏系统提示词。

为什么：纯净模式是我们自己画的页面，输入框我们完全控制 -> 可以“隐藏系统提示词”（用户看不到几 KB 的提示词，专注写需求）。

UI 细节：
1. 输入框：Cuckoo 自己的输入框（harness.html 里的）
2. 占位提示：（已附加系统提示词，直接写需求）
3. 实际内容：系统提示词藏在 state 里（data-ck-system-prompt 或 JS 变量）
4. 点“发送”：合并「系统提示词 + 用户消息」-> 走 harness-user-message
5. 等待期间：禁用输入框 + “AI 正在处理…” + “停止”按钮（已有 harness-stop）
6. 绑定成功后：输入框恢复正常（后续消息不带系统提示词）

技术细节：
- 已有能力：harness.html + harness-send + harness-stop
- “隐藏系统提示词”：不用改 UI（输入框只是“看起来空”），发送时拼接即可
- “已附加”提示：输入框的 placeholder（CSS ::placeholder）

### 3.4 初始化卡片的显示条件

新条件（overlay/panel.ts 和 harness.html 都要改）：

    // 旧：只看“是不是首页”
    showCard = atHome && !initialized

    // 新：看“当前会话是否绑目录”
    const sessionId = sessionStore.state.currentSessionId;
    const hasDir = sessionId ? !!sessionStore.getSessionMeta(sessionId)?.projectDir : false;
    showCard = !hasDir;   // 无 sessionId 也算“没绑”

即：
- 新窗口（无 sessionId） -> 显示
- 老会话（有 sessionId、未绑目录） -> 显示
- 已绑目录 -> 不显示

已绑目录时，用户想换目录：走“快捷提示词 -> 重新项目初始化”（不通过卡片）。

### 3.5 绑定时机

| 场景 | 绑定时机 | 机制 |
|---|---|---|
| 新窗口（无 sessionId） | URL 变化时（AI 回复后拿到 webId）| 现有机制：pendingProjectDir（store.ts:283）|
| 老会话（有 sessionId、未绑目录） | 选完目录立刻绑 | saveSessionDirMapping(sessionId, dir) |

新窗口的细节：
- 选完目录 -> state.pendingProjectDir = dir（只存内存）
- 用户发消息 -> AI 回复 -> URL 变化 -> handleUrlChange 触发 -> 这时才 saveSessionDirMapping

---

## 四、涉及的文件和改动点

### 4.1 要改的文件

| 文件 | 改什么 |
|---|---|
| src/session/project-context.ts | 拆成两个函数：selectProjectDir(ctx)（弹框+存目录）和 sendSystemPrompt(ctx, text)（发提示词，从 initProject 里拆出来） |
| src/app/ipc/harness.ts | harness-send 改成“检查是否首发 -> 合并发” |
| src/overlay/panel.ts | 卡片显示条件改成“看会话是否绑目录” |
| src/overlay/events.ts | “初始化项目”按钮：改成只选目录（不发提示词） |
| src/overlay/chat-input.ts | initial-prompt 监听：改成“存到 state”（不立即发） |
| src/ui/harness.html | 输入框加 placeholder；发送时合并系统提示词 |

### 4.2 要新建的文件

| 文件 | 内容 |
|---|---|
| src/overlay/init-input.ts（新） | 原版模式的覆盖层输入框（盖住网页原生输入框） |
| src/session/init-state.ts（新） | “是否首发”的内存标记（Set<webId>，不落盘） |

### 4.3 复用的现有能力

| 能力 | 位置 | 复用方式 |
|---|---|---|
| 系统提示词构建 | session/prompt-builder.ts buildPrompt() | 直接调 |
| 系统提示词发送 | project-context.ts:174 initial-prompt | 抽离成 sendSystemPrompt() |
| 用户消息发送 | app/ipc/harness.ts:207 harness-user-message | 抽离成 sendUserMessage() |
| bridge 发送 | sendToChat（纯净模式在用）| 原版模式也用它 |
| 覆盖层 | src/overlay/（overlayView）| 原版模式输入框用这个层 |
| 停止生成 | harness-stop（harness.ts:228）| 覆盖层“停止”按钮调它 |
| 会话存储 | session/store.ts | 直接调 |

---

## 五、边界情况（必须处理）

| # | 场景 | 处理 |
|---|---|---|
| 1 | 选完目录，用户没发消息就关窗口 | 目录已绑（老会话）或 pendingProjectDir 丢失（新窗口，下次要重选） |
| 2 | AI 回复失败 / 超时 | 输入框恢复可用，用户重试（系统提示词重新拼） |
| 3 | 用户点了“重新选择目录” | 清空 selectedProjectDir，退回卡片 |
| 4 | 绑定成功后，用户又开新会话 | 新会话无 sessionId -> 又显示卡片（正常） |
| 5 | 纯净模式“首发”判断 | 内存 Set<webId>（不落盘；重启后老会话多带一次，无害） |
| 6 | 原版模式“填输入框”失败（React 受控覆盖）| 用 nativeInputValueSetter + input 事件；失败则降级为“提示用户手动复制” |
| 7 | AI 回复期间用户点“停止” | 目录不绑（AI 没回复完 = 没拿到 webId），输入框恢复可用 |
| 8 | 两个窗口同时初始化 | 各自独立（pendingProjectDir 是每窗口一份） |

---

## 六、已确认的决策（来自 docs/dsh-compat-decisions.md）

| # | 决策 |
|---|---|
| 1 | 选目录 = 只登记，不发消息 |
| 2 | 首次发消息 = 系统提示词 + 用户消息合并发 |
| 3 | 原版模式：覆盖层输入框（用户可见系统提示词） |
| 4 | 纯净模式：隐藏系统提示词（占位提示，发送时合并） |
| 5 | 卡片显示条件：当前会话是否绑目录 |
| 6 | 已绑目录 -> 不显示（改目录走快捷提示词） |
| 7 | 老会话：选完目录立刻绑；新窗口：URL 变化时绑 |
| 8 | 等待期间：禁用输入框 + 停止按钮 |
| 9 | 绑定成功后：原版覆盖层隐藏，交还网页原生输入框 |
| 10 | “首发”判断：内存 Set<webId>（不落盘） |

---

## 七、未确认事项（接手者要定）

| # | 事项 | 备注 |
|---|---|---|
| 1 | 原版模式“填输入框”的 React/Vue 兼容技术 | nativeInputValueSetter + input 事件（要各平台测试）|
| 2 | “AI 首次回复成功”的精确判断 | harness-event 的 status: idle 够不够 |
| 3 | 覆盖层输入框“对齐”网页输入框 | 各平台位置不同（DeepSeek/Claude/ChatGPT），要适配 |
| 4 | “重新选择目录”按钮的位置 | 覆盖层输入框旁边？还是输入框内？ |
| 5 | 纯净模式“系统提示词”存哪 | 全局变量？window.__ckSystemPrompt？还是 data- 属性？ |
| 6 | 老会话“选完目录立刻绑”后，用户不发消息 | 目录已绑，下次进来不弹卡片（符合预期）|

---

## 八、技术参考（现有代码位置）

### 8.1 初始化卡片

- HTML：src/overlay/template/overlay.html:4-6
    <div class="cuckoo-first-time-text">首次创建对话时，需要初始化项目，并选择一个项目目录，不然无法使用</div>
    <button id="cuckoo-btn-first-init" class="cuckoo-btn cuckoo-btn-primary">初始化项目</button>
- 显示逻辑：src/overlay/panel.ts:339-354
- 点击处理：src/overlay/events.ts:469

### 8.2 初始化流程

- initProject：src/session/project-context.ts:51-188
  - 签名：async function initProject(skipPrompt, windowContext, presetDir, isCompaction, extraPrompt, noDialog, parentSessionId)
  - 要拆成：selectProjectDir（弹框）+ sendSystemPrompt（发提示词）

### 8.3 系统提示词

- 构建：src/session/prompt-builder.ts buildPrompt({ providerId, selectedDir, isCompaction })
- 发送：project-context.ts:174 view.webContents.send('initial-prompt', combined)
- 接收：src/overlay/chat-input.ts:539 ipcRenderer.on('initial-prompt', ...)

### 8.4 用户消息

- 纯净模式：harness.ts:207 ctx.view.webContents.send('harness-user-message', { text })
- 原版模式：用户直接在网页输入框打字（我们不拦截）

### 8.5 URL 变化（绑定时机）

- handleUrlChange：src/session/store.ts:257-290
  - extractSessionIdFromUrl(url) -> sessionId
  - if (state.pendingProjectDir) -> saveSessionDirMapping

### 8.6 覆盖层

- 目录：src/overlay/
- 主文件：panel.ts（显示/隐藏）、events.ts（事件）、chat-input.ts（输入框）
- 模板：template/overlay.html
- 视图：window.ts overlayView（透明置顶层）

---

## 九、验收标准

完成后应该满足：

1. 新窗口：打开 -> 显示卡片 -> 选目录 -> 输入框出现 -> 用户写 -> 发送 -> AI 直接干活（不寒暄）
2. 老会话（未绑目录）：切到老会话 -> 显示卡片 -> 选目录 -> 立刻绑定 -> 输入框出现 -> 用户写 -> 发送 -> AI 直接干活
3. 老会话（已绑目录）：切到老会话 -> 不显示卡片 -> 用户直接用网页原生输入框（原版）或 harness 输入框（纯净）
4. 纯净模式：输入框占位提示“已附加系统提示词”，用户看不到几 KB 提示词
5. 原版模式：覆盖层输入框盖住网页输入框，用户看不出是我们画的
6. 等待期间：输入框禁用 + “停止”按钮可点
7. 绑定成功后：原版覆盖层隐藏，交还网页原生输入框
8. 换目录：走“快捷提示词 -> 重新项目初始化”（不通过卡片）

---

## 十、参考：DSH 的等价物

DSH 没有“初始化对话”这个概念——它的 setup 里 agentPresets.mount 是纯内存（往 ctx 里注册工具），不产生对话消息。

即：系统提示词在 DSH 里是 preset 的一部分（进 API 请求的 system 字段），不是对话消息。

Cuckoo 的差异：网页 AI 没有 system 字段，系统提示词只能当第一条消息发——这就是“合并发”的由来。

---

*最后更新：2026-10-19*

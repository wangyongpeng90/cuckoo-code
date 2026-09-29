# 04 运行时数据流

> 理解"一切是怎么跑起来的"。

## 1. 窗口结构

每个 profile 一个 `BrowserWindow`，内部两部分：

```
BrowserWindow
├── webContents（窗口自身）= 地址栏壳页面 src/ui/shell.html
│     preload: src/app/shell-preload.ts → window.shellAPI
│     占顶部 44px（TOOLBAR_HEIGHT）
│
└── WebContentsView（子视图）= AI 网页
      preload: src/bridge/entry.ts → window.electronAPI
      占地址栏下方全部区域（随窗口 resize）
```

**为什么这样分**：地址栏需要独立于 AI 网页（不随页面导航、不被页面 CSS 影响），而 AI 网页要占满剩余空间。

**关键推论**：`win.webContents` 是**壳页面**，不是 AI 页面。凡是要操作 AI 页面（loadURL、executeJavaScript、send），必须拿 `ctx.view.webContents`。

## 2. 启动流程

```
src/app/entry.ts
  ├── app.setPath('userData', ...)      # 数据目录
  ├── registerIpcHandlers()             # 注册所有 IPC
  ├── app.requestSingleInstanceLock()   # 单实例锁
  └── app.whenReady()
        └── createWindow(profile)
              ├── new BrowserWindow(...)          # 壳
              ├── new WebContentsView(...)        # AI 页面
              ├── addChildView + layoutView       # 布局
              ├── windowState.addWindow(win, ..., view)
              ├── 加载 shell.html
              └── 加载 AI 页面（provider.homeUrl 或平台选择页）
```

**平台未定**时，view 加载 `ui/platform-select.html`；用户选择后触发 `select-platform` IPC → 更新 profile → 销毁旧窗 → 用新 partition 重建。

## 3. AI 回复捕获（网络拦截模式）

```
① preload 注入 hook（主世界）
   bridge/entry.ts → webFrame.executeJavaScript(provider.getHookSource())
   hook 猴补丁 window.fetch / XMLHttpRequest

② AI 网页发起 completion 请求
   hook 拦截响应，读 SSE 流，解析成完整回复

③ hook 派发事件（主世界 window）
   window.dispatchEvent(new CustomEvent('cuckoo-ai-response', { detail }))
   detail = { text, finished, status, tokenUsage, msgIds, ... }
   失败/中断 → 'cuckoo-ai-error'

④ preload 的 observer 监听（隔离世界）
   bridge/intercept/observer.ts
     - status=stopped → 忽略（用户主动停）
     - finished → 通知监听器 + processInterceptedResponse(text)
     - error → 通知重试引擎

⑤ 处理回复
   processInterceptedResponse(text)
     ├── extractJsToolBlocks(text) 有 cuckoo 块 → 执行工具
     ├── looksLikeJsonToolCall(text) → 发提示让 AI 改用 cuckoo 块
     ├── XML 格式 → 发提示
     └── 纯文本 → 视为任务完成，退出工具循环
```

**hook 与 preload 的关系**：hook 在**主世界**（能改 window.fetch），preload 在**隔离世界**（能用 electronAPI）。两者靠 `window.dispatchEvent / addEventListener` 通信。

## 4. 工具调用循环（核心）

```
AI 输出 cuckoo 代码块
  ↓（步骤 3 捕获）
observer 提取代码块
  ↓
executor.handleJsToolScript(code)
  ↓ electronAPI.executeJs(code, callId)   ← contextBridge
  ↓ IPC 'execute-js'
主进程 ipc/tool.ts
  ↓ jsRunner.run(code, projectDir, windowId, settings)
JsRunner：vm 沙箱执行
  ├── 注入工具函数（bootstrap.generated.ts）
  ├── 沙箱内 await read(...) 等 → __hostBridge → registry.execute
  └── 返回 { success, output }
  ↓
executor 渲染结果到面板
  ↓
chatInput.sendCombinedJsResultsToChat(results)
  ↓ 填回输入框 + 触发发送
AI 看到结果 → 继续下一步（回到顶部）
```

**沙箱安全**：`vm.createContext` + 禁用代码生成 + `__hostBridge` 唯一桥接 + 超时（同步 30s / 整体 60s）。详见 `src/tools/runtime/JsRunner.ts`。

## 5. 上下文压缩（compaction）

```
用户点"压缩" → runCompaction(projectDir)
  1. 发摘要指令给 AI（"请把以上对话总结成..."）
  2. waitForResponse 等 AI 回复（走 observer 的 onInterceptedResponse）
  3. 从 URL 取 chat_session_id
  4. 从 IndexedDB 读全量 message_ids
  5. 用缓存的真实请求头 fetch /api/v0/share/create
  6. 得分享链接 → 存标记 → window.location.href 跳转
  7. 新页面加载 → checkPendingInit 自动初始化项目
```

依赖 hook 把真实请求头缓存到 `localStorage['cuckoo-ds-headers']`。

## 6. 两个保护机制

### 看门狗（watchdog）—— AI 卡住

- **进入**：检测到工具调用 → 进入工具循环
- **计时**：在工具循环中"发出消息"时开始计时
- **触发**：超时（默认 300s）→ 发"请继续"
- **退出**：收到任意终态回复 / 回复无工具调用（纯文本）
- 配置：`cuckoo-xhr-idle-timeout` / `cuckoo-watchdog-prompt` / `cuckoo-watchdog-count`

### 重试引擎（retry）—— 请求失败/中断

- **订阅**：`cuckoo-ai-error` 事件
- **触发**：失败 / 服务端截断 → 按退避间隔重发提示词（默认 4~10s）
- **429**：单独配置（默认 60s）
- 成功回复重置计数；压缩期间暂停
- 配置：`cuckoo-retry-*`

## 7. MCP

- 主进程 `mcp/client.ts` 维护与各 server 的连接（stdio / http）
- 工具 `mcpListServers` / `mcpGetTools` / `mcpCall` 通过 `__hostBridge` 调用
- 提示词组装时（`prompt-builder.ts`）注入已启用 server 列表
- 配置面板在 shell 侧栏（`src/ui/shell.html` + `src/ui/panels.js`）

## 8. 会话与项目

- `session/store.ts`：URL 变化 → 提取 sessionId → 查映射表 → 恢复项目目录；通过 `view.webContents.send` 通知渲染进程
- `session/project-context.ts`：`initProject` 选目录 → 保存映射 → 调 `prompt-builder` 组装 → 发送
- 每个 profile 独立的 sessionStore（独立 partition + 独立 json 文件）

## 9. 地址栏

- 壳页面 `shell.html` 通过 `window.shellAPI` 调 IPC
- `ipc/shell.ts`：navigate/back/forward/reload/home → 操作 `ctx.view`
- 页面导航时（`did-navigate`）→ `pushUrlState(view)` → `win.webContents.send('shell-url-updated', ...)` → 壳页面更新地址栏

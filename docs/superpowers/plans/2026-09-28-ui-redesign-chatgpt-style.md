# Cuckoo Code 界面改版（ChatGPT 桌面版形态）实施计划

**Goal:** 把应用界面从「AI 页面内注入悬浮面板」改为「ChatGPT 桌面版形态」：浅色主题、左侧图标栏+可展开面板、顶部导航栏、AI 页面以圆角卡片嵌在右侧，注入页面的悬浮面板/token 状态条彻底移除。

**Architecture:** 三个层级各自归位——**shell（窗口 chrome）** 承载所有操作 UI（它本来就是我们自己的页面，不受宿主约束）；**主进程** 承接设置存储与任务状态中转；**注入 AI 页面的 overlay** 只保留必须在页面内的瞬态元素（工具执行遮罩、toast、重试倒计时）。Electron 44 的 `view.setBorderRadius()`（已确认存在于 `node_modules/electron/electron.d.ts:16111`）提供真圆角。

**Tech Stack:** 现有 Electron + TS + vanilla JS，无新框架。测试沿用 vitest + happy-dom 约定。

## 目标形态（设计决策，执行时不发散）

```
┌──────────────────────────────────────────────────┐
│ ◀ ▶ ⟳  🔒 url........................  💬5.6万 ⚡│  ← 顶栏 44px：导航 + URL + token 徽章
├──┬─────────┬─────────────────────────────────────┤
│🏠│         │  ╭───────────────────────────────╮   │
│💬│  面板    │  │                               │   │
│🪟│ (280px, │  │      AI 页面（WebContentsView）│   │
│🔌│ 可折叠) │  │      圆角 12px，四周 10px 边距  │   │
│📋│         │  │                               │   │
│  │         │  ╰───────────────────────────────╯   │
│⚙️│         │        卡片外背景 #f7f7f8            │
│📁│         │                                     │
└──┴─────────┴─────────────────────────────────────┘
```

- **图标栏（rail，52px，浅色）**：🏠 平台主页 / 💬 会话 / 🪟 窗口 / 🔌 MCP / 📋 任务；底部：⚙️ 设置、📁 项目。点击展开对应面板，再点或点别的切换。
- **顶栏**：后退/前进/刷新 + URL 输入 + 主页按钮 + 单个 token 徽章（💬 + 当前会话值，点击展开「项目」面板的用量区）。**现有 5 个 emoji token 坨删除**，详细数据进面板。
- **主题**：浅色（背景 #f7f7f8、面板 #fff、边框 #e5e5ea、文字 #0d0d0d/#6e6e80），对标 ChatGPT 桌面版观感。platform-select 页同步浅色化。
- **面板内容**：会话=会话列表；窗口=窗口管理；MCP=MCP 管理；任务=当前命令/执行结果/历史记录；设置=现有设置项；项目=项目目录+初始化+生成说明+催促继续+用量五项+压缩/自动压缩。
- **overlay 瘦身**：删除主面板、fab 悬浮球、窗口管理/MCP/设置三个弹窗、首启对话框（项目面板空态承接引导）。保留：工具执行遮罩、toast、retry 倒计时。

## 关键架构决策（裁决记录）

1. **设置存储迁移**：设置项（retry/延迟/自动压缩等 ~14 个）从 AI 页面 localStorage 迁到主进程 `userData/settings.json`，读写走 IPC。**例外**：deepseek hook 跑在页面主世界，读 `cuckoo-xhr-idle-timeout` 等 localStorage 键——bridge preload init 时把 hook 需要的键从主进程设置**镜像**回页面 localStorage，hook 代码不动。
2. **任务状态/历史上移**：`displayCommand/displayResult` 不再写页面 DOM，改为 `electronAPI.reportToolActivity(...)` → 主进程按窗口暂存（内存 Map，等价现状——刷新即丢）→ 转发 shell 任务面板。历史记录同理迁到主进程内存。
3. **面板展开联动布局**：shell 点击图标 → 更新自身 UI + `shellAPI.setPanelOpen(id|null)` IPC → entry.ts 重算 view bounds。
4. **沉浸式交流按钮删除**：面板移出页面后页面本来就干净，该功能失去意义。快捷键 Ctrl+Shift+C / Esc 改为在 shell 切换侧栏折叠。
5. **首页模式（home-mode）删除**：platform-select 页上不再有注入 UI，自然无需 home-mode 特判。

## Global Constraints

- 运行时行为约束不变：AI 页面内**不新增**持久注入 UI；hook 主世界代码不改。
- 元素 id 契约仅限现存测试，面板迁移后旧 overlay 测试相应删除/迁移。
- 每任务门禁：`npm test`、`npm run typecheck`、`npm run lint` 全绿。
- 浅色主题但不颠覆交互逻辑：所有 IPC 通道复用现有（`src/app/ipc/`），新增通道按现有模式注册。
- 窗口 bounds 持久化（profile.bounds）现有逻辑不动。

---

### Task 1: 主进程设置存储 + 读取链路改造

**Files:**
- Create: `src/app/settings-store.ts`（userData/settings.json 读写、默认值、reset）
- Modify: `src/app/ipc/index.ts`（注册 `settings-get` / `settings-set` / `settings-reset`）
- Modify: `src/bridge/api.ts` + `api-types.ts`（electronAPI 增加 getSettings/saveSettings/resetSettings）
- Modify: `src/overlay/storage.ts` 及读取方（token-counter/auto-compact/retry/watchdog/settings 面板逻辑）：设置读取改异步 `await window.electronAPI.getSettings()`；localStorage 只保留 fab 位置等纯 UI 态
- Modify: `src/bridge/entry.ts`（init 时把 hook 需要的键镜像写回页面 localStorage）

**Interfaces:**
- Produces: `electronAPI.getSettings(): Promise<Settings>`；`Settings` 类型含全部 14 项（retryEnabled, retryDelayMin/Max, retryCount, retry429Delay/Count, retryPrompt, xhrIdleTimeout, watchdogPrompt, watchdogCount, sendDelayMin/Max, attachDelayMin/Max, autoCompactEnabled, autoCompactThreshold）。

- [ ] Step 1: 失败测试 `test/app/settings-store.test.js`：读写、坏 JSON 回退默认、reset、未知键忽略。
- [ ] Step 2: 跑测试确认红。
- [ ] Step 3: 实现 settings-store + IPC + bridge 读取改造 + hook 镜像。
- [ ] Step 4: 全量门禁绿。
- [ ] Step 5: Commit: `refactor: move overlay settings to main-process store`

### Task 2: shell 骨架改版（浅色主题 + 图标栏 + 顶栏 + 圆角卡片）

**Files:**
- Modify: `src/ui/shell.html` / `shell.css` / `shell.js`（重写为新布局）
- Modify: `src/app/entry.ts:129-136`（布局计算：左 rail 52 + 面板 280×开关 + 卡片边距 10；`view.setBorderRadius(12)`）
- Modify: `src/app/ipc/shell.ts`（新增 `shell-panel-state` 通道）
- Modify: `src/app/shell-preload.ts`（透传 setPanelOpen）
- Test: `test/ui/shell-layout.test.js`（happy-dom：图标栏渲染、面板展开/收起状态切换、token 徽章更新）

- [ ] Step 1: 失败测试（面板切换状态机、token 徽章文本更新）。
- [ ] Step 2: 跑红。
- [ ] Step 3: 实现。面板先放空容器占位。bounds 计算：x = 52 + (panelOpen ? 280 : 0) + 10，y = 44 + 10，宽高相应缩减。
- [ ] Step 4: 门禁绿 + `npm start` 目检骨架。
- [ ] Step 5: Commit: `feat: shell skeleton — icon rail, topbar, rounded browser card`

### Task 3: 会话 + 窗口面板迁入 shell

**Files:**
- Create: `src/ui/panels.js`（面板框架：图标点击路由、面板容器渲染）
- Modify: `src/ui/shell.js`、`shell.html`（会话列表、窗口列表 HTML/逻辑）
- Modify: `src/app/shell-preload.ts`（透传 listSessions/navigateSession/listProfiles/openProfileWindow/setProfileAutoOpen/deleteProfileWindow/createProfileWindow）
- Test: `test/ui/panels-session-window.test.js`

- [ ] Step 1-5: TDD 循环；渲染复用 overlay 的 h() 思路（shell 是普通页面，可直接在 shell.html 写结构 + JS 填数据，不必引 dom.ts）。Commit: `feat: move session and window panels into shell sidebar`

### Task 4: MCP 面板迁入 shell

**Files:** Modify: `src/ui/`（mcp 面板）、`shell-preload.ts`（MCP IPC 透传）、Test: `test/ui/panels-mcp.test.js`
- [ ] TDD；功能对齐现 mcp-manager（列表 + JSON 编辑 + 保存 + 启停）。Commit: `feat: move MCP panel into shell sidebar`

### Task 5: 设置面板迁入 shell（接 Task 1 的设置 IPC）

**Files:** Modify: `src/ui/`（settings 面板）、Test: `test/ui/panels-settings.test.js`
- [ ] TDD；全部设置项读写走 getSettings/saveSettings；恢复默认走 settings-reset。Commit: `feat: move settings panel into shell sidebar`

### Task 6: 项目/用量面板 + token 徽章联动

**Files:** Modify: `src/ui/`（project 面板）、`shell-preload.ts`（initProject/updateProjectDir/refreshSkills/compact 相关透传；compact 现状是经页面 sendToChat——需新增 relay：shell→main→AI view→preload 发送，参考现有 executeTool 转发路径）
- Modify: `src/overlay/token-counter.ts`（数据照报，UI 部分删除）
- Test: `test/ui/panels-project.test.js`
- [ ] TDD。含：项目目录显示/修改、初始化项目、生成说明、催促继续、token 五项明细、压缩+自动压缩设置。Commit: `feat: project and usage panel in shell sidebar`

### Task 7: 任务面板（命令预览/结果/历史上移）

**Files:**
- Modify: `src/bridge/api.ts` + `api-types.ts`（`reportToolActivity(entry)`）
- Modify: `src/app/ipc/renderer.ts`（接收→按窗口存内存历史（上限 50）→转发 shell）
- Modify: `src/bridge/loop/executor.ts`（displayCommand/displayResult/addHistory 改走 reportToolActivity）
- Modify: `src/ui/`（任务面板：当前命令、结果、历史列表、清空）
- Test: `test/ui/panels-tasks.test.js`、`test/bridge/loop/executor.test.js` 同步

- [ ] TDD。Commit: `feat: move tool activity and history into shell task panel`

### Task 8: overlay 瘦身（删除面板/fab/弹窗/首页模式）

**Files:**
- Modify: `src/overlay/template/overlay.html|css`（只剩 mask/toast/retry-countdown）
- Delete: `src/overlay/panels/`（window-manager/mcp-manager/settings）、`fab.ts`、`session-list.ts`、`project-dir.ts`（逻辑已迁走）
- Modify: `src/overlay/panel.ts`、`events.ts`、`auto-compact.ts`、`retry-countdown.ts`（删除迁移走的绑定；updateHomeMode/forceShowOverlay 删除）
- Test: 旧面板测试删除，template.test.js 契约更新
- [ ] TDD（先改测试契约再删代码）。Commit: `refactor: strip overlay to transient in-page elements only`

### Task 9: platform-select 浅色主题统一

**Files:** Modify: `src/ui/platform-select.html/css/js`
- [ ] 视觉对齐 shell 浅色体系；功能不变。Commit: `feat: light theme for platform select page`

### Task 10: 收尾回归（快捷键、文档、README）

**Files:** Modify: `src/overlay/events.ts` 或 shell.js（Ctrl+Shift+C/Esc → 折叠侧栏）、`README.md`、`docs/architecture.md`（界面结构描述更新）
- [ ] 全量门禁 + `npm start` 完整冒烟（逐面板操作一遍）。Commit: `docs: update architecture for shell-native UI`

## Review Focus

1. **settings 迁移后旧用户设置丢失**：首启从页面 localStorage 一次性迁移到 settings.json（Task 1 实现迁移逻辑 + 测试）。
2. **面板展开时 view bounds 重算竞态**：resize 事件与面板开关叠加，bounds 计算必须纯函数化（输入：窗口尺寸+面板状态）。
3. **compact/催促继续的 shell→页面 relay 链路**：sendToChat 依赖页面 DOM 状态，relay 失败要有 toast 反馈。
4. **setBorderRadius 裁切区仍捕获点击**（Electron 文档注记）：圆角外 10px 边距区点击落在 shell，不落在 AI 页面——确认无功能依赖该区域点击。
5. **删除功能的用户触点**：fab 拖动位置、overlay 快捷键、沉浸式交流被删，README 的快捷键说明同步更新。

# Cuckoo Code 前端重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入运行时框架的前提下，把 overlay/ui 前端重构为模块化、类型安全、无 XSS 隐患、视觉统一的代码，并补齐可测真实 DOM 的测试能力。

**Architecture:** 保持「HTML/CSS 模板真源 + preload 注入」的注入机制不变（覆盖层运行在第三方 AI 页面的隔离世界，框架注入有 CSP/样式污染风险，故坚持 vanilla）。新增一个 ~60 行的安全 DOM 助手 `h()` 取代所有 innerHTML 字符串拼接；按职责拆分 `events.ts` 巨型编排；切断 bridge→overlay 的反向 DOM 耦合；最后做信息层级与视觉改版。

**Tech Stack:** TypeScript + vanilla DOM + Vitest（新增 happy-dom 环境做真实 DOM 测试）。

**Spec:** 本计划即 spec。背景结论来自对 `src/overlay/`（2088 行 TS + 228 行 HTML + 342 行 CSS）、`src/ui/`、`src/bridge/` 的调查。

## Global Constraints

- 覆盖层所有代码运行在**第三方宿主页面**（DeepSeek/Claude/ChatGPT）的 preload 隔离世界中：禁止 `eval`/`new Function`、禁止引入会向宿主全局泄露的库、所有样式保持 `cuckoo-` 前缀、`z-index: 2147483647` 体系不变。
- 不新增任何 runtime dependency（devDependency 允许新增 happy-dom）。
- 模板真源仍是 `src/overlay/template/*.html|css`；改模板后必须重新生成 `template.generated.ts`（`node scripts/build-hooks.mjs`）。
- 测试沿用项目约定：`test/**/*.test.js`（JS 文件 + `node:assert`），命令 `npm test`（vitest run）。
- 每次改动后必须通过：`npm test`、`npm run typecheck`、`npm run lint`。
- 用户可见的 ID 契约（`cuckoo-*` 元素 id）被 `bridge/loop/executor.ts`、`retry.ts`、`test/overlay/template.test.js` 依赖，重构中改名必须同步这三处。

## Review Focus

1. **宿主页面 CSS 回流污染**：模板改版后新选择器若漏加 `cuckoo-` 前缀会污染宿主页面 —— Task 10 增加模板 lint 测试断言所有类名带前缀。
2. **profile/server 名 XSS**：现有 `window-manager.ts`/`mcp-manager.ts` 拼接未转义 —— Task 5 的测试用含 `<img onerror>` 的名字渲染并断言无脚本注入。
3. **localStorage 键名漂移**：~20 个 `cuckoo-*` 键散落各处，集中化时漏改会导致设置丢失 —— Task 8 测试断言旧键值可读取（迁移或别名）。
4. **bridge 反向 DOM 依赖**：`retry.ts` 动态创建 `#cuckoo-retry-countdown`，`executor.ts` 直接写 `cuckoo-cmd-preview` —— Task 9 用接口替换后保留契约测试。
5. **列表事件泄漏**：现有代码每次 render 后重复 `addEventListener` —— Task 5 改为事件委托并测试重复渲染不产生重复回调。

---

### Task 1: 引入 happy-dom 测试环境

**Files:**
- Modify: `vitest.config.mjs`
- Modify: `package.json`（devDependencies 加 happy-dom）
- Create: `test/helpers/dom.ts`（`setupDom(html?)` 返回 document，测试间隔离）

**Interfaces:**
- Produces: `setupDom(html?: string): { document: Document; cleanup(): void }` —— 后续所有 overlay 测试使用。

- [ ] **Step 1:** 写失败测试 `test/overlay/dom-env.test.js`：`setupDom('<button id="x">')` 后 `document.getElementById('x')` 非空，`cleanup()` 后全局 document 被还原。
- [ ] **Step 2:** 运行 `npx vitest run test/overlay/dom-env.test.js`，预期失败（happy-dom 未装）。
- [ ] **Step 3:** `npm i -D happy-dom`；vitest.config.mjs 增加 `environmentMatchGlobs: [['test/overlay/**', 'happy-dom'], ['test/ui/**', 'happy-dom']]`（其余保持 node）；实现 `test/helpers/dom.ts`。
- [ ] **Step 4:** 测试通过；`npm test` 全绿（确认现有 node 测试不受影响）。
- [ ] **Step 5:** Commit: `test: add happy-dom environment for overlay tests`

### Task 2: 死代码清理

**Files:**
- Modify: `src/overlay/panel.ts`（删 `handleExecute`/`handleIgnore` 空壳、`startOverlayWatcher` 空函数、`currentCommand`/`isExecuting`/`setTaskStatus`/`flashBadge` 若确认无调用）
- Modify: `src/bridge/entry.ts:137`（移除 `startOverlayWatcher()` 调用）

**Interfaces:**
- Consumes: 无。**先做验证**：`Grep` 全库确认上述符号无引用后才删除；有引用的保留并在计划偏差中记录。

- [ ] **Step 1:** 逐个 grep 上述符号，列出确认可删清单。
- [ ] **Step 2:** 删除 + 跑 `npm test && npm run typecheck` 全绿。
- [ ] **Step 3:** Commit: `refactor: remove dead overlay code`

### Task 3: 类型化 electronAPI 与 DOM 边界

**Files:**
- Create: `src/bridge/api-types.ts` —— `export interface ElectronAPI { executeCommand(...): Promise<...>; ... }`，30 个方法全部按 `src/bridge/api.ts` 实际签名声明；`declare global { interface Window { electronAPI: ElectronAPI } }`
- Modify: `src/bridge/api.ts`（让暴露对象满足该接口，编译期校验）
- Modify: `src/overlay/*.ts` —— 所有 `(window as any).electronAPI` 改为 `window.electronAPI`；`(el as any).dataset` 改为 `HTMLElement` 收窄

**Interfaces:**
- Produces: `ElectronAPI` 接口 + 全局 Window 声明，后续任务全部使用。

- [ ] **Step 1:** 写编译期测试：在 `test/bridge/api-types.test.js` 中断言 `window.electronAPI` 上 30 个方法名存在（从接口反射不现实，改为列出方法名数组与运行时对象 key 对比）。
- [ ] **Step 2:** 运行失败（类型文件不存在）。
- [ ] **Step 3:** 实现 `api-types.ts`；逐文件替换 `(window as any).electronAPI`；typecheck 报错处补类型。
- [ ] **Step 4:** `npm run typecheck && npm test` 全绿。
- [ ] **Step 5:** Commit: `refactor: type electronAPI bridge surface`

### Task 4: 安全 DOM 助手 `h()`

**Files:**
- Create: `src/overlay/dom.ts` —— `h(tag, props?, ...children)`（createElement 封装：`class`、`dataset`、`on*` 事件、`style` 对象；children 只接受 Node/string，string 走 textNode 天然转义）、`clearChildren(el)`、`replaceChildrenOf(el, ...nodes)`
- Test: `test/overlay/dom.test.js`

**Interfaces:**
- Produces: `h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: {...}, ...children: (Node|string)[]): HTMLElementTagNameMap[K]`。

- [ ] **Step 1:** 写失败测试：`h('div', {class:'a', dataset:{id:'1'}, onClick:fn}, 'text')` 的 className/dataset/事件/textContent；字符串子节点含 `<b>` 时断言以文本呈现（不解析 HTML）。
- [ ] **Step 2:** 运行失败。
- [ ] **Step 3:** 实现 `dom.ts`（目标 ≤80 行，不做虚拟 DOM、不做 diff）。
- [ ] **Step 4:** 测试通过 + 全量 `npm test`。
- [ ] **Step 5:** Commit: `feat: add safe DOM builder for overlay`

### Task 5: 动态渲染改造（消灭 innerHTML 拼接 + 事件委托）

**Files:**
- Modify: `src/overlay/session-list.ts:34-39`、`src/overlay/panels/window-manager.ts:29-44`、`src/overlay/panels/mcp-manager.ts:46-51`、`src/overlay/panel.ts:279-287`（历史记录渲染）
- Test: `test/overlay/*.test.js` 对应文件

**Interfaces:**
- Consumes: Task 4 的 `h()`、`replaceChildrenOf()`。
- Produces: 每个列表容器只绑一次委托监听（`data-action` 属性分发），render 函数纯渲染。

- [ ] **Step 1:** 各列表先补失败测试：含 `<img src=x onerror=alert(1)>` 的 profile/server/session 名渲染后 `container.querySelector('img') === null`；同一数据 render 两次后点击条目只触发一次回调。
- [ ] **Step 2:** 运行失败（现状 innerHTML + 重复绑定）。
- [ ] **Step 3:** 用 `h()` 重写四处渲染；事件改为容器级委托；保留既有 DOM 结构与 class 名（template.test.js 的契约不变）。
- [ ] **Step 4:** 测试通过 + 全量验证。
- [ ] **Step 5:** Commit: `refactor: replace innerHTML templating with safe DOM builder`

### Task 6: 样式归一（消灭内联样式）

**Files:**
- Modify: `src/overlay/panel.ts:116-167`（`showConfirmDialog` 的 ~30 行 inline CSS → overlay.css 新增 `.cuckoo-confirm-*`）
- Modify: `src/overlay/template/overlay.html`（去掉 `:116` `style="font-size:11px;"`、`:182` `style="width:160px;"` 等全部 inline style）
- Modify: `src/overlay/template/overlay.css`、`src/overlay/panels/mcp-manager.ts:48-49`

- [ ] **Step 1:** 写测试 `test/overlay/template.test.js` 增量：断言 OVERLAY_HTML 中不存在 `style="`（生成物层面卡死回归）。
- [ ] **Step 2:** 运行失败。
- [ ] **Step 3:** 迁移样式到 CSS 文件（复用 `--ck-*` 变量，不新增色值）；重新生成模板。
- [ ] **Step 4:** 测试通过；手动 `npm start` 目检确认弹窗/MCP 面板外观无回退。
- [ ] **Step 5:** Commit: `refactor: move inline styles into overlay stylesheet`

### Task 7: 拆分 events.ts 巨型编排

**Files:**
- Create: `src/overlay/token-counter.ts`（token 统计 + localStorage 持久化，~150 行从 events.ts 迁出）
- Create: `src/overlay/auto-compact.ts`（自动压缩逻辑，~60 行迁出）
- Modify: `src/overlay/events.ts`（530 → 目标 <200 行：`bindEvents()` 按面板拆为 `bindMainPanel()/bindSettings()/bindMcp()/bindWindowManager()`，或下沉到各 panels/*.ts 自导出 bind 函数，events.ts 只编排）
- Test: `test/overlay/token-counter.test.js`、`auto-compact.test.js`

**Interfaces:**
- Produces: `initTokenCounter(deps): { refresh(): Promise<void> }`、`initAutoCompact(deps): void`，events.ts 以依赖注入方式组装。

- [ ] **Step 1:** 为 token 统计写失败测试（localStorage 读写、阈值判断、UI 更新调用）。
- [ ] **Step 2:** 失败运行。
- [ ] **Step 3:** 迁移代码为纯函数+注入 deps；events.ts 瘦身。
- [ ] **Step 4:** 测试通过 + 全量验证。
- [ ] **Step 5:** Commit: `refactor: split events.ts into token-counter and auto-compact modules`

### Task 8: localStorage 键集中管理

**Files:**
- Create: `src/overlay/storage.ts` —— `export const KEYS = { fabPos: 'cuckoo-fab-pos', retryEnabled: 'cuckoo-retry-enabled', ... }`（全量收集现有 ~20 个键，grep `localStorage` 得清单）+ `readKey/writeKey` 带 JSON 序列化的窄封装
- Modify: 所有直写 localStorage 字符串的 overlay/bridge 文件
- Test: `test/overlay/storage.test.js`

- [ ] **Step 1:** 失败测试：`KEYS` 中无重复值；`readKey` 对坏 JSON 返回默认值；`settings.ts` 的 reset 清单与 `KEYS` 自动同步（从 KEYS 派生，消除手工双份维护）。
- [ ] **Step 2:** 失败运行。
- [ ] **Step 3:** 实现 + 全库替换；键名保持不变（不做迁移，避免丢设置）。
- [ ] **Step 4:** 测试通过 + 全量验证。
- [ ] **Step 5:** Commit: `refactor: centralize localStorage keys`

### Task 9: 切断 bridge→overlay 反向 DOM 耦合

**Files:**
- Create: `src/overlay/retry-countdown.ts` —— 倒计时浮层 DOM（含模板 CSS）与 `showRetryCountdown(sec, onCancel)/hideRetryCountdown()`
- Modify: `src/bridge/loop/retry.ts:85-126`（不再 innerHTML 创建 `#cuckoo-retry-countdown`，改为 import overlay 模块）
- Modify: `src/bridge/loop/executor.ts:14-71`（不直接写 DOM，改为调用 `panel.ts` 已有 `displayCommand()` 及新增 `displayResult()`）
- Test: `test/overlay/retry-countdown.test.js`

**Interfaces:**
- Produces: `displayResult(status: 'success'|'error', output: string): void`（panel.ts 导出，executor.ts 消费）。

- [ ] **Step 1:** 失败测试：`showRetryCountdown(5, cb)` 渲染倒计时元素、点击取消触发 cb、`hideRetryCountdown` 移除；`displayResult('error', 'x')` 更新对应元素 class/text。
- [ ] **Step 2:** 失败运行。
- [ ] **Step 3:** 实现 overlay 侧模块；改造 retry.ts/executor.ts 调用方。
- [ ] **Step 4:** 测试通过 + `npm start` 手测一次真实工具执行链路（执行结果回显、重试倒计时出现/消失）。
- [ ] **Step 5:** Commit: `refactor: route bridge UI updates through overlay APIs`

### Task 10: 主面板信息层级与视觉改版

**Files:**
- Modify: `src/overlay/template/overlay.html`、`src/overlay/template/overlay.css`
- Modify: `scripts/build-hooks.mjs`（如需多模板文件）
- Test: `test/overlay/template.test.js`

**改版要点（设计决策，执行时不再发散）：**
- 状态区合并：项目目录 + token 统计合并为一个「状态卡片」，token 数字与压缩按钮同行；自动压缩设置折叠进 `<details>`。
- 操作区分组：主操作（初始化项目）独占一行 primary；次操作（窗口管理 / MCP / 设置）三个 secondary 一行；高级操作（生成说明 / 沉浸式 / 卡住了）收进 `<details>`「更多操作」。
- 文案去 emoji：「🔄 修改」→「修改」、「🔄 刷新」→「刷新」；「卡住了?点我」→「催促继续」。
- CSS：扩展设计 token（`--ck-gap-sm/md`、`--ck-radius-sm/md`、字号阶梯），替换散落的硬编码间距/字号；新增模板测试断言所有类名带 `cuckoo-` 前缀（防宿主污染）。

- [ ] **Step 1:** 失败测试：OVERLAY_HTML 中所有 `class="` 值均匹配 `cuckoo-` 前缀；无 emoji 字符（`🔄`）；`details` 元素存在。
- [ ] **Step 2:** 失败运行。
- [ ] **Step 3:** 重写模板与 CSS；重新生成 `template.generated.ts`；同步 `home-mode` 的 `:has()` 规则到新结构。
- [ ] **Step 4:** 测试通过 + `npm start` 目检主面板/首页模式/各弹窗。
- [ ] **Step 5:** Commit: `feat: redesign overlay panel information hierarchy`

### Task 11: 壳页面与平台选择页轻量整理

**Files:**
- Modify: `src/ui/shell.html`（内联 `<style>` → `src/ui/shell.css`，内联 `<script>` → `src/ui/shell.js`，build files 清单同步）
- Modify: `src/ui/platform-select.html`（同上拆分）
- Modify: `package.json` build.files 增加 `src/ui/*.css`、`src/ui/*.js`

- [ ] **Step 1:** 纯机械拆分，不改逻辑；加载方式保持 `loadFile`。
- [ ] **Step 2:** `npm start` 目检两个页面功能（地址栏导航、平台选择、导入 Provider）。
- [ ] **Step 3:** Commit: `refactor: extract inline assets from shell pages`

### Task 12: 构建链加固

**Files:**
- Modify: `.gitignore`（忽略 `src/overlay/template.generated.ts`）
- Modify: `scripts/build-hooks.mjs:66-80`（生成逻辑不变，确保 `npm run compile` 任何路径都会先生成）
- Modify: CI workflow（确认 compile 先于 test 或 test 前自动生成）
- Bash: `git rm --cached src/overlay/template.generated.ts`

- [ ] **Step 1:** 生成物从 git 移除并加入 .gitignore。
- [ ] **Step 2:** 删除生成物后跑 `npm run compile && npm test` 全绿（证明生成链自洽）。
- [ ] **Step 3:** Commit: `build: stop tracking generated overlay template`

---

## 备选方案 B：Preact 组件化（未选，仅备查）

引入 `preact` + 预编译 JSX（esbuild 已有，可打包进 preload 产物；必须禁用 htm 运行时，避免宿主页面 CSP 的 `unsafe-eval` 问题）。收益：组件模型、状态驱动 UI 天然解决重复绑定/innerHTML 问题。代价：新增 runtime 依赖与 preload 打包环节、注入宿主页面的风险面变大、全部 overlay 代码重写。Task 1-3 与本计划相同，Task 4 起替换为组件树迁移。**仅当团队接受框架长期维护成本时选择。**

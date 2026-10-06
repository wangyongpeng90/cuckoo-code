1: # Cuckoo 插件系统 · 设计规范
2: 
3: > 版本：v1.1（2026-10-05）
>
> **命名说明**：类型正式名为 `Plugin*`（`PluginContext` / `PluginFn` / `PluginModule` / `PluginScope`）。
> 历史 `Dsh*` 命名保留为**兼容别名**（`DshContext` === `PluginContext`），便于生态迁移。
4: > 定位：**Cuckoo 自己的插件体系**。接口规范与能力**参考 DSH（DeepSeek Harness）**，但**不是兼容层** —— 这是 Cuckoo 原生的插件能力。
5: > 目标：让第三方（含 DSH 生态）插件能以**清晰、稳定、可测试**的方式扩展 Cuckoo。
6: 
7: ---
8: 
9: ## 一、总览
10: 
11: Cuckoo 的插件系统分两层：
12: 
13: | 层 | 目录 | 职责 |
14: |----|------|------|
15: | **插件管理** | `src/plugins/*.ts`（原版） | 扫描、安装、卸载、市场、启停 |
16: | **插件运行时** | `src/plugins/runtime/`（新增） | 加载、上下文、事件、服务、UI、工具、生命周期 |
17: 
18: **两层职责独立**：管理负责"装进来"，运行时负责"跑起来"。原版管理逻辑**零改动**（只多扫 `dsh/` `ui/` 两条目录）。
19: 
20: ---
21: 
22: ## 二、插件形态规范
23: 
24: Cuckoo 插件是**一个目录**，至少包含：
25: 
26: ```
27: my-plugin/
28: ├── plugin.json        # 清单（必需）
29: ├── dsh/               # 宿主侧插件（可选，Node/主进程能力）
30: │   └── index.js
31: ├── ui/                # UI 插件（可选，AI 页面内注入）
32: │   └── index.js
33: ├── assets/            # 插件资源（可选，模型/图片/脚本）
34: └── cordis.patch.yml   # 配置声明（可选）
35: ```
36: 
37: ### plugin.json（清单）
38: 
39: ```json
40: {
41:   "id": "my-plugin",
42:   "name": "我的插件",
43:   "version": "1.0.0",
44:   "description": "一句话说明",
45:   "author": "you",
46:   "minAppVersion": "0.8.8"
47: }
48: ```
49: 
50: - `id`：唯一标识，同时是**目录名**（`listInstalledPlugins` 按目录名 + `id` 匹配）
51: - `name`：显示名（可中文）
52: - **id 与目录名必须一致**（否则 `plugin-read-asset` 找不到）
53: 
54: ---
55: 
56: ## 三、入口契约（三种形态）
57: 
58: 插件入口文件（`dsh/index.js` 或 `ui/index.js`）导出：
59: 
60: ### 形态 1：函数式（最简）
61: 
62: ```js
63: export default function apply(ctx, config) {
64:   ctx.log('hello')
65: }
66: ```
67: 
68: ### 形态 2：对象式
69: 
70: ```js
71: export const name = 'my-plugin'
72: export const inject = ['agents']
73: export function apply(ctx, config) {
74:   // ...
75: }
76: ```
77: 
78: ### 形态 3：类式（有状态插件，继承 Service）
79: 
80: ```js
81: import { Service } from 'cuckoo:plugin'
82: 
83: export default class MyPlugin extends Service {
84:   constructor(ctx, config) {
85:     super(ctx, 'my-plugin')
86:   }
87:   start() { /* 挂载逻辑 */ }
88:   stop()  { /* 清理逻辑 */ }
89: }
90: ```
91: 
92: **共同点**：
93: - `name`（可选，缺省用目录名）
94: - `inject`（可选，声明依赖的服务名）
95: - `apply(ctx, config)`（必需，除了类式）
96: 
97: ---
98: 
99: ## 四、ctx API 参考
100: 
101: ### 4.1 基础
102: 
103: | API | 说明 |
104: |-----|------|
105: | `ctx.name` | 插件名（只读） |
106: | `ctx.log(...args)` | 带插件前缀的日志 |
107: 
108: ### 4.2 服务（消费）
109: 
110: | API | 说明 |
111: |-----|------|
112: | `ctx.agents` | `.get(sessionId?)` / `.current()` / `.list()` |
113: | `ctx.tools` | `.list()` / `.register(def)` |
114: | `ctx.sessions` | `.current()` / `.list()` / `.get(id)` |
115: | `ctx.settings` | `.get(k)` / `.set(k, v)` |
116: 
117: ### 4.3 事件（5 种派发）
118: 
119: | API | 说明 |
120: |-----|------|
121: | `ctx.on(ev, fn)` | 监听（返回 disposer） |
122: | `ctx.once(ev, fn)` | 一次性监听 |
123: | `ctx.off(ev, fn)` | 取消监听 |
124: | `ctx.emit(ev, ...args)` | 广播，不等返回 |
125: | `ctx.parallel(ev, ...args)` | 并行，返回结果数组 |
126: | `ctx.serial(ev, ...args)` | 串行，返回最后一个结果 |
127: | `ctx.bail(ev, ...args)` | 短路：第一个非 undefined 结果即停 |
128: | `ctx.waterfall(ev, value, ...args)` | 瀑布：每个监听器加工 value |
129: 
130: ### 4.4 可逆副作用（核心）
131: 
132: | API | 说明 |
133: |-----|------|
134: | `ctx.effect(fn)` | 注册副作用；`fn` 可返回 cleanup，卸载时自动调用 |
135: | `ctx.scope()` | 创建子作用域，独立生命周期 |
136: 
137: ```js
138: ctx.effect(() => {
139:   const timer = setInterval(tick, 1000)
140:   return () => clearInterval(timer)   // 卸载时清理
141: })
142: ```
143: 
144: ### 4.5 服务提供 / 注入
145: 
146: | API | 说明 |
147: |-----|------|
148: | `ctx.provide(name, impl)` | 向本上下文注册服务 |
149: | `ctx.get(name)` | 取服务 |
150: | `ctx.inject(names, cb)` | 依赖就绪时回调 |
151: 
152: ```js
153: // 提供
154: ctx.provide('myService', { hello: () => 'hi' })
155: 
156: // 注入
157: export const inject = ['myService']
158: export function apply(ctx) {
159:   ctx.myService.hello()
160: }
161: ```
162: 
163: ### 4.6 UI（仅 ui 类插件）
164: 
165: > ⚠️ **安全提示**：`mount / css / injectScript / injectMainWorld` 都作用于 **AI 页面**（deepseek.com）。
166: > 往第三方页面注入内容**可能被风控检测**，**不推荐**。
167: > **UI 插件请优先用 `ctx.ui.overlay`**（下一节）——它住在 Cuckoo 自己的视图里，**不碰 AI 页面**。
168: 
169: | API | 说明 | 位置 |
170: |-----|------|------|
171: | `ctx.ui.mount(el)` | 挂载 DOM | AI 页面 |
172: | `ctx.ui.root()` | 取根容器 | AI 页面 |
173: | `ctx.ui.css(text)` | 注入样式 | AI 页面 |
174: | `ctx.ui.onResize(cb)` | 监听尺寸变化 | AI 页面 |
175: | `ctx.ui.injectScript(text)` | 注入脚本（页内） | AI 页面 |
176: | `ctx.ui.injectScriptSrc(src)` | 注入外部脚本 | AI 页面 |
177: | `ctx.ui.injectMainWorld(code)` | 注入主世界（**谨慎**） | AI 页面主世界 |
178: 
179: > **关键**：`contextIsolation: true` 下，preload 与主世界隔离。
180: > 需要在 AI 页面主世界运行的代码（如 `window.fetch` 拦截、DOM 操作），
181: > 必须用 `ctx.ui.injectMainWorld`——但**它会污染 AI 页面，谨慎使用**。
182: 
183: ### 4.7 覆盖层（推荐给 UI 插件）
184: 
185: Cuckoo 提供一个**透明、置顶、浮在 AI 页面之上**的覆盖层视图。
186: 插件 UI（桌宠、悬浮窗、面板）**应该住这里**，而不是注入 AI 页面。
187: 
188: | API | 说明 |
189: |-----|------|
190: | `ctx.ui.overlay.init()` | 初始化/创建覆盖层（懒加载） |
191: | `ctx.ui.overlay.eval(code)` | 在覆盖层内执行 JS，返回结果 |
192: | `ctx.ui.overlay.html(html)` | 设置覆盖层 HTML |
193: 
194: ```js
195: export function apply(ctx) {
196:   ctx.ui.overlay.init().then(() => {
197:     ctx.ui.overlay.eval(`document.body.innerHTML = '<div id="my-widget">hello</div>';`);
198:   });
199: }
200: ```
201: 
202: **覆盖层里的 preload 提供 `window.cuckooOverlay`**：
203: 
204: | API | 说明 |
205: |-----|------|
206: | `cuckooOverlay.readAsset(pluginId, relPath)` | 读插件资源（宿主读文件，不经网络） |
207: | `cuckooOverlay.send(channel, data)` | 向宿主发消息 |
208: | `cuckooOverlay.onMessage(cb)` | 订阅宿主消息 |
209: | `cuckooOverlay.debugLog(msg)` | 写插件调试日志 |
210: 
211: > **注意**：覆盖层是独立页面，**没有网络、没有 base URL**。
212: > 需要资源时用 `cuckooOverlay.readAsset`（经宿主读取），不要直接 `fetch` 相对路径。
213: > **层叠**：覆盖层 > AI 页面（透明）；bounds 跟随 AI 内容区。
214: 
215: ### 4.7 资源（仅 ui 类插件）
216: 
217: | API | 说明 |
218: |-----|------|
219: | `ctx.assets.read(relPath)` | 读插件目录文件，返回 `Uint8Array` |
220: | `ctx.assets.url(relPath)` | 读文件并返回 blob URL |
221: 
222: 路径**相对插件目录**，例：`ctx.assets.read('assets/pet.js')`。
223: 
224: ### 4.8 token 统计
225: 
226: | API | 说明 |
227: |-----|------|
228: | `ctx.tokens.context()` | 当前上下文 token |
229: | `ctx.tokens.cumulative()` | 对话累计 token |
230: | `ctx.tokens.today()` | 今日累计 token |
231: | `ctx.tokens.windowCumulative()` | 窗口累计 token |
232: | `ctx.tokens.total()` | 系统总累计 token |
233: 
234: ---
235: 
236: ## 五、标准事件清单
237: 
238: | 事件 | 载荷 | 何时触发 |
239: |------|------|---------|
240: | `session/event` | `{ type, text, tokenUsage }` | 会话有持久事实（轮次/消息） |
241: | `agent/assistant-stream` | `{ frame: { think, text, finished } }` | AI 逐字流 |
242: | `agent/turn-end` | `{ text, tokenUsage }` | 一轮结束 |
243: | `agent/task-idle` | `{}` | 任务空闲 |
244: | `tool/call` | `{ code }` | 工具被调用 |
245: | `tool/result` | `{ code, success, output, error }` | 工具返回 |
246: | `agent/error` | `{ ... }` | AI 出错 |
247: 
248: > 兼容说明：事件名**沿用 DSH 的命名习惯**（`域/事件`），便于生态迁移。
249: > Cuckoo 内部事件（`onInterceptedResponse` 等）由 `bridge.ts` 翻译成上述名。
250: 
251: ---
252: 
253: ## 六、生命周期契约
254: 
255: ```
256: 加载 → 解析入口 → 等待 inject 依赖 → apply(ctx, config) → 运行
257:                                                             ↓
258:                                                          卸载
259:                                                             ↓
260:                                             执行所有 effect 的 cleanup（逆序）
261: ```
262: 
263: **约定**：
264: 1. `apply` 里注册的一切（监听、effect、定时器）**必须**通过 `ctx` 的 API 注册，**不要**自己裸写 `setInterval` 不清理
265: 2. `ctx.effect(fn)` 的 `fn` **应返回 cleanup 函数**（除非确实无需清理）
266: 3. `inject` 的服务名若不存在，`apply` 会**推迟**（等依赖就绪）
267:    - **例外**：内置服务（`agents` / `tools` / `sessions` / `settings`）**不等待**，直接视为就绪
268: 4. 卸载时**逆序执行** cleanup（后注册的先清理）
269: 
270: ---
271: 
272: ## 七、错误处理约定
273: 
274: | 场景 | 表现 |
275: |------|------|
276: | 入口语法错误 | `loadPluginSource` 返回 `{ ok: false, error }`，**不抛** |
277: | `apply` 抛异常 | `PluginHost` 捕获，记录到 `diagnose()`，**不影响其他插件** |
278: | 资源读取失败 | `ctx.assets.read` **抛异常**（调用方自行 try/catch） |
279: | `injectMainWorld` 失败 | 静默（写 `plugin-debug.log`） |
280: 
281: **调试**：
282: - `window.electronAPI.pluginDebugLog(msg)` —— 渲染进程 → 主进程写 `plugin-debug.log`
283: - `PluginHost.diagnose()` —— 列出所有加载失败原因
284: 
285: ---
286: 
287: ## 八、完整示例：一个最小 UI 插件
288: 
289: **目录结构**：
290: ```
291: hello-plugin/
292: ├── plugin.json
293: └── ui/
294:     └── index.js
295: ```
296: 
297: **plugin.json**：
298: ```json
299: {
300:   "id": "hello-plugin",
301:   "name": "你好插件",
302:   "version": "1.0.0"
303: }
304: ```
305: 
306: **ui/index.js**：
307: ```js
308: export const name = 'hello-plugin'
309: 
310: export function apply(ctx) {
311:   ctx.log('你好插件加载')
312: 
313:   // 挂一个悬浮窗
314:   const el = document.createElement('div')
315:   el.textContent = 'Hello from Cuckoo!'
316:   el.style.cssText = 'position:fixed;right:20px;top:20px;z-index:9999;padding:12px;background:#333;color:#fff;border-radius:8px'
317:   ctx.ui.mount(el)
318: 
319:   // 监听 AI 回复
320:   ctx.on('agent/assistant-stream', (payload) => {
321:     ctx.log('AI 正在说：', payload.frame && payload.frame.text)
322:   })
323: 
324:   // 读 token 统计
325:   const timer = setInterval(() => {
326:     ctx.log('今日 token：', ctx.tokens.today())
327:   }, 5000)
328: 
329:   // 可逆副作用：卸载时清理
330:   ctx.effect(() => () => {
331:     clearInterval(timer)
332:     el.remove()
333:   })
334: }
335: ```
336: 
337: ---
338: 
339: ## 九、扩展点汇总
340: 
341: | 能力 | API | 典型用途 |
342: |------|-----|---------|
343: | 事件监听 | `ctx.on` | 响应 AI 状态变化 |
344: | 服务提供 | `ctx.provide` | 插件间协作 |
345: | UI 挂载 | `ctx.ui.mount` | 悬浮窗、面板 |
346: | 主世界注入 | `ctx.ui.injectMainWorld` | 拦截网络、改页面 |
347: | 资源读取 | `ctx.assets.read` | 加载模型/图片 |
348: | 工具注册 | `ctx.tools.register` | 给 AI 加新工具 |
349: | token 统计 | `ctx.tokens.*` | 显示用量 |
350: | 配置 | `cordis.patch.yml` | 用户可调参数 |
351: 
352: ---
353: 
354: ## 十、参考实现
355: 
356: - **模块源码**：`src/plugins/runtime/`
357: - **运行时说明**：`src/plugins/runtime/README.md`
358: - **参考插件**：鲸鱼娘桌宠（`Cuckoo-Data/home/plugins/whale-girl-pet/`）
359: - **测试**：`test/plugin-system.test.js`
360: 
361: ---
362: 
363: _本规范是 Cuckoo 插件系统的正式文档。新增能力必须同步更新本文档。_
364: 
365: 


### 4.9 本地 HTTP 服务（ctx.webServer）

把插件目录暴露成 URL —— 这是「厚插件」的门槛（如模型/图片/静态页）。

| API | 说明 |
|-----|------|
| ctx.webServer.serve(prefix, dir) | 把插件目录 dir 暴露到 URL 前缀 prefix；返回 base URL |
| ctx.webServer.info() | 取服务基础 URL + 端口 |

```js
export async function apply(ctx) {
  const r = await ctx.webServer.serve('/assets', 'assets');
  // → http://127.0.0.1:<port>/plugins/<id>/assets/*
  ctx.log('资源地址: ' + r.url);
}
```

**特性**：
- 只绑 127.0.0.1（不对外）
- 只允许**已启用插件**
- **路径防穿越**（`..` 拒绝）
- 支持常见 MIME（js/json/png/moc3/wasm/mp3/字体…）
- 跨域头 Access-Control-Allow-Origin: *

### 4.10 Cuckoo 界面挂载（ctx.ui.shell）

把插件 UI **集成进 Cuckoo 壳页面**（不是覆盖层，是「长在里面」）。

| API | 说明 |
|-----|------|
| ctx.ui.shell.addSidebarPanel({ id, title, icon?, html? }) | 侧边栏加一页 |
| ctx.ui.shell.addStatusItem({ id, text, title? }) | 状态栏加一项 |
| ctx.ui.shell.addToolbarButton({ id, label, title? }) | 工具栏加按钮 |

```js
export function apply(ctx) {
  ctx.ui.shell.addStatusItem({ id: 'my-count', text: '0 条', title: '我的插件统计' });
  ctx.ui.shell.addToolbarButton({ id: 'my-btn', label: '✦', title: '我的功能' });
}
```

> **区别**：ctx.ui.shell 是「集成进 Cuckoo」，ctx.ui.overlay 是「浮在 Cuckoo 之上」。
> 改 Cuckoo 自己的界面用 shell；浮层/桌宠用 overlay。


### 4.11 插件配置（用户可改）

插件在 `plugin.json` 里声明 `config` schema，用户可在 Cuckoo「插件」页点 ⚙ 修改。

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "config": {
    "height": { "type": "number", "label": "高度", "default": 180, "min": 80, "max": 400 },
    "talk": { "type": "boolean", "label": "说话动嘴", "default": true },
    "name": { "type": "string", "label": "名字", "default": "鲸鱼娘" }
  }
}
```

**用户值**存在 `~/.cuckoo/plugins-config.json`，`apply(ctx, config)` 时合并进 `config`。

字段类型：`string` / `number` / `boolean`（可选 `label` / `description` / `default` / `min` / `max`）。

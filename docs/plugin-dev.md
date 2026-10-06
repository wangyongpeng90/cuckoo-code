# Cuckoo 插件开发指南

> 本文档面向插件作者，说明如何为 Cuckoo Code 开发插件。
> Cuckoo 拥有**自己的插件体系**，接口规范与能力**参考 DSH（DeepSeek Harness）**——
> 事件机制、服务、生命周期等设计对齐 DSH，API 命名沿用其风格（降低理解与迁移成本）。

## 一、插件是什么

Cuckoo 插件是一个 **GitHub 仓库**（打上 `cuckoo-plugin` topic 即可被插件市场发现），
仓库根目录有一个 `plugin.json` 清单，按约定放置各类扩展。

插件是**分发容器**：它打包现有的扩展机制，不引入新的执行引擎。

## 二、目录约定

```
<插件仓库>/
├── plugin.json          # 清单（唯一必需文件）
├── skills/<name>/SKILL.md   # 技能（对齐 Claude Code）
├── agents/<name>.md         # 子代理
├── rules/<name>.md          # 规则
├── mcp.json                 # MCP 配置
├── providers/<id>.js        # 自定义 AI 平台（可执行，需授权）
├── dsh/<name>.js            # DSH 风格插件（可执行，需授权）  ← 新增
└── ui/<name>.js             # UI 扩展插件（可执行，需授权）  ← 新增
```

**贡献项由目录实际内容派生**，插件不能虚报。

## 三、plugin.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "...",
  "author": "...",
  "minAppVersion": "0.8.8"
}
```

- `id`：必填，小写 kebab-case（字母/数字开头，仅 a-z 0-9 和 -，≤64）
- `name`：必填

## 四、DSH 风格插件（dsh/）

DSH 插件用 **ESM 命名导出**：

```js
// dsh/my-plugin.js
export const name = 'my-plugin'
export const inject = ['agents']   // 声明依赖的服务（可选）
export function apply(ctx, config) {
  ctx.log('已激活')

  // 监听事件
  ctx.on('session/event', (rec) => { ... })
  ctx.on('agent/assistant-stream', ({ frame }) => { ... })
  ctx.on('agent/task-idle', () => { ... })

  // 用服务
  ctx.agents.get()?.followup({ role: 'user', content: '你好' })

  // 可逆副作用（卸载时自动清理）
  ctx.effect(() => {
    const timer = setInterval(() => {}, 1000)
    return () => clearInterval(timer)
  })
}
```

### 入口契约（红线）
- ✅ 命名导出 `name` + `apply`
- ✅ 可选 `inject`（服务名数组）
- ❌ 禁止裸 `export default apply`（会丢 inject）

## 五、UI 扩展插件（ui/）

UI 插件在 `ctx` 基础上额外有 `ctx.ui`：

```js
// ui/my-pet.js
export const name = 'my-pet'

export function apply(ctx) {
  // 挂载 DOM 到页面
  const el = document.createElement('div')
  el.textContent = '🐋'
  ctx.ui.mount(el)

  // 注入样式
  ctx.ui.css('.my-pet { position: fixed; }')

  // 监听 agent 状态，驱动界面
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.text) el.textContent = frame.text.slice(0, 10)
  })
}
```

### ctx.ui 能力
| 方法 | 作用 |
|------|------|
| `ctx.ui.mount(el)` | 把 DOM 挂到页面（插件专属根容器） |
| `ctx.ui.root()` | 取根容器 |
| `ctx.ui.css(text)` | 注入样式 |
| `ctx.ui.onResize(cb)` | 监听窗口尺寸 |

## 六、ctx 完整 API

### 服务
| 服务 | 方法 |
|------|------|
| `ctx.agents` | `.get()` 取 agent 句柄；`.list()` 列会话 |
| `ctx.tools` | `.list()` 列工具名 |
| `ctx.sessions` | `.current()` 当前会话；`.list()` 全部 |
| `ctx.settings` | `.get(k)` / `.set(k,v)` |

### 事件
| 方法 | 语义 |
|------|------|
| `ctx.on(ev, fn)` | 注册监听器，返回 disposer |
| `ctx.once(ev, fn)` | 一次性 |
| `ctx.emit(ev, ...)` | 同步广播 |
| `ctx.parallel(ev, ...)` | 并发，收集返回值 |
| `ctx.serial(ev, ...)` | 顺序，返回第一个非空 |
| `ctx.bail(ev, ...)` | serial 同步版 |
| `ctx.waterfall(ev, val)` | 环绕中间件 |

### 服务提供/注入
| 方法 | 作用 |
|------|------|
| `ctx.provide(name, impl)` | 提供全局服务 |
| `ctx.get(name)` | 取服务 |
| `ctx.inject([names], cb)` | 依赖就绪时回调 |

### 可逆副作用
| 方法 | 作用 |
|------|------|
| `ctx.effect(fn)` | 注册副作用；fn 返回 cleanup，卸载时调用 |

## 七、标准事件（对齐 DSH）

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `session/event` | 一轮回复完成 | `{ type, text, tokenUsage }` |
| `agent/assistant-stream` | 逐字流 | `{ frame: { think, text, finished } }` |
| `agent/task-idle` | 任务空闲 | `{}` |

## 八、安装与分发

1. 把插件推到 GitHub，打 `cuckoo-plugin` topic
2. 在 Cuckoo 插件市场搜索、一键安装
3. 或在 `~/.cuckoo/plugins/<id>/` 手动放置

## 九、安全

- `providers/`、`dsh/`、`ui/` 是**可执行内容**，默认**不启用**，需用户显式授权
- 插件启用后才会加载（`plugins-state.json` 的 `enabled`）


## 十、进阶能力

### 10.1 子作用域 ctx.scope()

用于**隔离的生命周期管理**——插件内部按模块划分，各自独立清理：

```js
export function apply(ctx) {
  // 主作用域：插件卸载时清理
  ctx.effect(() => () => console.log('主清理'))

  // 子作用域：可独立 dispose
  const s = ctx.scope()
  s.effect(() => () => console.log('子清理'))
  s.on('session/event', () => {})

  // 只清理子作用域（主作用域不受影响）
  // s.dispose()

  // 插件卸载时，子作用域也会一起清理
}
```

### 10.2 依赖等待（inject）

`inject` 声明的服务**未就绪时，apply 会被推迟**，直到服务就绪：

```js
export const name = 'consumer'
export const inject = ['greeter']   // 依赖 greeter 服务

export function apply(ctx) {
  // 走到这里，greeter 一定已就绪
  const greeter = ctx.get('greeter')
  greeter.greet('你好')
}
```

**注意**：DSH 允许 inject **任意**服务名（只要有人 `ctx.provide`）。
内置服务（agents/tools/sessions/settings）只是"必定存在"的常用服务。

### 10.3 提供服务

```js
export function apply(ctx) {
  ctx.provide('my-service', {
    doSomething: () => {},
  })
  // 插件卸载时自动注销
}
```

### 10.4 错误诊断

插件加载失败时，Cuckoo 会把错误翻译成**可操作的提示**，例如：
- `[ESM 语法错误]` → 检查是否用了 ESM 命名导出
- `[缺入口]` → 是否导出了 `apply(ctx, config)`
- `[导出方式错误]` → 不要用 `export default`

## 十一、脚手架

用 CLI 快速生成插件骨架：

```bash
node scripts/create-plugin.mjs my-plugin
# → 生成 my-plugin/（含 plugin.json + dsh/ + ui/ + README）
```

## 十二、调试

Cuckoo 运行后，浏览器控制台有 `window.CuckooPlugins`：

```js
CuckooPlugins.list()              // 已加载插件名
CuckooPlugins.listByKind('ui')    // 按类型
CuckooPlugins.stats()             // { total, dsh, ui, failed }
CuckooPlugins.context('my-plugin')// 取插件上下文
CuckooPlugins.failures()          // 加载失败记录
CuckooPlugins.broadcast('my-event', data)  // 广播事件
```

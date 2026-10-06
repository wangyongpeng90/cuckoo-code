# Cuckoo 插件运行时（plugin runtime）

Cuckoo 的**插件系统核心**。

> 定位：这是 **Cuckoo 自己的插件体系**，接口规范与能力**参考 DSH（DeepSeek Harness）**。
> 不是"兼容层"，而是 Cuckoo 原生的插件能力。

## 插件怎么写

用 ESM 命名导出：

```js
export const name = 'my-plugin'
export const inject = ['agents']        // 声明依赖的服务（可选）
export function apply(ctx, config) {
  ctx.on('session/event', (rec) => { ... })
  ctx.effect(() => () => { /* 清理 */ })
}
```

## 特点

- **零外部依赖**：所有 import 都是相对的，模块自包含
- **能力对齐 DSH**：入口契约、5 种事件派发、服务、生命周期
- **可独立复用**：可单独抽出用于其他 Electron/Web 项目

## 模块结构

| 文件 | 职责 |
|------|------|
| `types.ts` | 类型定义（PluginContext / 服务 / 事件） |
| `events.ts` | EventBus：5 种派发（emit/parallel/serial/bail/waterfall） |
| `context.ts` | `createContext`：宿主能力 → 插件上下文 |
| `loader.ts` | 入口契约解析 + 加载（含 ESM→CJS 转换） |
| `bridge.ts` | Cuckoo 事件 → 插件事件名桥 |
| `runtime.ts` | 插件运行时 |
| `ui-runtime.ts` | UI 扩展运行时（`ctx.ui.mount` 等） |
| `patch.ts` | `cordis.patch.yml` 解析（配置声明） |
| `service-registry.ts` | 服务注册表（provide/get/inject） |
| `plugin-host.ts` | `PluginHost`：统一生命周期 + 错误诊断 |
| `index.ts` | 模块入口 |

## 核心 API

### PluginHost（推荐）
```ts
import { PluginHost } from './runtime/index.js'

const host = new PluginHost(hostCapabilities)
host.loadAll([
  { name: 'p1', source: '...', kind: 'dsh' },
  { name: 'p2', source: '...', kind: 'ui' },
])
host.stats()   // { total, dsh, ui, failed }
host.unload('p1')
```

### 底层 API
```ts
import { loadPluginSource, createContext, EventBus, parseCordisPatch } from './runtime/index.js'
```

## ctx API（给插件用）

### 服务
- `ctx.agents` — `.get()` / `.list()`
- `ctx.tools` — `.list()`
- `ctx.sessions` — `.current()` / `.list()`
- `ctx.settings` — `.get(k)` / `.set(k,v)`

### 事件
- `ctx.on(ev, fn)` / `ctx.once` / `ctx.off`
- `ctx.emit` / `parallel` / `serial` / `bail` / `waterfall`

### 服务提供/注入
- `ctx.provide(name, impl)`
- `ctx.get(name)`
- `ctx.inject([names], cb)`

### 可逆副作用 / 作用域
- `ctx.effect(fn)` — fn 返回 cleanup
- `ctx.scope()` — 子作用域，独立生命周期

### UI（仅 ui 类插件）
- `ctx.ui.mount(el)` / `css(text)` / `root()` / `onResize(cb)`

## 标准事件

| 事件 | 载荷 |
|------|------|
| `session/event` | `{ type, text, tokenUsage }` |
| `agent/assistant-stream` | `{ frame: { think, text, finished } }` |
| `agent/task-idle` | `{}` |
| `tool/call` | `{ code }` |
| `tool/result` | `{ code, success, output, error }` |
| `agent/error` | `{ ... }` |

## 测试

见 `test/plugin-system.test.js`。

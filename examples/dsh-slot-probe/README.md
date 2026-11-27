# dsh-slot-probe — Cuko 窗口 DSH 插槽探针

> 阶段 0 回归夹具。隶属 [261125-bmsfsh-cuko-dsh-purge-compat](../docs/requirements/261125-bmsfsh-dsh-purge-compat.md)。

## 它是什么

一个**假 DSH 插件**，用来验证 Cuko 窗口的 DSH 兼容链路是否通。
不是给某个具体插件打的补丁，而是**兼容层的单元测试夹具**——
以后每补一个 DSH 接口，就往这里加一条断言。

## 四环

| 环 | 验什么 | 失败意味着 |
|---|---|---|
| ① load | `__ModuleLoader__.load` 被执行、`require('react')` 可用 | client 源码没下发，或 ModuleLoader 没装 |
| ② register | `ctx.slots.register` 契约：order / entries 结构 / inject 派生 / disposer 返回；两个会话作用域槽位的 scope 目标注入；`ctx.waterfall` 瀑布链、`ctx.inject` 延迟就绪、`ctx.agentPresets`、`ctx.on` 选项 | 插槽注册表 / 事件派发有问题 |
| ③ render | `shell.overlay` 挂载点存在、组件真的进 DOM | Cuko 没有该挂载点 |
| ④ dispose | `ctx.effect` 的 cleanup 在卸载时被调用 | 资源泄漏（样式/监听器/定时器残留） |

## 怎么看结果

三种都行，内容一样：

1. **页面右下角**：四盏灯（绿=通过，红=失败）
2. **Console**：`__dshProbe`
3. **落盘**：`<userData>/plugin-debug.log` 里搜 `[dsh-slot-probe]`（JSON，供脚本判定）

## 怎么装

### 隔离验证（推荐，不碰真实 ~/.cuckoo）

```powershell
$home = "C:\d\SourceCode\2026\cuckoo-code\tmp\cuckoo-home-probe"
New-Item -ItemType Directory -Force -Path "$home\profiles\default\local-plugins" | Out-Null
Copy-Item -Recurse -Force examples\dsh-slot-probe "$home\profiles\default\local-plugins\"
# profile 的 package.json 里加依赖（否则 listProfilePluginEntries 枚举不到）
```

profile 的 `package.json` 需要包含：

```json
{
  "dependencies": {
    "dsh-slot-probe": "file:./local-plugins/dsh-slot-probe"
  }
}
```

然后启动：

```powershell
$env:CUCKOO_HOME = "<上面那个 home>"
npm start
```

### 验环④（卸载）

环④ 需要触发一次卸载。三种方式任选：

- 插件页里**禁用**本插件（走 `reloadDshClients(id, false)`）
- 插件重载（HMR）
- 关掉 Cuko 窗口再打开

触发后灯应变绿，`plugin-debug.log` 里出现 `cleanup 已执行`。

## 加新断言

在 `client.js` 的 `apply()` 里用 `assert(name, ok, detail)` 追加，
失败项会自动拼进环② 的 detail。

## 注意

- 这个探针**不进 CI**：它需要真机 Electron + 真 Cuko 窗口，`vitest` 的 node 环境跑不了。
- 它只是**外部插件形态**的夹具，刻意保持和 dsh-purge 一样的入口结构
  （`package.json` 的 `exports["./client"]` + `window.__ModuleLoader__.load`）。

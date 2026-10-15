# 在 Cuckoo 中使用 DSH 插件

> 本文面向**用户**，说明如何在 Cuckoo 里安装、使用 DSH（DeepSeek Harness）插件。
> 原理与开发者细节见 [plugin-dev.md](./plugin-dev.md) 与 [需求 022](./requirements/022-dsh-plugin-compat.md)。

## 一、这是什么

Cuckoo 内置了 **DSH 兼容层**（需求 022）——用"自己实现同名 API"的方式（类似鸿蒙兼容 Android），
让 DSH 插件**原样**在 Cuckoo 里跑，**不依赖 DSH 本体**。

意味着：npm 上的 DSH 插件，装进 Cuckoo 就能用。

## 二、安装

### 方式 A：插件页（推荐）
1. 侧边栏 →「插件」
2. 滚到「**DSH 插件（npm）**」区块
3. 点 ➕ → 输入 **npm 包名**（如 `dsh-better-sidebar`）→ 确认
4. 装完 **重启 Cuckoo** 生效

### 方式 B：命令行
```
cuckoo plugin add <npm包名>
```

安装位置：`~/.cuckoo/cuckoo-plugins/<包名转id>/`

## 三、使用

装好重启后，DSH 插件注册的工具**自动进 Cuckoo 工具表**，AI 直接调用：

```js
// 插件注册了 greet 工具 → AI 直接调
await greet("Cuckoo")   // → "你好，Cuckoo！(来自 DSH 插件)"
```

**你不用记工具名**——直接告诉 AI 要做什么，它会从工具表里找。

## 四、注意事项（坑）

| 坑 | 说明 | 对策 |
|---|---|---|
| **不是所有 DSH 插件都能跑** | shim 覆盖度有限（P1 核心 ctx + defineTool；P3 才到 UI/命令） | 工具类插件最稳；UI/命令类待 P3 |
| **未实现的 API 是空转** | 未覆盖的 DSH 服务是"万能 stub"——插件能加载，但调用可能无效果 | 看插件用了哪些 API |
| **装完要重启** | 加载在主进程启动时 | 装完重启 Cuckoo |
| **假插件/无关包** | npm 上有些包挂了 dsh 名但不是 DSH 插件 | 看它有没有 `dsh.bundle` 声明 |
| **TS 源码插件** | npm 插件多是编译好的 JS；纯 TS 源码需转译（P2） | 优先装编译好的 JS 插件 |

## 五、常见问题

**Q：装了没反应？**
A：① 重启 Cuckoo 了吗？② 看插件是不是真 DSH 插件（有 `dsh.bundle`）；③ 看它用的 API 是否在 shim 覆盖范围内。

**Q：怎么知道插件注册了哪些工具？**
A：装完重启后，问 AI"你有哪些工具"；或看插件代码 `~/.cuckoo/cuckoo-plugins/<id>/`。

**Q：怎么卸载？**
A：插件页 →「DSH 插件」区块 → 对应插件点卸载 → 重启。

**Q：能装 DSH 官方插件吗？**
A：能。已验证 `@deepseek-ai/dsh-tool-todo`（AI 调 `todo_write`，行为与真 DSH 一致）。

## 六、给插件作者的提示

想**写**一个能在 Cuckoo 跑的 DSH 插件，见 [plugin-dev.md](./plugin-dev.md)。
关键：用 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-tools`，命名导出 `name` + `apply`。

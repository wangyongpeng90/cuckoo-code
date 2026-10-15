<path>D:/cuckoo-pr2/docs/dsh-plugin-guide.md</path>
<type>file</type>
<content>
1: # 在 Cuckoo 中使用 DSH 插件
2: 
3: > 本文面向**用户**，说明如何在 Cuckoo 里安装、使用 DSH（DeepSeek Harness）插件。
4: > 原理与开发者细节见 [plugin-dev.md](./plugin-dev.md) 与 [需求 022](./requirements/022-dsh-plugin-compat.md)。
5: 
6: ## 一、这是什么
7: 
8: Cuckoo 内置了 **DSH 兼容层**（需求 022）——用"自己实现同名 API"的方式（类似鸿蒙兼容 Android），
9: 让 DSH 插件**原样**在 Cuckoo 里跑，**不依赖 DSH 本体**。
10: 
11: 意味着：npm 上的 DSH 插件，装进 Cuckoo 就能用。
12: 
13: ## 二、安装
14: 
15: ### 方式 A：插件页（推荐）
16: 1. 侧边栏 →「插件」
17: 2. 滚到「**DSH 插件（npm）**」区块
18: 3. 点 ➕ → 输入 **npm 包名**（如 `dsh-better-sidebar`）→ 确认
19: 4. 装完 **重启 Cuckoo** 生效
20: 
21: ### 方式 B：命令行
22: ```
23: cuckoo plugin add <npm包名>
24: ```
25: 
26: 安装位置：`~/.cuckoo/cuckoo-plugins/<包名转id>/`
27: 
28: ## 三、使用
29: 
30: 装好重启后，DSH 插件注册的工具**自动进 Cuckoo 工具表**，AI 直接调用：
31: 
32: ```js
33: // 插件注册了 greet 工具 → AI 直接调
34: await greet("Cuckoo")   // → "你好，Cuckoo！(来自 DSH 插件)"
35: ```
36: 
37: **你不用记工具名**——直接告诉 AI 要做什么，它会从工具表里找。
38: 
39: ## 四、注意事项（坑）
40: 
41: | 坑 | 说明 | 对策 |
42: |---|---|---|
43: | **不是所有 DSH 插件都能跑** | shim 覆盖度有限（P1 核心 ctx + defineTool；P3 才到 UI/命令） | 工具类插件最稳；UI/命令类待 P3 |
44: | **未实现的 API 是空转** | 未覆盖的 DSH 服务是"万能 stub"——插件能加载，但调用可能无效果 | 看插件用了哪些 API |
45: | **装完要重启** | 加载在主进程启动时 | 装完重启 Cuckoo |
46: | **假插件/无关包** | npm 上有些包挂了 dsh 名但不是 DSH 插件 | 看它有没有 `dsh.bundle` 声明 |
47: | **TS 源码插件** | npm 插件多是编译好的 JS；纯 TS 源码需转译（P2） | 优先装编译好的 JS 插件 |
48: 
49: ## 五、常见问题
50: 
51: **Q：装了没反应？**
52: A：① 重启 Cuckoo 了吗？② 看插件是不是真 DSH 插件（有 `dsh.bundle`）；③ 看它用的 API 是否在 shim 覆盖范围内。
53: 
54: **Q：怎么知道插件注册了哪些工具？**
55: A：装完重启后，问 AI"你有哪些工具"；或看插件代码 `~/.cuckoo/cuckoo-plugins/<id>/`。
56: 
57: **Q：怎么卸载？**
58: A：插件页 →「DSH 插件」区块 → 对应插件点卸载 → 重启。
59: 
60: **Q：能装 DSH 官方插件吗？**
61: A：能。已验证 `@deepseek-ai/dsh-tool-todo`（AI 调 `todo_write`，行为与真 DSH 一致）。
62: 
63: ## 六、给插件作者的提示
64: 
65: 想**写**一个能在 Cuckoo 跑的 DSH 插件，见 [plugin-dev.md](./plugin-dev.md)。
66: 关键：用 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-tools`，命名导出 `name` + `apply`。
67: 

(End of file - total 67 lines)
</content>

---

## 附录：另一条路线（Ke Code 的实践，仅供参考）

> 本附录非 Cuckoo 的实现要求，而是另一款同类工具（**Ke Code**，Qt 桌面客户端）在"兼容 DSH 插件"上走过的**不同路线**，供维护者对比、取长补短。

### 两条路线的本质差异

| 维度 | Cuckoo（本文档主线） | Ke Code（另一条路） |
|---|---|---|
| **思路** | **自己实现同名 API**（"鸿蒙兼容 Android"）——shim 层翻译 | **不翻译，把 dsh 运行时搬过来**——让 dsh 自己跑 |
| **插件执行** | 主进程内，esbuild 劫持 @deepseek-ai/* → 自己的实现 | 独立进程，dsh 运行时（真实 @deepseek-ai/*） |
| **能力覆盖** | 靠 shim 覆盖度——覆盖到的能用，没覆盖的 stub 空转 | **100% 覆盖**（跑的就是真 dsh 运行时） |
| **代价** | shim 要持续追 dsh API 变化 | 重（dsh 运行时 ~470MB、500+ 依赖） |
| **耦合** | 低（不依赖 dsh 代码） | 高（内置 dsh 运行时，跟它版本） |

### Ke Code 的具体做法（供参考）

1. **内置便携工具**：npm（11.9MB）+ **pnpm.exe**（48MB，自包含）打进安装包——用户机器无需装 Node/npm。
2. **自动装 dsh**：引擎启动时检测，未装则用内置 pnpm 执行 pnpm add @deepseek-ai/dsh（**pnpm 必须，npm 装不全 monorepo**）。
3. **自动配桥接**：装 dsh-as-mcp 插件 + 写入 profile 的 bundles（否则不加载）。
4. **MCP 桥接**：dsh 暴露 MCP 端点（dsh-as-mcp），Ke Code 作 MCP 客户端连接——工具经 MCP 进 Ke Code 工具表。
5. **进程托管**：Ke Code 起/关 dsh 子进程（用户无感，不用手动开）。
6. **装插件**：pnpm add 装到 profile + **校验 dsh.bundle**（假插件回滚+提示）+ 写入 bundles。

### Ke Code 踩过的坑（对 Cuckoo 可能有参考价值）

| 坑 | 说明 |
|---|---|
| **npm 装不全** | npm install @deepseek-ai/dsh 缺内部包（cordis-plugin-group 等）→ **必须用 pnpm**（懂 monorepo） |
| **Corepack pnpm 不可用** | pnpm.mjs 是 Corepack 包装器，要下载原生二进制 → 用**原生 pnpm.exe**（自包含） |
| **装插件要构建批准** | git 托管插件要 prepare 脚本，pnpm 默认阻止 → onlyBuiltDependencies 或只用 npm 托管插件 |
| **假插件混入** | npm/市场里有大量"挂 dsh 名但非 dsh 插件"（如 WeKnora 是 Go 项目）→ **校验 dsh.bundle** |
| **token 会变** | dsh 重启后 MCP token 变 → 读配置时自动同步 |

### 一点建议（非要求）

- **Cuckoo 的 shim 路线更轻、耦合更低**——方向是对的，尤其"鸿蒙兼容 Android"的定位。
- **shim 覆盖度是核心挑战**：DSH API 多，逐一对齐成本高。可考虑"能自动生成 shim 的部分自动生成"（如 @deepseek-ai/* 的子路径映射），减少手工维护。
- **若某天 shim 维护成本过高**，"内置 dsh 运行时 + 桥接"是备选——但**重很多**（见上表），不建议轻易换。
- **两条路不是对立的**：可以先 shim（覆盖常用），跑不通的极少数再"透传"给真实运行时。

> 以上是 Ke Code 的实践记录，**供参考，不构成对 Cuckoo 的建议**。Cuckoo 的架构选择（shim 路线）更符合它"轻依赖"的定位。

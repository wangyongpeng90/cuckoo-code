# DSH 插件兼容性清单

> **给 DSH 插件开发者**：本清单说明 Cuckoo 支持哪些 DSH 能力、哪些不支持。
> **边做边更新**——每实现一个能力，这里就标记 ✅。

## 状态图例

| 符号 | 含义 |
|---|---|
| ✅ | **已兼容**（插件可正常使用）|
| ⚠️ | **部分兼容**（功能可用，但有差异）|
| ❌ | **不兼容**（用了会失效/报错）|
| ⬜ | **未实现**（暂不支持，可能以后做）|

---

## 一、插件入口

| 能力 | 状态 | 说明 |
|---|---|---|
| `export const name` | ✅ | 插件名 |
| `export const inject` | ✅ | 依赖声明 |
| `export function apply(ctx)` | ✅ | 入口函数 |
| `./client` 入口（client.js）| ✅ | 壳页面加载（`__ModuleLoader__`）|
| `cordis.patch.yml`（bundle patch）| ⚠️ | 读（启用/禁用），不执行 insert |

---

## 二、宿主 API（ctx.*）

### 2.1 基础

| API | 状态 | 说明 |
|---|---|---|
| `ctx.on/once/off/emit` | ✅ | 真 EventBus（5 种派发）|
| `ctx.effect(fn)` | ✅ | 可逆副作用（卸载时清理）|
| `ctx.provide/get` | ✅ | 服务注册表 |
| `ctx.inject([names], cb)` | ✅ | 依赖就绪回调（立即执行）|
| `ctx.log/logger` | ✅ | 日志（写文件）|

### 2.2 服务（ctx.get / ctx.xxx）

| 服务 | 状态 | 说明 |
|---|---|---|
| `ctx.tools` | ✅ | 工具注册（register/list/schemas）|
| `ctx.settings` | ✅ | 插件配置（读写）|
| `ctx.sessions` | ✅ | 会话查询 |
| `ctx.agents` | ✅ | 会话 → agent 视图 |
| `ctx.skills` | ✅ | 技能列表（C6）|
| `ctx.commands` | ✅ | 命令/提示词（C6）|
| `ctx.goals` | ✅ | 目标状态（C6）|
| `ctx.compaction` | ✅ | 触发压缩（C6）|
| `ctx.workspaceFiles` | ✅ | 文件树（C6）|
| `ctx.sessionTitle` | ✅ | 会话标题（C6）|
| `ctx.tokenMeter` | ✅ | token 统计（C6）|
| `ctx.subagents` | ✅ | 子代理（C7）|
| `ctx.shell` | ✅ | shell 执行（C7）|
| `ctx.sessionQuery` | ✅ | 会话查询（C7）|
| `ctx.mcpResources` | ✅ | MCP 资源（C8）|
| `ctx.web` | ✅ | webFetch（C8）|
| `ctx.browserUse` | ✅ | 浏览器（C8）|
| `ctx.attachments` | ✅ | 附件（C8）|
| `ctx.terminals` | ✅ | 终端（C8）|
| `ctx.computerUse` / `ctx.ssh` / `ctx.lsp` | ⚠️ | 空实现（不崩，但无功能）|
| `ctx.fs` | ✅ | 文件系统（简化版）|
| `ctx.systemPrompt` | ✅ | 提示词段注册（C4）|
| `ctx.sessionProjections` | ✅ | 会话投影（C2，落盘 C5）|
| `ctx.webServer` | ✅ | 本地 HTTP 服务（动态路由）|
| `ctx.theme` | ✅ | 主题（getTheme/setTheme/subscribe）|
| `ctx.locale` | ✅ | i18n（register/bind/subscribe）|
| `ctx.store` | ✅ | 最小 store 引擎（defineStore）|
| `ctx.configForms` / `ctx.forms` | ✅ | 配置表单（简化）|
| **`ctx.profileContext`** | ✅ | **profile 上下文（含 dir/packageManager）** |

### 2.3 属性访问（host.xxx，非 ctx.get）

| 属性 | 状态 | 说明 |
|---|---|---|
| `ctx.webServer` | ✅ | 同 ctx.get("webServer") |
| `ctx.loader` | ✅ | `entries()` 返回已装插件 |
| `ctx.logger` | ✅ | warn/info/error |
| `ctx.version` | ✅ | 宿主版本号 |
| `ctx.directory` | ✅ | profile 目录 |

---

## 三、CLI 命令（子进程）

| 命令 | 状态 | 说明 |
|---|---|---|
| `dsh plugin --profile <n> add <pkg>` | 🔨 **进行中** | 转 pnpm add |
| `dsh plugin --profile <n> remove <pkg>` | 🔨 | 转 pnpm remove |
| `dsh plugin --profile <n> install` | 🔨 | 转 pnpm install |
| `dsh plugin --profile <n> update` | 🔨 | 转 pnpm update |
| `dsh plugin --profile <n> allow-version` | ❌ | DSH 版本豁免（不用）|
| `dsh --profile <n>`（启动）| ❌ | 启动 DSH（Cuckoo 不是 DSH）|
| `dsh dump-config` | ❌ | 调试命令 |

> **实现方式**：esbuild 打包插件时，把 `node:child_process` 的 `spawn` 换成 shim；
> shim 检测 `dsh plugin ...` → 翻译成 pnpm。**不碰系统 PATH**。

---

## 四、UI 插槽（ctx.slots）

| 插槽 | 状态 | Cuckoo 位置 |
|---|---|---|
| `sidebar.panellist` | ✅ | 主页按钮列表 |
| `sidebar.footer.action` | ✅ | 主页固定底栏 |
| `settings.section` | ✅ | 设置页左导航分类 |
| `sidebar.workspaces`（+4 子槽）| ⏸️ | 挂起（结构差异大）|
| `sidebar.settings` | ❌ | single 类型，官方占用 |
| `conversation.input.*`（9 个）| ❌ | 在 AI 网页输入框 |
| `plugins.detail.section` | ⏸️ | 待"插件详情页" |
| `main` | ⚠️ | 位置冲突（待评估）|
| `settings.plugins.tab` | ⬜ | 待评估 |
| `shell.overlay` | ⬜ | 待评估 |

详见 [dsh-ui-slots.md](./dsh-ui-slots.md)。

---

## 五、UI Primitives（`@deepseek-ai/dsh-client-ui-primitives`）

| 类别 | 状态 | 说明 |
|---|---|---|
| **组件**（Button/Tag/Switch/Modal/Menu/Tooltip...）| ✅ | 自己实现（~20 个）|
| **图标**（188 个）| 🔵 | 机制（占位图标 + 完整名单）|
| **Hooks**（useAnchoredPosition 等）| ⚠️ | 简化实现 |
| **工具函数**（fileSizeText 等）| ⚠️ | 简化实现 |
| **高级组件**（Markdown/Code/Diff）| ⬜ | 未实现 |

详见 [dsh-primitives-compat.md](./dsh-primitives-compat.md)。

---

## 六、明确不兼容

| 能力 | 原因 |
|---|---|
| **"硬改 DOM"型插件** | 直接操作 DSH 的 DOM 结构（如 `dsh-usage` 的卡片）|
| **DSH 启动流程**（`dsh --profile`）| Cuckoo 不是 DSH 运行时 |
| **HMR 热重载**（1 秒重组）| Cuckoo 要重启 |
| **进程重启 + 崩溃恢复** | Cuckoo 是 Electron |
| **`conversation.input.*` 插槽** | 在 AI 网页里，物理上无法支持 |

---

## 七、给插件开发者的建议

**写 DSH 插件时，为了让它在 Cuckoo 里也能跑**：

1. **用 `ctx.slots` 注册 UI**（别硬改 DOM）
2. **用 `ctx.get(...)` 拿服务**（别假设 DSH 专有服务存在）
3. **装插件用 `dsh plugin add`**（我们会翻译；别直接调 pnpm）
4. **UI 组件从 `@deepseek-ai/dsh-client-ui-primitives` 导入**（我们提供了兼容层）
5. **避免依赖 HMR / 进程重启**

---

## 更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-15 | 初版（profile 体系 + dsh CLI 兼容进行中）|


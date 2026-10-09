# src/plugins —— 插件系统

本目录是 Cuckoo 的**插件系统总目录**，含三条独立的"插件线"：

## 1. Cuckoo 插件（市场 + 贡献包）—— 原版

| 文件 | 职责 |
|---|---|
| `market.ts` / `github.ts` / `gitee.ts` / `http.ts` | 插件市场（GitHub/Gitee topic 发现、下载）|
| `installer.ts` / `manifest.ts` / `paths.ts` | 安装（解压/校验清单）、目录约定、清单解析 |
| `roots.ts` / `state.ts` / `types.ts` / `index.ts` | 扫描根、启用状态、类型、入口 |
| `plugins-config.ts` | 插件用户配置（`~/.cuckoo/plugins-config.json`）|

**形态**：`~/.cuckoo/plugins/<id>/`（目录含 `plugin.json` + `skills/agents/rules/mcp/providers/dsh/ui/scripts`）。
**来源**：PR #20（群友）。

## 2. DSH 运行时（简化 cordis）—— PR #36

| 文件 | 职责 |
|---|---|
| `runtime/`（14 文件）| 简化版 cordis 运行时：事件/服务/effect/UI/主题/loader |

**形态**：**bridge 层**（AI 网页里）加载插件的 `dsh/*.js` / `ui/*.js`。
**来源**：PR #36（群友）。**定位**：简化版，与真 DSH 有差距；仍在用（`bridge/plugin-system.ts` + 主题）。

## 3. Cuckoo 插件（DSH 兼容）—— 本项目

| 文件 | 职责 |
|---|---|
| `cuckoo-plugins/`（5 文件）| **真 DSH 兼容**：npm 下载 + esbuild 劫持 + 加载 + 注册工具 |
| `dsh-compat/` | DSH 兼容层（`defineTool`/`Service` shim + 万能空接口）|

**形态**：`~/.cuckoo/cuckoo-plugins/<id>/`（**npm 包**）。
**来源**：需求 022（本项目）。**定位**：**主进程**运行，真正兼容 DSH 插件（"鸿蒙兼容 Android"）。

---

## 三条线的关系

- **1** 是 Cuckoo **自己的**插件（静态贡献：技能/代理/规则/MCP/网页脚本）。
- **2** 是 **PR#36 的简化 DSH**（bridge 层，小范围）。
- **3** 是**真 DSH 兼容**（主进程，能跑 npm 上的 DSH 插件）。

> **2 与 3 职责重叠**（都叫"DSH 运行时"）——**未来可考虑合并/废弃 2**（待 3 成熟）。
> 现阶段**并存**（2 还在给主题/bridge 用）。

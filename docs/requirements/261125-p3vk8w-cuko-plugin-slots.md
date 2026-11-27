---
id: 261125-p3vk8w-cuko-plugin-slots
type: feature
title: Cuko 窗口侧边栏接入 DSH 插件插槽
status: in_progress
branch: feat/261125-p3vk8w-cuko-plugin-slots
created: 2026-11-25
updated: 2026-11-25
---

# Cuko 窗口侧边栏接入 DSH 插件插槽

> 隶属 [022 DSH 插件兼容](./022-dsh-plugin-compat.md)。后续 DSH 兼容需求都在 Cuko 窗口这条线上逐个推进。

## 背景

老页面（壳页面）主页侧边栏给 DSH 插件留了插槽，插件注册后会出现在主页上。
Cuko API 独立工作窗口（`src/ui/cuko/`）没有插槽，插件界面在 Cuko 里看不到。

## 目标

- Cuko 窗口侧边栏提供与老页面主页**同名、同语义**的插槽，插件**不用改**就能两边都出现。
- 老页面主页的表现**完全不变**。
- 插槽渲染逻辑**复用**，不复制。

## 调研结论

### 老页面主页的插槽

| 插槽 | 主页位置 |
|---|---|
| `sidebar.panellist` | 分隔符下方按钮列表（`#ck-home-panels`） |
| `sidebar.footer.action` | 主页固定底栏（`#ck-home-footer`） |

- 条目两路来源：本地 DSH client（`dsh-client-runtime` 的 `getSlotItems / subscribeSlots`）+
  主进程 host（`plugin-slot-list` 全量，`shell-slot-register / shell-slot-unregister` 增量）。
- 点击：带 `command` → `commandInvoke`；不带 → `window.__cuckooSelectPanel(id)`，由 `shell-frame.tsx` 打开 `main` 插槽面板（`MainSlotPage`）。

### Cuko 原来缺什么

1. 没加载 DSH client：预加载脚本缺 `cuckooPluginClientSources`，`loadDshClients` 会直接返回。
2. 主进程插槽注册 / 注销只发给 `mainWin`（`src/app/ipc/plugin.ts`），Cuko 收不到实时更新。
3. 没有 `commandInvoke`，也没有 `__cuckooSelectPanel`，点条目没反应。
4. 插件 client 源码由主进程以字符串下发、`new Function` 执行，没有自定义协议，独立分区 `cuko-api` 不影响加载。

## 方案（已实现）

### 1. 抽共享组件（老页面行为不变）

- `src/ui/shell/scripts/components/sidebar-slots.tsx`：从 `home-react.tsx` 原样抽出
  `useSidebarSlot / renderSidebarSlotItem / SidebarSlotBoundary`，只多了 options（点击回调、样式）。
- `src/ui/shell/scripts/components/main-slot-page.tsx`：从 `shell-frame.tsx` 原样抽出 `MainSlotPage`。
- `home-react.tsx`、`shell-frame.tsx` 改为导入共享组件。

### 2. Cuko 侧（`src/ui/cuko/plugin-slots.tsx`）

| 组件 | 位置 | 说明 |
|---|---|---|
| `CukoSidebarPanels` | 「新对话」下方 | `sidebar.panellist` |
| `CukoSidebarFooter` | 「请求日志」上方 | `sidebar.footer.action` |
| `CukoMainPanel` | 盖在右侧对话区上，左上角关闭 | 点不带 command 的条目时打开 `main` 插槽面板（与老页面一致） |

- 没有条目时只留 `<div data-slot="…" style="display:contents">` 挂载点，侧边栏外观不变。
- 窗口内只启动一次 DSH client 运行时：`loadDshClients` + 订阅 `cuckoo-reload-dsh-clients` +
  挂 `window.__cuckooSelectPanel`（插件 `ctx.layout.selectPanel` 也能用）。
- `app.tsx` 只插入 3 个组件，不加 hook。

### 3. 预加载（`src/app/cuko-preload.ts`，与 shell-preload 同名同通道）

`cuckooPluginClientSources / onCuckooReload / pluginSlotSubscribe / commandInvoke / commandList / webRoutes / webServerInfo / getShellToken`

- **故意不暴露** `slotRegister`：老页面也没有；暴露后 client 条目会再注册成 host 条目，侧栏出现重复。
- 暂不暴露 `navigateSession`：Cuko 会话不是网页会话，插件「打开对话」在 Cuko 里怎么处理另开需求。

### 4. 主进程（`src/app/ipc/plugin.ts`）

- 新增 `broadcastSlotEvent`：先发主窗口，再发 `slotSubscribers` 里的窗口（去重、跳过已销毁）。
- 新增 `plugin-slot-subscribe`：窗口登记订阅，`destroyed` 时自动退订。
- `registerPluginSlot / plugin-slot-unregister` 改用 `broadcastSlotEvent`。

### 5. 构建（`scripts/build-cuko.mjs`）

- 内联样式追加 `dsh-tokens.css`（`--dsw-*` 设计令牌），插件组件在 Cuko 里样式正常。

## 已知情况

- 插件启用 / 禁用 / 卸载时，主进程本来就会 reload **所有**窗口（含 Cuko，见 `plugin.ts` HMR 广播），不是本需求引入的。
- `useSidebarSlot` 的 IPC 监听不会移除（老页面原有写法，照搬未改）。

## 验收标准

- [ ] Cuko 侧边栏有 `sidebar.panellist`、`sidebar.footer.action` 两个 `data-slot` 挂载点。
- [ ] 已安装的 DSH 插件（client / host 两类）在 Cuko 侧边栏正常显示，不用改插件。
- [ ] 点不带 command 的面板条目，Cuko 对话区上打开插件面板，左上角可关闭。
- [ ] 插件启用 / 禁用 / 卸载后，Cuko 侧边栏随之更新。
- [ ] 单个插件渲染报错不影响 Cuko 其它部分。
- [ ] 没有插件时侧边栏外观不变。
- [ ] 老页面主页插槽和插件面板表现不变。
- [ ] `typecheck / test / lint / compile` 全绿，真机 `npm start` 验证。

## 不做

- 其它插槽（对话区、输入区、右栏等）：另开需求。
- 「硬改 DOM」型插件（见 `docs/dsh-ui-slots.md` 5.5）。

## 收尾待办

- 验收后更新 `docs/dsh-ui-slots.md` 第 6、9 项：注明 Cuko 窗口也已支持。
- 022 需求文档里「C7/C8 未合 master」的说法已过期（分支已全部合入），顺手修正。

## 相关

- `docs/requirements/022-dsh-plugin-compat.md`
- `docs/dsh-ui-slots.md`
- `docs/requirements/261109-8ms69z-cuko-api.md`

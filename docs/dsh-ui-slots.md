# DSH 界面插槽清单（实测）

> 来源：**2026-10-09 实测** DSH Web（`http://127.0.0.1:3080`），用 playwright 扫描 DOM 得到。
> 用途：**对照设计 Cuckoo 自己的 UI 扩展点**。逐个确认"要不要做、怎么做"。
> 状态：⬜ 待评估 / 🔨 进行中 / ✅ 已支持 / ❌ 不做

---

## 一、DSH 插槽机制（实测）

DSH 每个插槽在 DOM 里是**一个带名字的容器**：

```html
<div data-slot="sidebar.footer.action" style="display: contents;">
  <!-- 插件注册的组件渲染在这里 -->
</div>
```

**关键事实**：
- 插槽用 **`data-slot="<点分名>"`** 标记（如 `sidebar.brand.mark`）
- 插槽是 **DOM 挂载点**——**不绑 React**（React 只是 DSH 的渲染实现）
- 页面共扫描到 **40 个插槽**（含空槽与已占槽）
- **空槽**（`children.length === 0`）是"留给插件的插孔"

**对本项目的启示**：Cuckoo **可用原生 JS 实现同样的"命名挂载点"机制**，无需引入 React。

---

## 二、槽位清单（按区域）

### 2.1 全局

| # | 槽位 | 中文名 | 状态 | Cuckoo 评估 |
|---|---|---|---|---|
| 1 | `root` | 根容器 | 已占 | ⬜ |
| 2 | `shell.overlay` | 全局浮层 | **空** | ⬜ |

### 2.2 左侧栏

| # | 槽位 | 中文名 | 状态 | Cuckoo 评估 |
|---|---|---|---|---|
| 3 | `sidebar` | 侧边栏（整条）| 已占 | ⬜ |
| 4 | `sidebar.brand.mark` | 品牌图标 | 已占 | ⬜ |
| 5 | `sidebar.brand.name` | 品牌名 | 已占 | ⬜ |
| 6 | `sidebar.panellist` | 面板图标栏 | 已占 | ✅ **已支持**（Cuckoo 主页按钮列表）|
| 7 | `sidebar.workspaces` | 工作区列表 | 已占 | ⏸️ **挂起**（结构差异大）|
| 8 | `sidebar.workspaces.directoryFlow` | 工作区目录流 | **空** | ⏸️ **挂起**（随 #7）|
| 9 | `sidebar.footer.action` | 侧栏底部动作 | **空** | ✅ **已支持**（Cuckoo 主页固定底栏）|
| 10 | `sidebar.settings` | 侧栏设置座 | 已占 | ❌ **不做**（single 类型，官方占用）|
| 11 | `settings.launcher` | 设置启动器 | 已占 | ⬜ |
| 12 | `settings.trigger` | 设置触发钮 | 已占 | ⬜ |
| 13 | `settings.onboarding` | 设置引导 | **空** | ⬜ |

### 2.3 主区 / 对话区

| # | 槽位 | 中文名 | 状态 | Cuckoo 评估 |
|---|---|---|---|---|
| 14 | `main` | 主区 | 已占 | ⬜ |
| 15 | `main.conversation` | 主对话区 | 已占 | ⬜ |
| 16 | `conversation.header` | 对话头部 | 已占 | ⬜ |
| 17 | `conversation.header.leading` | 头部左区 | **空** | ⬜ |
| 18 | `conversation.session.header` | 会话头部 | 已占 | ⬜ |
| 19 | `conversation.session.header.corner` | 会话头部角 | **空** | ⬜ |
| 20 | `conversation.session` | 会话正文 | **空** | ⬜ |
| 21 | `conversation.composer` | 输入区 | 已占 | ⬜ |
| 22 | `conversation.hero.brand.mark` | 空态品牌图标 | 已占 | ⬜ |
| 23 | `conversation.hero.workspace` | 空态工作区 | 已占 | ⬜ |
| 24 | `conversation.hero.workspace.directoryFlow` | 空态工作区目录流 | **空** | ⬜ |
| 25 | `conversation.hero.agentPreset` | 空态智能体预设 | 已占 | ⬜ |

### 2.4 输入区

| # | 槽位 | 中文名 | 状态 | Cuckoo 评估 |
|---|---|---|---|---|
| 26 | `conversation.input.dock` | 输入停靠区 | **空** | ❌ **不做**（在 AI 网页输入框）|
| 27 | `conversation.composer.bar` | 输入条 | 已占 | ❌ **不做**（在 AI 网页）|
| 28 | `conversation.input.overlay` | 输入浮层 | 已占 | ❌ **不做**（在 AI 网页）|
| 29 | `conversation.input.attachments` | 输入附件 | **空** | ❌ **不做**（在 AI 网页）|
| 30 | `conversation.input.permission` | 输入权限位 | 已占 | ❌ **不做**（在 AI 网页）|
| 31 | `conversation.input.plan` | 输入计划位 | **空** | ❌ **不做**（在 AI 网页）|
| 32 | `conversation.input.left` | 输入左区 | **空** | ❌ **不做**（在 AI 网页）|
| 33 | `conversation.input.right` | 输入右区 | **空** | ❌ **不做**（在 AI 网页）|
| 34 | `conversation.input.model` | 输入模型位 | 已占 | ❌ **不做**（在 AI 网页）|
| 35 | `conversation.input.activity` | 输入活动位 | **空** | ❌ **不做**（在 AI 网页）|

### 2.5 右栏

| # | 槽位 | 中文名 | 状态 | Cuckoo 评估 |
|---|---|---|---|---|
| 36 | `rightbar` | 右栏 | 已占 | ⬜ |
| 37 | `rightbar.session` | 右栏会话 | 已占 | ⬜ |
| 38 | `sidebar.right.pane.tab.title` | 右栏标签标题 | 已占 | ⬜ |
| 39 | `sidebar.right.tab.guide` | 右栏引导 | 已占 | ⬜ |
| 40 | `sidebar.right.tab.guide.entry` | 右栏引导条目 | 已占 | ⬜ |

---

## 三、空槽位速查（可直接演示）

| 槽位 | 中文名 | 区域 |
|---|---|---|
| `shell.overlay` | 全局浮层 | 全局 |
| `sidebar.workspaces.directoryFlow` | 工作区目录流 | 左栏 |
| `sidebar.footer.action` | 侧栏底部动作 | 左栏 |
| `settings.onboarding` | 设置引导 | 左栏 |
| `conversation.header.leading` | 头部左区 | 对话 |
| `conversation.session.header.corner` | 会话头部角 | 对话 |
| `conversation.session` | 会话正文 | 对话 |
| `conversation.hero.workspace.directoryFlow` | 空态工作区目录流 | 对话 |
| `conversation.input.dock` | 输入停靠区 | 输入 |
| `conversation.input.attachments` | 输入附件 | 输入 |
| `conversation.input.plan` | 输入计划位 | 输入 |
| `conversation.input.left` | 输入左区 | 输入 |
| `conversation.input.right` | 输入右区 | 输入 |
| `conversation.input.activity` | 输入活动位 | 输入 |

---

## 四、逐个评估（待填充）

> 每次评估一个槽位，填上"Cuckoo 要不要做、怎么做、对应现有位置"。

| # | 槽位 | 决定 | 说明 |
|---|---|---|---|
| 1 | `root` | ⬜ | 根容器（全局，非插件点）|
| 2 | `shell.overlay` | ⬜ | 全局浮层（空）|
| 3 | `sidebar` | ⬜ | 侧边栏容器 |
| 4 | `sidebar.brand.mark` | ❌ **不做** | 品牌图标（DSH 用于换 logo；Cuckoo 无此需求，且无侧栏）|
| 5 | `sidebar.brand.name` | ❌ **不做** | 品牌名（与 brand.mark 一对；同理由，不做）|
| 6 | `sidebar.panellist` | ✅ **已支持** | 映射到**主页**（分隔符下方 `#ck-home-panels`）。插件 `ctx.ui.slot.register({slot:'sidebar.panellist', id, label, title, command?})` → 主页渲染成按钮列表，按 order 排序。见 `pages/home-react.tsx` |
| 7 | `sidebar.workspaces` | ⏸️ **挂起** | Cuckoo 工作区页按"项目目录"分组，DSH 按"工作区"——结构差异大，硬映射易歪。且有 4 个子槽位（`directoryFlow`/`session.row.action`/`session.row.leading`/`session.menu.item`）|
| 9 | `sidebar.footer.action` | ✅ **已支持** | 映射到**主页固定底栏**（`#ck-home-footer`）。插件注册后渲染成组件（如 remote-web-ui 的电话图标）。见 `pages/home-react.tsx` |
| 10 | `sidebar.settings` | ❌ **不做** | `single` 类型，官方 `SettingsRoot` 占用；注册会 `shadows-shipped-ui`（替换官方设置行）|
| 26-35 | `conversation.input.*`（9 个）| ❌ **不做** | **全在 AI 网页的输入框里**——Cuckoo 只能改壳（侧栏/状态栏），改不了 AI 网页。物理上无法支持 |
| — | `plugins.detail.section` | ⏸️ **挂起** | 需要"Cuckoo 插件详情页"（目前只有列表，没有点进去的详情页）|
| — | `main`（新版新增）| ⚠️ **待评估** | DSH 主区整页 vs **Cuckoo 主区 = AI 网页**——位置冲突，要开"Cuckoo 插件整页"才能做 |
| — | `settings.section`（新版新增）| ⬜ **待评估** | 4 个插件用它，收益最大；Cuckoo 设置页可加"区块"机制 |

> **重要区分**：Cuckoo 另有 3 个**自造挂载点**（`activitybar`/`toolbar`/`statusbar`，见 `plugin-shell.ts` 的 `mountSlot`）——那是 Cuckoo 老插件机制，**不是 DSH 插槽名**。DSH 的 40 个插槽名都是点分名（如 `sidebar.panellist`），由对应 React 页面各自订阅渲染，**不走 mountSlot**。

---

## 五、关键结论：DSH UI 插件能否在 Cuckoo 跑（挂起问题）

> 2026-10-09 实证 + POC 验证后的结论。**"改 React 也不行"的说法不够精确**——修正如下。

### 5.1 DSH UI 插件 = 双入口

| 入口 | 内容 | 技术 |
|---|---|---|
| `.`（宿主侧）| `apply(ctx)` 注册工具/服务 | **纯 JS**（Cuckoo 已支持）|
| `./client`（客户端）| **React 组件 + 槽位注册** | **React** |

**实测**：`ui-attachment` 的宿主侧是**空壳**（`apply(){}`），功能全在 `./client`。

### 5.2 "改 React 是否可行"——分四层

| 层 | 结论 | 证据 |
|---|---|---|
| **① React 本身** | ✅ **能进 Cuckoo** | 骨架验证（`feat/shell-react` 分支，`ck-react-root` 渲染成功）|
| **② 最小运行时**（`__ModuleLoader__` + `ctx.slots`）| ✅ **~100 行** | POC（`_poc-dsh-ui.html`，含内联实现）|
| **③ 客户端服务**（`layout`/`locale`/`store`/`api-remotes`…）| ⚠️ **按需补**（复杂插件 inject 一堆）| `ui-sidebar` inject 5 个服务 |
| **④ 槽位位置** | ❌ **根本问题** | DSH 大量槽位在"对话区"，**Cuckoo 的对话在 AI 网页**（不能动）|

### 5.3 能跑的插件范围

| 插件类型 | 能否跑 |
|---|---|
| 只用 `slots` 的简单 UI 插件 | ✅ **能**（补②即可）|
| inject 多服务的复杂插件 | ⚠️ **按需补服务**（无底洞）|
| 注册到"对话区"槽位的插件 | ❌ **无处可放**（对话在 AI 网页）|
| **"硬改 DOM"的插件** | ❌ **不兼容**（明确，见 5.5）|

### 5.4 结论

**"改 React"是必要的，但只解决"渲染"**——还缺三道关：
1. **运行时**（简单，POC 已证）
2. **客户端服务**（复杂，按需）
3. **槽位映射**（根本问题，**你逐个拍板**）

**React 只是"入场券"**；**真正难的是"槽位位置对不上"+"复杂插件要补服务"**。

### 5.5 "硬改 DOM"型插件——**不兼容（明确）**

**现象**：部分插件（如 `@linxin666/dsh-usage` 的卡片）**不走 `ctx.slots`**，而是**直接找 DSH 的 DOM 结构、手动插入**：
```js
const foot = document.querySelector('[data-pane="sidebar"]')?.querySelector('[class*="footArea"]');
foot.insertBefore(container, foot.querySelector('[class*="settingsArea"]'));
```

**判断**：这**不符合 DSH 官方的 slots 宗旨**（官方推荐 `ctx.slots.register`）——属于"硬改"。

**Cuckoo 立场**：**不兼容**。若为它加"伪 DOM 钩子"，会**越加越多**（每个硬改插件假设的 DOM 都不同），**得不偿失**。

**（2026-10-10 决定）** 曾为 `dsh-usage` 试加 `data-pane="sidebar"` / `footArea` / `settingsArea` 钩子，**后撤回**。

---

## 六、相关

- 截图：`dsh-all-slots.png`（全槽位标注）、`dsh-slot-inject.png`（注入演示）
- 现有 Cuckoo UI 机制：`docs/plugin-system.md`（`ctx.ui` / `ctx.ui.overlay`）
- 需求档案：`docs/requirements/022-dsh-plugin-compat.md`
- React 骨架验证分支：`feat/shell-react`

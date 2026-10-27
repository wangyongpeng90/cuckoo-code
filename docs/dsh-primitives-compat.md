# DSH UI Primitives 兼容清单

> 目标：实现 `@deepseek-ai/dsh-client-ui-primitives`，让 DSH 插件的 UI 组件在 Cuckoo 里工作。
> 原则：**不抄 DSH 代码**——只看 API/行为，用 Cuckoo 的 CSS 自己写实现。
> 来源：`C:\d\SourceCode\2026\deepseek-harness2\packages\client\ui-primitives\`（MIT，仅作 API 参考）

## 状态图例

- ✅ **已实现**
- 🔨 **进行中**
- ⬜ **未实现**
- ➖ **不需要**（暂无插件用，或 Cuckoo 场景不适用）
- 🔵 **用机制解决**（如"任意图标名 → 占位"）

---

## 一、组件（58 个）

### 1.1 dsh-market 必需（13 个）

| # | 组件 | 状态 | 说明 |
|---|---|---|---|
| 1 | `Button` | ⬜ | 按钮（variant: primary/ghost/outline/toolbar）|
| 2 | `DisclosureRow` | ⬜ | 可展开行 |
| 3 | `Input` | ⬜ | 输入框 |
| 4 | `Menu` | ⬜ | 下拉菜单（含 MenuSurface/MenuGroup/MenuItemButton）|
| 5 | `Modal` | ⬜ | 模态框（含焦点陷阱）|
| 6 | `Pill` | ⬜ | 胶囊标签（可点）|
| 7 | `StateDot` | ⬜ | 状态圆点 |
| 8 | `Toast` | ⬜ | 轻提示 |
| 9 | `Tooltip` | ⬜ | 悬浮提示 |
| 10 | `Tag` | ⬜ | 标签（只读）|
| 11 | `Switch` | ⬜ | 开关 |
| 12 | `Checkbox` | ⬜ | 复选框 |
| 13 | `SegmentedControl` | ⬜ | 分段控件 |

### 1.2 基础组件（其余）

| 组件 | 状态 | 说明 |
|---|---|---|
| `BrandWordmark` | ⬜ | 品牌字标 |
| `ConnectionIndicator` | ⬜ | 连接状态指示 |
| `FishLogo` | ⬜ | Fish logo |
| `HoverCard` | ⬜ | 悬浮卡片 |
| `InlineEditor` | ⬜ | 行内编辑 |
| `PathLabel` | ⬜ | 路径标签 |
| `SegmentedTabs` | ⬜ | 分段 Tab |
| `ShortcutKeys` | ⬜ | 快捷键显示 |
| `TextShimmer` | ⬜ | 微光文字 |
| `PermissionIconFullAccessMedium` | ⬜ | 权限图标 |
| `PermissionIconFullAccessRegular` | ⬜ | 权限图标 |
| `PermissionIconReadOnlyMedium` | ⬜ | 权限图标 |
| `PermissionIconReadOnlyRegular` | ⬜ | 权限图标 |
| `PermissionIconWorkspaceWriteMedium` | ⬜ | 权限图标 |
| `PermissionIconWorkspaceWriteRegular` | ⬜ | 权限图标 |
| `ReferenceIconMedium` / `ReferenceIconRegular` | ⬜ | 引用图标 |
| `LinkIconMedium` / `LinkIconRegular` | ⬜ | 链接图标 |
| `FileTypeIcon` | ⬜ | 文件类型图标 |

### 1.3 高级组件（Markdown / 代码 / Diff / 终端）

| 组件 | 状态 | 依赖 |
|---|---|---|
| `MarkdownText` | ⬜ | micromark/mdast |
| `MarkdownDelegateProvider` | ⬜ | — |
| `CodeBlock` | ⬜ | shiki |
| `JsonBlock` | ⬜ | — |
| `JsonTree` | ⬜ | — |
| `DiffBlock` | ⬜ | diff |
| `TerminalBlock` | ⬜ | anser |
| `ReadBlock` | ⬜ | — |
| `SearchBlock` | ⬜ | — |
| `WebBlock` | ⬜ | — |
| `ImageLightbox` | ⬜ | — |
| `RiskConfirmation` | ⬜ | — |

### 1.4 装饰 / 插画

| 组件 | 状态 |
|---|---|
| `PluginArtworkTerminal` / `Loop` / `Subagent` / `Search` / `Default` | ⬜ |
| `GuideArtworkBrowser` / `GuideArtworkFiles` | ⬜ |

### 1.5 设置表单子系统

| 组件 | 状态 |
|---|---|
| `SettingsForm` | ⬜ |
| `SettingsSecretField` | ⬜ |
| `SettingsValueField` | ⬜ |
| `SettingsFormModel` | ⬜ |

---

## 二、Hooks（5 个）

| Hook | 状态 | dsh-market 用吗 |
|---|---|---|
| `useAnchoredPosition` | ⬜ | ✅（Menu/Tooltip 定位）|
| `useAnchoredMaxHeight` | ⬜ | ✅ |
| `useDismissOnOutsidePointer` | ⬜ | ✅ |
| `useModalLayer` | ⬜ | ✅（Modal 焦点层）|
| `useCodeHighlighter` | ⬜ | ❌ |

---

## 三、工具函数（21 个）

| 函数 | 状态 |
|---|---|
| `classifyFileType` / `fileExtension` | ⬜ |
| `classifyLinkPath` | ⬜ |
| `closeTopModal` / `isBehindModal` / `modalSelector` | ⬜ |
| `diffTotals` | ⬜ |
| `extractMarkdownPlainText` | ⬜ |
| `fileSizeText` | ⬜ |
| `focusWithoutRing` | ⬜ |
| `isDarwinDesktop` | ⬜ |
| `languageForPath` | ⬜ |
| `observeComposition` | ⬜ |
| `observeStickyMenuGroups` | ⬜ |
| `pointerModality` | ⬜ |
| `projectUserText` | ⬜ |
| `rankByName` | ⬜ |
| `relativeTime` | ⬜ |
| `settingsNumberField` / `settingsTextField` | ⬜ |
| `writeClipboard` | ⬜ |

---

## 四、图标（188 个 = 94 图标 × 2 拼写）

**策略**：🔵 **用机制解决**——不逐个实现，而是：
1. `ownKeys` 返回**完整名单**（从 DSH 源码抄名字，让 `__toESM` 能遍历）
2. 每个名字 → **占位图标组件**（统一 SVG，不崩）
3. 后续可**逐个替换为真图标**（按需）

**94 个基础名**（每个有 Medium/Regular 两种）：

AgentPreset、AlarmClock、Api、ArchiveCheck、ArchiveOff、Archive、Branch、Browse、CheckCircleFill、CheckCircleOutline、Check、Checklist、ChevronDown、ChevronLeft、ChevronRight、ChevronUp、ChevronsUpDown、Clock、CloseCircleFill、CloseFill、Close、Code、Compact、CompareSplit、ContextInjection、Copy、CordisPlugin、Dark、Data、Database、DeliverDoc、DislikeFill、Dislike、Download、Edit、Ellipsis、Enhance、FlatList、FolderClose、FolderOpenOutline、FolderOpen、Followsystem、Fullscreen、Gauge、Globe、Goal、Info、Inspect、Light、LikeFill、Like、Link、ListPen、Loading、Microphone、NewChat、NowrapFill、PanelLeft、PaperPlane、Paperclip、Pause、Personalization、PinFill、Pin、Plan、Play、PluginPinwheel、Plus、ProjectAdd、Question、Queue、Refresh、RightUp、Search、Send、Settings、Share、Shield、Skill、SlidersTwo、Sparkle、StopFill、Think、Trash、TreeCorner、TriangleRightFill、Unarchive、User、Users、Warning、WarningTriangle、WorkspaceTree、WrapFill、WrapLines

---

## 五、常量

| 常量 | 状态 |
|---|---|
| `DEFAULT_DIFF_MAX_LINES` / `READ` / `SEARCH` / `TERMINAL` | ⬜ |
| `FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX` | ⬜ |
| `CODE_HIGHLIGHT_EXTENSIONS` | ⬜ |

---

## 六、实现位置

`src/ui/shell/scripts/dsh-primitives/`（新建目录）

| 文件 | 职责 |
|---|---|
| `index.ts` | 汇总导出（= `@deepseek-ai/dsh-client-ui-primitives` 的替身）|
| `icons.tsx` | 图标（机制 + 名单）|
| `*.tsx` | 各组件 |

**接入点**：`dsh-client-runtime.ts` 的 `moduleTable`：
```ts
'@deepseek-ai/dsh-client-ui-primitives': primitivesModule,
```

---

## 七、进度

| 批次 | 范围 | 状态 |
|---|---|---|
| **第一批** | dsh-market 必需的 13 组件 + 图标机制 + 4 hooks | 🔨 进行中 |
| 第二批 | 其余基础组件 | ⬜ |
| 第三批 | 高级组件（Markdown/Code/Diff）| ⬜ |
| 第四批 | 设置表单子系统 | ⬜ |

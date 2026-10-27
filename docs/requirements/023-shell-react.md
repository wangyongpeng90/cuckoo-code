---
id: 023
type: feature
title: 壳页面 React 化（shell UI 迁移）
status: in_progress
branch: feat/shell-react
created: 2026-10-09
updated: 2026-10-09
---

## 背景

Cuckoo 的壳页面（`src/ui/shell/`）是**原生 JS + innerHTML** 拼装（~4700 行 TS/CSS/HTML），维护难、扩展难。

**动机**：
1. **"DSH UI 插件兼容"探索**——DSH UI 全是 React，Cuckoo 若要接，壳得先有 React
2. **可维护性**——原生 `innerHTML` 拼接易错、难扩展
3. **组件化**——React 的状态管理/组件复用

**决策**（用户）：**全改 React**——"要改就全改"。

## 目标

- **壳页面全部 React 化**（活动栏 + 13 个页面）
- **保持功能不变**（对齐原版）
- **渐进替换**（新旧并存 → 逐页迁 → 最后删旧）

## 实现

### 技术选型

| 项 | 选择 |
|---|---|
| **框架** | React 18（`react` + `react-dom`）|
| **打包** | esbuild（已有 `build-shell.mjs`）+ `jsx: 'automatic'` |
| **tsconfig** | 加 `"jsx": "react-jsx"` |
| **样式** | 复用现有 CSS class（`.ck-*`）|

### 框架（`shell-frame.tsx`）

- **活动栏**：React 渲染 12 个图标（`TABS` + `BOTTOM_TABS`）
- **页面容器**：`useState` 管理当前 tab + `PAGES` 注册表
- **交互**：收起态点图标 → 展开 + 切页；点已激活图标 → 收起；拖拽调宽
- **旧结构隐藏**：`ck-old-shell`（`display:none`）包裹旧的原生结构

### 已迁页面（13 个）

| # | 页面 | 文件 |
|---|---|---|
| 1 | About | `about-react.tsx` |
| 2 | Skills | `skills-react.tsx` |
| 3 | MCP | `mcp-react.tsx` |
| 4 | Snippets | `snippets-react.tsx` |
| 5 | Conversations | `conversations-react.tsx`（入口保持隐藏）|
| 6 | Token | `token-react.tsx` |
| 7 | Feishu | `feishu-react.tsx` |
| 8 | Settings | `settings-react.tsx` |
| 9 | Agents | `agents-react.tsx` |
| 10 | Files | `files-react.tsx` |
| 11 | Windows | `windows-react.tsx` |
| 12 | Workspaces | `workspaces-react.tsx` |
| 13 | Plugins | `plugins-react.tsx` |

### 迁移模式

```tsx
const [data, setData] = useState(null);
const load = useCallback(async () => { const r = await api.xxx(); setData(r); }, []);
useEffect(() => { load(); }, [load]);
return <div>...</div>;   // 复用 .ck-* class
// main.ts: registerPage('xxx', XxxPage)
```

## 验证

- **typecheck**：0 错误
- **test**：877 passed
- **lint**：0 errors
- **真机**：13 个页面逐个验证（数据加载 + 渲染）

## 未完成

- **旧代码清理**（低优先）：
  - 旧 `pages/*.ts`（仍被 `main.ts` import，副作用在跑）
  - 旧 `partials/pages/*.html`（包在 `ck-old-shell` 里隐藏）
  - `ck-old-shell` 隐藏逻辑
- **时机**：等 React 版真机用一阵子、确认无 bug 后再删（旧代码当"回退"）

## 相关

- 分支：`feat/shell-react`
- 截图/调试：playwright-cuckoo（CDP 9334）

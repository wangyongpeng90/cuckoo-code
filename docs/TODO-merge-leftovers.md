# 合并遗留待办

> 合并 master 后，有些新功能在 Cuckoo 壳里"没入口"——记录在此，避免遗忘。

## 背景

Cuckoo 壳已 **React 化**（shell-frame.tsx + registerPage）。
而 **master 的部分新页面用旧机制**（sidebar.js + registerTab）——**合并后不会出现在侧栏**。

**旧机制已废弃**（sidebar.js 被 shell-frame.tsx 取代），但 master 仍在用。

## 待补（合并 master 带来的）

| # | 功能 | master 的实现 | 待办 | 来源 |
|---|---|---|---|---|
| 1 | **用户记忆** | pages/memories.ts + registerTab(memories, ...) | 写 memories-react.tsx + 在 shell-frame.tsx 加 tab | 需求 026/027/028（v0.8.15/16）|

## 长期问题

**每次 master 加新页面（用 registerTab），合并后都会"没入口"**。

- 缓解：合并时检查 master 的 registerTab 调用，看有没有对应 React 版
- 彻底解决：master 也 React 化（但那是 master 的事）

## 检查方法

```bash
# 看 master 的 main.ts 里 registerTab 了哪些
git show master:src/ui/shell/scripts/main.ts | findstr registerTab
# 对照 shell-frame.tsx 的 registerPage
findstr registerPage src/ui/shell/scripts/main.ts
```


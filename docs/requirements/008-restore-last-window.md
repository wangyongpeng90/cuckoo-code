---
id: 008
type: feature
title: 启动时恢复最后活跃的窗口
status: done
branch: feat/008-restore-last-window
created: 2026-09-23
updated: 2026-09-25
---

## 背景

多窗口场景下，用户切换窗口后关闭程序，下次启动总是打开**列表第一个** profile，
而不是上次最后用的那个，体验割裂。

## 目标

记住"最后活跃的窗口（profile）"，重启后自动打开它。

- **不改变**窗口管理列表顺序（避免列表跳动）
- 仅影响**启动时选哪个 profile**

## 方案

### 1. profile.ts

- 新增持久化：`userData/last-active-profile.json`（存 `{ profileId }`）
- `setLastActiveProfileId(id)` / `getLastActiveProfileId()`
- `getDefaultProfile()`：优先返回 last-active（若存在且仍在列表），否则回退 `profiles[0]`

### 2. entry.ts（createWindow）

窗口 **focus** 时写入 last-active：

```js
mainWindow.on('focus', () => {
  profileManager.setLastActiveProfileId(profileData.id);
});
```

### 3. 边界

- last-active 的 profile 已被删除 → 回退到 `[0]`
- 首次运行（无记录）→ 回退到 `[0]`

## 验收标准

- [x] 切换到窗口 B → 重启 → 打开 B
- [x] 窗口列表顺序不变
- [x] last-active 被删 → 回退第一个（getDefaultProfile 校验存在性）
- [x] 首次启动无记录 → 创建时即记录
- [x] typecheck / test / lint / compile
- [x] 真机验证

## 遗留

- 真机验证

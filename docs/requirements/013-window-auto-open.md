---
id: 013
type: feat
title: 窗口默认打开（多选）+ 记录大小位置
status: doing
branch: feat/013-window-auto-open
created: 2026-09-25
updated: 2026-09-25
---

## 背景

现状：启动时只开一个窗口（上次活跃的或第一个），窗口大小写死 1280x900，关闭不保存。
用户希望：
1. 能勾选「默认打开」的窗口（可多选），启动时自动打开这些窗口
2. 关闭窗口时记录其大小/位置，下次按记录恢复

## 目标

- 窗口管理面板：每个窗口加「默认打开」复选框（多选）
- 启动时：打开所有勾选的窗口；若一个都没勾，回退「上次活跃的或第一个」
- 每次关闭窗口：记录其大小、位置、（是否最大化）
- 打开窗口时：按记录恢复；首次无记录用默认 + 级联偏移避免重叠

## 设计决策（逐条确认）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 数据存哪 | 扩展 profile 对象（加 autoOpen + bounds），存 profile-list.json |
| 2 | 勾选的窗口平台未确定 | 照常打开（显示平台选择页） |
| 3 | 一个都没勾 | 回退「上次活跃的或第一个」（保证至少一个窗口） |
| 4 | 是否记最大化 | 记（getNormalBounds() + isMaximized()；去掉强制 maximize()） |
| 5 | 多窗口首次重叠 | 级联偏移（第 N 个偏移 N*30px） |
| 6 | UI 呈现 | 列表项左侧加复选框 |

## 方案

### 1. profile.ts

- profile 对象加 autoOpen?: boolean、bounds?: { x, y, width, height, maximized }
- setAutoOpen(id, on)：设置默认打开
- setWindowBounds(id, bounds)：记录大小位置
- getAutoOpenProfiles()：返回所有 autoOpen === true 的 profile

### 2. entry.ts 的 createWindow

- 打开时：读 profile.bounds，有则 setBounds，无则用默认 + 级联偏移（按当前窗口数）
- 去掉强制 mainWindow.maximize()
- 若 bounds.maximized → maximize()
- 关闭时：记 getNormalBounds() + isMaximized()

### 3. 启动逻辑

- app.whenReady：读 autoOpen profiles
  - 有勾选 → 逐个 createWindow(profile)
  - 无勾选 → createWindow(null)（现有逻辑）

### 4. UI（window-manager.ts）

- 列表项左侧加复选框（input type=checkbox，data-profile-id）
- 勾选状态回显（从 profile.autoOpen）
- 变更时调 IPC set-profile-auto-open

### 5. IPC（entry.ts + api.ts）

- set-profile-auto-open：设置某 profile 的 autoOpen

## 验收标准

- [ ] profile 加 autoOpen/bounds 字段 + 读写函数
- [ ] 启动按勾选打开多窗口；无勾选回退默认
- [ ] 关闭窗口记录大小/位置/最大化
- [ ] 打开窗口按记录恢复；首次默认 + 级联偏移
- [ ] 面板复选框可勾选 + 回显
- [ ] typecheck / test / lint / compile
- [ ] 真机验证

## 遗留

- 真机验证

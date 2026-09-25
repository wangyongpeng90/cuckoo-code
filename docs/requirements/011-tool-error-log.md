---
id: 011
type: feat
title: 工具失败日志（仅开发版，长期保留）
status: review
branch: feat/011-tool-error-log
created: 2026-09-25
updated: 2026-09-25
---

## 背景

想通过日志分析"AI 调用工具时哪里容易出错"，以便针对性优化工具。
现有日志（`userData/wyp/log/<provider>.log`）**每次启动清空**，且混着所有输出，不便分析。

## 目标

把"工具调用失败"单独记到文件，**长期保留**，便于事后统计与排查：

- 记录**脚本级失败**（语法错/超时/沙箱错）与**工具级失败**（read/edit 等返回失败）
- **按工具分文件**（`edit.log` / `read.log` / `_script.log`…）
- **仅开发版**（`!app.isPackaged`）——打包版不写
- 记录：时间、工具名、参数、错误、**AI 执行的完整 JS 代码**、项目目录、窗口 ID、耗时

## 方案

### 1. 新建 `src/infra/tool-error-log.ts`

- `writeToolError(tool, args, error, code, meta)`：写一条
- `logRun(code, failures, scriptError, meta)`：一次运行结束后统一写
  - 每个工具级失败 → 写对应 `<工具名>.log`
  - 脚本级失败 → 写 `_script.log`
- 位置：`userData/wyp/log/tool-errors/<工具名>.log`
  - **子目录**不被启动清空逻辑影响（清空只扫 `log/*.log` 一层）→ **天然长期保留**
- **仅开发版**：`!app.isPackaged`
- 代码超长截断（5000 字符）
- 文件名为工具名（防路径穿越，非法字符替换为 `_`）

### 2. `JsRunner.ts` 接入

- `hostBridge` 里收集**工具级失败**（`success === false` 或抛错）
- `run()` 成功/失败时调 `logRun`（成功带工具失败列表；失败另带脚本级错误）

### 3. 格式（分块）

```
=== [ISO时间] 工具=edit ===
时间: ...
工具: edit
projectDir: ...
windowId: ...
耗时ms: ...
错误: ...
参数: {...}
AI 代码:
<完整 JS>
```

## 验收标准

- [x] 开发版下，工具失败写入 `tool-errors/<工具名>.log`
- [x] 脚本级失败写入 `tool-errors/_script.log`
- [x] 打包版不写（`app.isPackaged` 为真时）
- [x] 启动清空逻辑不影响 `tool-errors/`（子目录）
- [x] 代码超长截断（5000 字符）
- [x] typecheck / test / lint / compile 全绿
- [ ] 真机验证（待开发版实际触发一次工具失败）

## 遗留

- 真机验证
- 日志轮转（单文件过大时）暂不做

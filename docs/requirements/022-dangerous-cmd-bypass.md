---
id: 022
type: fix
title: 危险命令检测增强（前缀/通配符/长选项）
status: draft
branch: fix/022-dangerous-cmd-bypass
created: 2026-10-06
updated: 2026-10-06
---

## 背景

PR #30（需求 009 之后）已让 `isDangerous` 按 shell 控制符（`&& || ; | &` 换行）拆分复合命令逐段匹配，
修掉了 `echo hi && rm -rf /` 这类绕过。但实测仍有 4 类绕过：

- `sudo rm -rf /` —— 前缀修饰词（sudo/env/nohup/command 等）使 `^rm` 锚定失效
- `rm -rf /*` —— 通配符 `*` 跟在 `/` 后，正则要求 `/` 后为空白或行尾
- `rm -rf --no-preserve-root /` —— 只认 `-rf` 短选项，长选项 `--` 不匹配
- `rm --recursive --force /` —— 同上

这 4 类属于"该拦没拦"，不是黑名单的固有局限（`cmd /c "..."`、变量展开那类），应当修复。

## 目标

`isDangerous` 能拦截上述 4 类绕过，且不误伤正常命令（`npm install`、`rm -rf ./dist` 等）。

## 方案

在 `splitShellSegments` 拆分后，对每个分段做**前缀剥除**再匹配：
1. 剥除前导修饰词：`sudo`、`env`、`nohup`、`command`、`time` 等（可选带其参数）
2. 危险模式改进：
   - `rm`：支持任意顺序/组合的短选项、`--recursive`/`--force` 长选项、`--no-preserve-root`
   - 目标目录：`/`、`/*`、`~`、`~/`、`$HOME` 等
3. 保持"只拦高危目标"原则，`rm -rf ./build` 不拦

## 验收标准

- [ ] `sudo rm -rf /` / `rm -rf /*` / `rm -rf --no-preserve-root /` / `rm --recursive --force /` 全部拦截
- [ ] `echo hi && sudo rm -rf /` 等复合形式也拦截
- [ ] `rm -rf ./dist` / `npm install` / `sudo npm test` 不误伤
- [ ] 补充单元测试（含上述全部用例）
- [ ] typecheck / test / lint 全绿

## 遗留 / 后续

- 黑名单固有局限仍在（`cmd /c "..."`、变量展开、脚本文件），生产应叠加白名单/确认

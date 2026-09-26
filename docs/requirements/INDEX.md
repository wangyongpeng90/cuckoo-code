# 需求索引

> 本文件由 scripts/build-docs-index.mjs 自动生成，请勿手改。
> 新增/更新需求后运行：npm run docs:index

| ID | 类型 | 标题 | 状态 | 分支 | 更新 |
|---|---|---|---|---|---|
| 001 | feature | [窗口地址栏](./001-address-bar.md) | done | feat/address-bar | 2026-09-21 |
| 002 | fix | [AI 回复中断的检测与自动重试](./002-interrupt-retry.md) | done | — | 2026-09-21 |
| 003 | feature | [工具调用执行遮罩](./003-tool-execution-mask.md) | done | feat/003-tool-execution-mask | 2026-09-21 |
| 004 | fix | [看门狗改为 SSE 流静默检测](./004-watchdog-stream-idle.md) | done | fix/004-watchdog-criteria | 2026-09-25 |
| 005 | refactor | [压缩改用「清 IDB + 刷新」获取完整历史](./005-compact-idb-refresh.md) | done | refactor/005-compact-idb-refresh | 2026-09-25 |
| 006 | refactor | [hook 性能优化（消除高频写入与 O(n²)）](./006-hook-perf.md) | done | refactor/006-hook-perf | 2026-09-25 |
| 007 | feature | [工具执行遮罩加「停止」按钮（取消回传）](./007-tool-mask-cancel.md) | done | feat/007-tool-mask-cancel | 2026-09-25 |
| 008 | feature | [启动时恢复最后活跃的窗口](./008-restore-last-window.md) | done | feat/008-restore-last-window | 2026-09-25 |
| 010 | refactor | [换行符处理对齐 dsh（LF 归一化）](./010-eol-normalize.md) | done | refactor/010-eol-normalize | 2026-09-25 |
| 011 | feat | [工具失败日志（仅开发版，长期保留）](./011-tool-error-log.md) | done | feat/011-tool-error-log | 2026-09-25 |
| 012 | feat | [Skill 支持（对齐 Claude Code，纯文件驱动）](./012-skills.md) | done | feat/012-skills | 2026-09-25 |
| 013 | feat | [窗口默认打开（多选）+ 记录大小位置](./013-window-auto-open.md) | done | feat/013-window-auto-open | 2026-09-25 |
| 014 | feat | [地址栏下方显示当前对话 token 量](./014-shell-token-bar.md) | done | feat/014-shell-token-bar | 2026-09-26 |
| 015 | feat | [token 按会话缓存 + 去掉高频轮询（改主进程推送）](./015-token-cache-no-poll.md) | done | feat/015-token-cache-no-poll | 2026-09-26 |
| 016 | feat | [子代理（Subagents，对齐 Claude Code）](./016-subagents.md) | done | feat/016-subagents | 2026-09-26 |

共 15 个需求。

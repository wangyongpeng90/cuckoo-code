---
id: 261031-x7k9p2
type: feature
title: AI 用量统计图表（发送/回复/Token 趋势）
status: doing
branch: feat/261031-x7k9p2-ai-usage-stats
created: 2026-10-31
updated: 2026-10-31
---

## 背景

用户希望直观地看到每天/时/分的 AI 使用情况，包含发送量、回复量和 Token 消耗量趋势。

## 需求细节

1. **数据表**：在 SQLite 新增 `ai_usage_logs` 表。
   - 记录粒度：精确到秒（发送时间、回复时间独立成行，扁平事件流）。
   - 支持全平台（DeepSeek / ChatGPT / Claude），只有 DeepSeek 有 Token 数据。
   - Token 字段分 `total_token`（累计上下文）和 `diff_token`（本次消耗差值）。
2. **打点记录**：
   - 发送时：触发 `send` 事件。
   - 收到完整回复/报错/停止时：触发 `reply` 事件。
3. **图表展示**：
   - 放在「设置」页，使用 ECharts（全量引入）。
   - 三条曲线：发送数量、回复数量、Token 消耗量。
   - 双 Y 轴（左：数量，右：Token 数）。
   - 时间粒度切换：天 / 时 / 分。

## 验收标准

- 发送消息和收到回复时，数据库正确记录。
- 差值 Token 计算准确（当前 total - 上次 total）。
- 设置页图表正常渲染，切换粒度顺畅。
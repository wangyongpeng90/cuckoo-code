---
id: 261104-oocqpd
type: feature
title: DeepSeek 工具 API 定义改为系统说明书附件
status: doing
branch: feat/261104-oocqpd-deepseek-tool-spec-attachment
created: 2026-11-04
updated: 2026-11-04
---

## 背景

当前 DeepSeek 的系统提示词会把工具 TypeScript API 定义注入正文。工具定义较长，希望将其从正文拆出，作为独立附件提供给 DeepSeek 阅读。需求限定只调整 DeepSeek，其他 Provider 的提示词和行为保持不变。

## 目标

1. DeepSeek 系统提示词拆分为文本提示词和文件附件两部分。
2. 附件固定命名为 cuckoo系统说明书.md，内容来自当前运行环境解析到的完整工具 API TypeScript 定义。
3. 文本提示词和附件在同一条消息中发送，不分成两条消息。
4. 附件上传成功后才触发原有提示词发送流程；上传失败时停止发送并明确返回错误。
5. 保留 extraPrompt、压缩续接等现有消息合并行为。
6. 其他 Provider 的提示词正文和发送行为不变。

## 方案

1. DeepSeek 模板中将工具 API 类型定义正文替换为阅读附件的说明。
2. 在提示词组装层仅对 DeepSeek 特殊处理，不再把完整 TS 定义注入 DeepSeek 正文；其他 Provider 维持原逻辑。
3. 在项目初始化发送流程中，读取 resolveToolSpec() 指向的真实 API 定义文件，生成临时 Markdown 文件，文件名为 cuckoo系统说明书.md。
4. 通过现有 attachFile 工具上传附件，使用当前项目目录和窗口 ID。确认上传成功后清理临时文件，再触发 initial-prompt。
5. 上传失败时不发送系统提示词，返回清晰错误；不回退为把 TS 定义塞回正文。
6. 不手动修改 api.d.ts 等生成文件，不修改通用输入框发送逻辑、attachFile 工具契约和其他 Provider。

## 验收标准

- [ ] 新建需求分支和档案，档案索引成功刷新。
- [ ] DeepSeek 正文不再包含完整工具 API TypeScript 定义，并明确要求阅读附件。
- [ ] 附件名准确为 cuckoo系统说明书.md，内容与当前 resolveToolSpec() 解析到的 API 定义一致。
- [ ] DeepSeek 的文本提示词和附件随同一条消息发送。
- [ ] 附件上传失败时停止发送提示词，并返回可识别的错误信息。
- [ ] extraPrompt 和压缩续接行为保持原有合并方式。
- [ ] 其他 Provider 的提示词和发送行为不变。
- [ ] typecheck、test、lint、compile 检查通过。
- [ ] 真机验证 DeepSeek 页面能正常显示附件并读取其内容。

## 遗留 / 后续

- 尚未验证 DeepSeek 当前页面的文件上传入口是否兼容现有 attachFile 实现，需真机验证。
- Harness 使用独立初始化消息通道，本需求暂不改动该通道；如实际使用场景要求覆盖 Harness，再单独评估。
- 实现完成后补充关键决策、落地位置和验证结果，并更新档案状态。

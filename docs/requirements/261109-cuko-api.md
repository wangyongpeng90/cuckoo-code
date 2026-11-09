---
id: 261109-cuko-api
type: feature
title: Cuko API 客户端与独立工作窗口
status: draft
branch: feat/261109-cuko-api
created: 2026-11-09
updated: 2026-11-09
---

# Cuko API 客户端与独立工作窗口

## 背景

Cuckoo 当前作为 Agent 工具，强依赖内嵌网页解析来获取 AI 回复。为了将 Cuckoo 转变为完全纯粹的 Agent 工具，我们需要支持通过 **Cuko API** 调用外部的 Stateful Provider（如浏览器扩展、本地服务或远端 API）。

Cuko API 是一套纯粹的增量交互协议：客户端只发送当前用户的提示词（支持多模态文件），由 Stateful Provider 维护上下文并流式返回结果。

## 目标

1. 在 Cuckoo 侧实现 Cuko API 的客户端调用逻辑（HTTP + SSE）。
2. 提供一个完全独立的 Cuko 工作窗口（UI），不影响现有的主界面和侧边栏。
3. 使用 `assistant-ui` 作为聊天界面组件。
4. 提供一个类似 DSH 风格的设置面板，用于配置中转地址、Token、拉取模型列表等。
5. 确保该功能的代码和构建产物与主应用隔离，为未来剥离成独立组件做准备。

## 方案

- **UI 层**：新建独立的 `src/ui/cuko/` 目录，使用 React + `assistant-ui` 编写。通过独立的 `build-cuko.mjs` 脚本打包成单独的 HTML/JS/CSS，主进程用独立的 BrowserWindow 加载。
- **业务层**：新建 `src/cuko-client/` 模块，封装 HTTP/SSE 请求逻辑，不依赖网页解析，不依赖现有 Provider 系统。
- **协议层**：严格遵循 `docs/protocols/cuko-api-v1.md` 的契约进行请求和解析。

## 验收标准

- [ ] 主界面侧边栏和原有功能 100% 保持不变。
- [ ] 能够打开独立的 Cuko 窗口，UI 风格与 Cuckoo 整体一致。
- [ ] 能够配置中转地址、Token，并成功拉取模型列表。
- [ ] 能够通过 `assistant-ui` 发送消息，并正确解析 SSE 流式事件（包含新建和续接对话）。
- [ ] 支持传入多模态文件（Base64）。
- [ ] `typecheck / test / lint / compile` 全绿。

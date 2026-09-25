# 待办清单（Backlog）

> 收集所有"想做但还没做"的事。**做之前先看本文件**，做完把它挪到"已完成"或删掉。
> 每条尽量写清：**是什么 / 为什么 / 怎么算完成**。
> 需要动手时，用提示词 `docs/prompts/work-backlog.md`。

---

## 🔴 高优先（影响质量/指标诚实）

### 1. 覆盖率口径修正 + 配置 Codecov

**现状**：重构后覆盖率从 70% 掉到 ~34%。**不是代码变差，是口径变了**——
`vitest.config.mjs` 的 `coverage.include` 是 `src/**/*.ts`（全部），而很多文件**强依赖 Electron 运行时、在 Node 测试环境根本跑不了**（`src/app/**`、`shell-preload` 等），永远 0%，把平均值拉低。

**要做的**：
- [ ] `vitest.config.mjs` 加 `coverage.exclude`，排除 Electron-only 文件（app/、*-preload、部分 ipc）
- [ ] 新建 `codecov.yml`（设合理阈值、忽略路径、允许覆盖率小幅波动）
- [ ] 确认 `@vitest/coverage-v8` 在 `devDependencies`（之前缺失，CI 覆盖率可能一直失败）
- [ ] 确认 `.github/workflows/coverage.yml` 正常上传

**完成标准**：Codecov badge 显示真实的"可测代码覆盖率"（预计 50~60%+），且 CI 稳定。

### 2. 补单元测试（B 计划）

**原则**（见 `docs/arch/06-testing.md`）：只写真实集成测试，不 mock 内部模块；可测的补，Electron-only 的标注跳过（靠真机验证）。

**可测但未覆盖的（优先）**：
- [ ] `src/session/compaction.ts`（压缩流程的纯逻辑：ID 提取、消息 id 处理）
- [ ] `src/mcp/config.ts`（配置读写、启用状态）
- [ ] `src/overlay/chat-input.ts`（输入框查找、延迟计算等纯逻辑）
- [ ] `src/overlay/panels/window-manager.ts`（列表渲染逻辑）
- [ ] `src/overlay/panels/mcp-manager.ts`（JSON 校验逻辑）
- [ ] `src/providers/hooks/*.ts` 的纯函数（如 deepseek 的 `resolveStatus`）

**失败路径（重点，D20 教训）**：
- [ ] 各工具的异常分支（参数缺失、文件不存在、命令失败）
- [ ] `retry.ts` 的退避/计数边界
- [ ] `watchdog.ts` 的会话切换/暂停

**跳过（标"需真机验证"）**：
`src/app/**`、`attach-file`、`open-browser-window`、`browser-window-manager`、`updater/**`

---

## 🟡 中优先（体验/一致性）

### 3. 中断判定扩展到 claude / chatgpt

**现状**：`resolveStatus` 的"服务端截断→重试"判定只在 deepseek hook。

**要做的**：
- [ ] 研究 claude/chatgpt 的流式结束特征，识别"截断"
- [ ] 在对应 hook 实现

### 4. 清理诊断代码

**现状**：`deepseek.ts`（dbg/snapshot/statusFrames）与 `observer.ts`（诊断 log）留有调试代码。

**要做的**：
- [ ] bug 稳定不复现后，清理 dbg/snapshot/statusFrames 与诊断日志
- [ ] 保留 thinkLen/textLen（真实逻辑）

### 5. README 修正

- [ ] 删"项目结构"里的 `main.js` / `preload.js`（已不存在）
- [ ] 工具表补 `attachFile`
- [ ] 工具示例的 `src/utils/` 路径改掉
- [ ] "自动重试"描述过时（现有两个机制）
- [ ] "主要功能"补：地址栏、工具遮罩、上下文压缩
- [ ] Node 版本统一（README 写 22，engines 写 16）
- [ ] allowScripts 提示过时

### 6. 清理历史分支

**现状**：60+ 本地分支 + 40+ 远程分支。

**要做的**：
- [ ] 列出"已并入 master 的分支"，批量删除
- [ ] 保留有未合并提交的

### 7. 系统提示词长度控制（防超输入框上限）

**现状**：系统提示词是**拼接式**的——工具 API 类型定义、工具清单、工具说明、MCP、项目介绍、（即将做的）技能清单等，全部拼进一个 prompt。而**网页版 AI 的输入框有最大长度限制**。随功能累积，prompt 有**超过上限**的风险，导致初始化/发送失败。

**要做的**：
- [ ] 评估各 provider（deepseek/claude/chatgpt）输入框的实际上限
- [ ] `buildPrompt` 末尾做长度预算：超限时按优先级裁剪低价值内容（如工具 API 类型定义可截断）
- [ ] 技能清单设上限（对齐 Claude Code 的 1536 字符截断）
- [ ] 超限时给可诊断的日志/提示

**完成标准**：prompt 长度有硬上限保障，任何 provider 都不会因超长失败。

---

## 🟢 低优先（长期/技术债）

### 8. ESLint 覆盖 .ts（D22 遗留）

**现状**：`eslint.config.js` 只查 `*.js`/`*.mjs`，`src/**/*.ts` 未 lint，依赖护栏对 .ts 无效。**阻塞**：typescript-eslint 与 TS7 不兼容。
- [ ] 待 typescript-eslint 支持 TS7 后配置

### 9. AOP 重赋值改造

**现状**：`retry.ts` 用 `let foo = function(){}` + `withLog` 重赋值，与类型系统别扭。
- [ ] 考虑换成显式包装或移除

### 10. 工具 API 契约类型化（D12 深化）

- [ ] 评估：让工具声明真实 TS 类型，构建期同时生成 `api.d.ts` + JSON Schema（避免漂移）

### 11. 其它想法（持续添加）

> 以后有什么想法，都写在这里。

- [ ] （示例）快捷键自定义
- [ ] （示例）深色/浅色主题

---

## 已完成

- [x] 架构重构 P0–P5
- [x] 窗口地址栏
- [x] 工具调用执行遮罩
- [x] AI 回复中断自动重试（deepseek）
- [x] 需求档案机制 + 架构文档

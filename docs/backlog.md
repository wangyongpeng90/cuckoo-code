# 待办清单（Backlog）

> 收集所有"想做但还没做"的事。**做之前先看本文件**，做完把它挪到"已完成"或删掉。
> 每条尽量写清：**是什么 / 为什么 / 怎么算完成**。
> 需要动手时，用提示词 `docs/prompts/work-backlog.md`。

---

## 🔴 高优先（影响质量/指标诚实）

### ~~1. 覆盖率口径修正 + 配置 Codecov~~ ✅ 已完成（2026-09-26）

**结果**：
- `vitest.config.mjs` 加 `coverage.exclude`（排除 `src/app/**`、`bridge/entry.ts`、`bridge/api.ts`、注入式 hooks、`updater/**`、`*.d.ts`）
- 新建 `codecov.yml`（project target: auto + threshold 2%；patch target 50%）
- 修复 `.github/workflows/coverage.yml` 上传路径（`./coverage.lcov` → `./coverage/lcov.info`，原路径错误）
- 确认 `@vitest/coverage-v8` 已在 devDependencies
- 顺带：`testTimeout/hookTimeout` 放宽到 30s（治 coverage 插桩下 beforeAll 超时的 flaky）

**口径修正**：31.73% → **45.23%**（Stmts），CI 将显示真实"可测代码覆盖率"。

### 2. 补单元测试（B 计划）

**原则**（见 `docs/arch/06-testing.md`）：只写真实集成测试，不 mock 内部模块；可测的补，Electron-only 的标注跳过（靠真机验证）。

**已补（2026-09-26，+40 测试，覆盖率 45.2% → 50.1%）**：
- [x] `src/session/compaction.ts`（`_pickRecentPairedIds`：parent_id 回溯、成对裁剪、分支/回退/边界）
- [x] `src/mcp/config.ts`（读写、upsert stdio/http、启停、删除、覆盖；mock electron app.getPath）
- [x] `src/overlay/chat-input.ts`（randomDelay 边界、isInputVisible、findInputArea 兜底）
- [x] `src/overlay/panels/window-manager.ts`（空列表/平台名映射/autoOpen/失败兜底）
- [x] `src/overlay/panels/mcp-manager.ts`（handleMcpSave 的 8 条校验失败路径 + 成功 upsert/删除旧 server）

**仍可补（可选）**：
- [ ] `src/providers/hooks/*.ts` 的纯函数（如 deepseek 的 `resolveStatus`）—— 嵌套在 IIFE 内，需先导出才能测

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

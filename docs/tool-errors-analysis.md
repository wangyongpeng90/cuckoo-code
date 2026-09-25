# 工具调用错误分析（第 1 批）

> 数据来源：`userData/wyp/log/tool-errors/`（仅开发版收集）
> 收集时间：2026-09-25
> 归档位置：`userData/wyp/log/tool-errors-archive/2026-09-25/`

## 一、本批概况

| 工具 | 条数 | 性质 |
|---|---|---|
| `edit` | 1 | AI 用法问题 |
| `glob` | 1 | **工具缺陷（已修）** |
| `grep` | 1 | AI 用法问题 |
| `mcpCall` | 6 | MCP 用法问题（靠提示词改善） |
| `_script` | 4 | 2 条**工具缺陷（已修）** + 2 条**新问题** |

## 二、逐条分析

### 1. edit：oldString 与 newString 相同

错误: `oldString and newString must differ`
参数: `oldString="updated: 2026-09-25", newString="updated: 2026-09-25"`

- **原因**：AI 没先 read 确认当前值，凭记忆改（恰好值一样）。
- **性质**：AI 用法问题，非工具缺陷。工具报错正确。
- **对策**：无（工具描述已提醒先 read）。

### 2. glob：空路径报错 ✅ 已修

错误: `Glob 搜索失败: path must be a non-empty string when given`
参数: `{ pattern: "**/settings*", path: "" }`

- **原因**：AI 传空字符串路径表示「不限定」，旧代码视为非法。
- **性质**：**工具缺陷**（对常见 AI 输入不够宽容）。
- **修复**：glob/grep 空字符串/空白路径视为「未提供」，用默认项目根（提交 e0cb714）。

### 3. grep：搜索不存在的文件

错误: `rg: src/tools/impl/mcp.ts: IO error: 系统找不到指定的文件`

- **原因**：AI 猜了个文件路径（实际是 mcp-call.ts / mcp-query.ts）。
- **性质**：AI 用法问题（路径错）。工具报错正确。
- **对策**：无（AI 应先 glob/read 确认路径）。

### 4. mcpCall：6 条（playwright）

| 错误 | 原因 | 性质 |
|---|---|---|
| `expected string, received undefined → at target` | AI 参数名写错（用 element/ref，工具要 target） | AI 用法（未先查参数） |
| `Ref e193/e55/... not found` ×3 | AI 用了过期的快照 ref | AI 用法（未重拍快照） |
| `strict mode violation: .fav-btn resolved to 6 elements` | CSS 选择器匹配多个 | AI 用法（选择器不唯一） |
| `net::ERR_CONNECTION_REFUSED at localhost:5173` | 网站没启动 | 环境问题（非工具 bug） |

- **性质**：几乎全是「AI 不会用 playwright」，非工具缺陷。
- **对策**：MCP 提示词改为通用「先查后用」强制流程（提交 5391e55）——调用任何 MCP 工具前必须先 mcpGetTools 查参数。

### 5. _script：4 条

#### 5.1 setTimeout is not defined ✅ 已修

错误: `setTimeout is not defined`
代码: `await new Promise(r => setTimeout(r, 2500));`

- **原因**：沙箱是干净 vm context，没有计时器。
- **性质**：**工具缺陷**（能力缺失）。
- **修复**：沙箱注入 sleep / setTimeout / clearTimeout（提交 e0cb714）+ 提示词说明。

#### 5.2 JS 脚本执行超时（60 秒）×2 ⚠️ 新问题，待处理

错误: `JS 脚本执行超时（60 秒）`
代码: `await pwsh(\`... Start-Sleep -Seconds 60 ...\`, { timeoutMs: 120000 })`

- **原因**：AI 用 pwsh 跑长命令（如 Start-Sleep 60 秒），**但 JS 脚本整体有 60 秒硬上限**（JsRunner 的 RUN_DEADLINE）——AI 传 `timeoutMs: 120000` 无效，脚本 60 秒必被杀。
- **性质**：**工具设计矛盾**（bash/pwsh 超时参数 vs 脚本整体上限）。
- **对策（待定）**：
  1. 提示词告知 AI：单次脚本总时长上限 60 秒，别写长命令
  2. 或把长命令拆成「后台启动 + 轮询」，避免阻塞
  3. 或提高 RUN_DEADLINE（有风险）

## 三、结论

- **真正的工具缺陷**：glob 空路径（已修）、沙箱无计时器（已修）
- **AI 用法问题**：edit 空改、grep 路径错、mcpCall 参数/ref 错——靠提示词改善
- **新暴露的矛盾**：pwsh 长命令 vs 脚本 60 秒上限——**待处理**

## 四、后续观察方法

1. 代码继续往 `tool-errors/` 收集（仅开发版）
2. 过一段时间看**新日志**里哪些错误**重复出现**——重复的才值得投入改工具
3. 一次性的用法错误，不必专门处理

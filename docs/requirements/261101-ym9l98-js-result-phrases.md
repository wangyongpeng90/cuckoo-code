---
id: 261101-ym9l98
type: feature
title: 工具结果回传文案拟人化（含跨窗口通用存储与 read 首行模板）
status: review
branch: feat/261101-ym9l98-js-result-phrases
created: 2026-11-01
updated: 2026-11-01
---

# 工具结果回传文案拟人化

## 背景

工具执行结果回传给 AI 时，消息结构是硬编码的：

```
【JS 执行结果汇总】(共 N 个脚本)

—— 脚本 1 ——
✅ 成功
<输出>
```

三处固定文案：消息头、每段脚本的标题行、成败标记。每次回传一字不差，用户希望在**设置里可配置**，并可预置大量拟人化文案随机选用。

## 目标

1. **消息头可配置**：从「文案池」随机取一条，支持 `{n}`（脚本总数）占位符
2. **脚本标题可配置**：从「模板池」随机取一条（整条消息抽一次，同批风格统一），支持 `{i}`（序号）、`{r}`（成功/失败）
3. **成败融入标题**：不再单独占一行，去掉 ✅/❌ 符号
4. **两池都走设置**：壳页面设置页可编辑，一行一条；池为空回退内置默认
5. **简化失败回传**：去掉「请修正 JavaScript 代码后重新输出…」与「本次实际执行的代码(前300字符)」

## 方案

### 数据层

新增 `src/overlay/js-result-phrases.ts`（纯数据 + 纯函数，无 DOM/electron 依赖，可被 AI 页面与壳页面同时消费）：

| 导出 | 说明 |
|---|---|
| `DEFAULT_JS_RESULT_PHRASES` | 内置头部文案（当前 10 条示例） |
| `DEFAULT_JS_RESULT_ITEM_TEMPLATES` | 内置标题模板（10 条，含成对与单句两种写法） |
| `JS_RESULT_PHRASES_KEY` / `JS_RESULT_ITEM_TEMPLATES_KEY` | localStorage 键名 |
| `pickJsResultPhrase(n)` | 随机取头部文案并替换 `{n}` |
| `pickJsResultItemTemplate()` | 随机取标题模板（不替换） |
| `formatJsResultItemTitle(tpl, i, success)` | 替换 `{i}`/`{r}`，成对写法按成败取侧 |

**占位符**：

| 占位符 | 含义 |
|---|---|
| `{n}` | 本次脚本总数（仅头部文案） |
| `{i}` | 当前脚本序号，1 起 |
| `{r}` | 成功 / 失败（单句写法用） |
| `\|` | 成对写法分隔：左=成功整句，右=失败整句 |

**回退规则**：localStorage 为空 / 只有空行 / 读取抛错 → 一律回退内置默认。

### 标题模板两种写法

1. **成对写法** `成功侧|失败侧`：两侧各写完整句子，按成败取对应一侧，不再额外追加
2. **单句写法**：`{i}` 与 `{r}` 替换；漏写 `{r}` 时末尾自动补「成功/失败」（保证不丢结果）
3. **畸形数据**（某一侧为空）：退化为单句写法并补成败

### 消费方

- `src/overlay/chat-input.ts` → `sendCombinedJsResultsToChat`
  - 头部：`pickJsResultPhrase(results.length)`
  - 循环外抽一次标题模板；循环内 `formatJsResultItemTitle(tpl, i + 1, ok)`
  - 成功只输出内容；失败只输出「错误原因: xxx」
- `src/overlay/panels/settings.ts` → `SettingsData` 增加两个字段，读/写/重置三处同步
- `src/ui/shell/scripts/pages/settings-react.tsx` → 「工具结果回复语」分类下两个 textarea，各配「填入内置默认」「清空」

### 构建

`scripts/build-shell.mjs` 增加 `tsJsResolve` 插件（与 `build-hooks.mjs` 同款），让壳页面脚本能 `import .../*.js` 解析到 `.ts` 源。**未新增生成物**，普通 TS 模块经 tsc 编译即可。

### 设置项

| localStorage 键 | 内容 |
|---|---|
| `cuckoo-js-result-phrases` | 头部文案池，一行一条，`{n}` 占位 |
| `cuckoo-js-result-item-templates` | 标题模板池，一行一条，`{i}`/`{r}`/`\|` |

**首次呈现**：未自定义时设置页显示内置全文（副本模型）；保存后落 localStorage。
**归一化**：读取与保存时逐行归一化——成对写法原样保留，单句缺 `{r}` 时补齐。

## 验收标准

- [x] 消息头随机取自池；`{n}` 正确替换为脚本总数
- [x] 标题模板整条消息抽一次，同批脚本风格统一
- [x] `{i}`、`{r}` 正确替换；成对写法按成败取侧
- [x] 单句写法漏写 `{r}` 时自动补成败，不丢信息
- [x] 池为空 / 读失败 → 回退内置默认，不崩溃
- [x] 设置页两个 textarea 可编辑，改动即时保存
- [x] 「填入内置默认」「清空」按钮可用
- [x] 恢复默认清空两个键
- [x] 失败回传不再含「请修正 JavaScript 代码…」与「本次实际执行的代码…」
- [x] 单元测试覆盖：占位符替换、成对/单句、畸形数据、回退、随机性（24 用例）
- [x] `npm run compile` / `typecheck` / `test` 全绿

## 决策记录

### D1 池的编辑形态：多行文本框，一行一条
与既有 `aiInterceptPatterns` 同构，1000 条可一次粘贴；可视化列表需处理增删改与焦点，成本不划算。

### D2 池为空时回退内置默认（而非报错或退化到旧固定文案）
报错会让工具结果发不出去、agent 循环卡死；退化旧文案则功能静默失效。

### D3 内置文案放独立 TS 模块，不改构建
消费方都在 overlay（tsc 编译），同层 import 零成本；仅 hook 与模板需要内联成字符串，此处不需要。

### D4 用户池覆盖内置（非追加、非开关）
语义直白：设置里写什么就发什么。想要追加，用户自行粘贴内置内容再补即可。

### D5 只支持 `{n}`，不支持 `{ok}`/`{fail}`
成败已由明细承担；占位符越少，用户写文案越自由。

### D6 只改头部与标题，明细（脚本分隔、输出、错误原因）不动
明细是 AI 解析成败的准绳，拟人化会引入误判。

### D7 标题模板整条消息抽一次，而非每段独立随机
多段脚本时风格统一，避免同屏三种语气；跨消息随机性已满足诉求。

### D8 整行即最终输出，装饰符由模板自带
代码不额外拼 `——`，用户可自由写 `【{i}】`、`第 {i} 块`、`{i}.` 等。

### D9 成败融入标题，去掉 ✅/❌
用户要求「不换行」，成败作为 `{r}` 进标题。为避免丢信息，单句漏写 `{r}` 时末尾自动补。

### D10 成对写法 `成功侧|失败侧`，而非两个独立池
成败语义相反（"你看下" vs "得改改"），分开随机会撞出「失败，你看下」这种矛盾；成对书写保证协调，且不增加设置项。

### D11 带 `|` 的行不再要求 `{r}`
两侧已是完整句，再叠 `{r}` 会重复。规则一句话可讲清：**有 `|` = 两侧完整句；无 `|` = 单句 + `{r}`**。

### D12 删除「请修正…」与「本次实际执行的代码…」
用户明确要求去掉。失败段现在只剩「错误原因: xxx」，更简洁。

### D13 首次打开设置页显示内置全文（副本模型）
用户只要点过一次保存就锁定当时的内置内容，后续内置升级传导不到老用户——已知取舍，换取「所见即所发」的直观性。

## 落地位置

| 决策 | 位置 |
|---|---|
| 数据层与纯函数 | `src/overlay/js-result-phrases.ts` |
| 消费（组装消息） | `src/overlay/chat-input.ts` `sendCombinedJsResultsToChat` |
| 设置读写/迁移 | `src/overlay/panels/settings.ts` |
| 设置 UI | `src/ui/shell/scripts/pages/settings-react.tsx` |
| 壳页面构建插件 | `scripts/build-shell.mjs` |
| 测试 | `test/overlay/js-result-phrases.test.js` |
| 注释规则补充 | `docs/requirements/README.md`（「加在哪些位置」小节） |


## 扩展一：跨窗口通用存储（主进程 SQLite）

### 背景
原实现用 localStorage 存池，但 localStorage 按 profile partition 隔离——每个窗口一份，改一个窗口其他窗口不生效。用户要求「所有窗口通用一份」。

### 方案
三层结构：

| 层 | 位置 | 职责 |
|---|---|---|
| 主进程内存 Map | `src/app/settings-store.ts` | 运行时唯一真相源 |
| SQLite `meta` 表 | 键前缀 `setting:` | 持久化，重启不丢 |
| 渲染进程快照 | `src/overlay/shared-settings-cache.ts` | 同步消费（启动拉一次 + 广播刷新） |

tools 层通过 `injectSettingReader` 注入读取函数（遵守「tools 不可 import app」铁律）。

### 决策
- **D14 历史 localStorage 设置一律不动**：只迁本次新增的池，`cuckoo-retry-*` 等保持每窗口独立。改动面可控，风险最小。
- **D15 不用 `window.__cuckooSettings` 全局注入**：本次消费方只有 overlay（隔离世界，能直接用 electronAPI）和主进程（直接读内存），hook 一个都不读。为用不上的路径预建机制是纯负债。
- **D16 旧数据自动迁移**：DB 里没有、本机 localStorage 有上一版本存的池时，启动时一次性推到 DB。
- **D17 写后广播**：`cuckoo-shared-settings-changed` 推给所有窗口的 view / win / harnessView，各窗口整份替换快照。

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/app/settings-store.ts` | 内存 Map + meta 表读写 |
| `src/app/ipc/shared-settings.ts` | 3 个 IPC + 广播 |
| `src/overlay/shared-settings-cache.ts` | 渲染侧快照 + 迁移 + 订阅 |
| `src/app/entry.ts` | 初始化 + `injectSettingReader` |

## 扩展二：read 工具首行口语化

### 背景
`read` 原输出 `<path>README.md</path><type>file</type><content>...</content>`，XML 味重。用户要求改口语化，且可配置。

### 方案
只改**首行元信息**，正文「行号: 内容」与结尾续读提示保持固定（AI 依赖它们解析行号与 offset）。

两套池：
- **完整文件**：占位符 `{path}` `{total}`
- **部分读取**：占位符 `{path}` `{start}` `{end}` `{total}` `{rest}`

### 决策
- **D18 正文行号格式不动**：`120: 代码` 一旦变化，AI 在后续 edit/引用行号时容易出错，收益远小于风险。
- **D19 首行 + 结尾都要可配**（原始讨论选 B）：两种情况句式差别大，硬塞进一个模板会啰嗦或丢信息。
- **D20 两个池不放「工具结果回复语」分类**：那是「回传给 AI 的消息文案」，read 首行是「工具自身输出」，层不同。新开「文件读取首行」分类。
- **D21 read.ts 用注入读设置**：tools 不可 import app，沿用项目已有的 `injectGoalDonePusher` 模式新增 `injectSettingReader`。

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/infra/read-header-templates.ts` | 两套模板池 + 渲染函数 |
| `src/tools/impl/read.ts` | 首行改用模板 + `injectSettingReader` |
| `src/ui/shell/scripts/pages/settings-react.tsx` | 新分类「文件读取首行」 |
| `test/infra/read-header-templates.test.js` | 7 个用例 |

## 扩展三：prompt 模板示例修正（P0）

`src/prompt/{deepseek,claude,chatgpt,default}.md` 的「系统返回」示例仍是旧格式（`【JS 执行结果汇总】` / `—— 脚本 1 ——` / `✅ 成功`），已改为当前真实格式。

**未改** `<path>/<type>/<content>`：那是 `write` 的真实返回，`write` 本次未改，示例保留才准确。


## 扩展四：工具输出 footer 也可配（5 个池）

### 背景
`read` 和 `glob` 的结尾 footer 原本是中英混杂的固定文案。既然首行已经可配，footer 同样每条结果都出现（一次任务可能调几十次 read），随机化的收益明显。

### 五套池

| 键 | 场景 | 占位符 |
|---|---|---|
| `cuckoo-read-footer-full` | read 读完整个文件 | `{total}` |
| `cuckoo-read-footer-partial` | read 未读完 | `{start}` `{end}` `{total}` `{next}` |
| `cuckoo-read-footer-capped` | read 字节超限 | `{start}` `{end}` `{next}` |
| `cuckoo-glob-footer-full` | glob 未截断 | `{count}` |
| `cuckoo-glob-footer-truncated` | glob 截断 | `{shown}` `{total}` |

`{next}` = 下一段起始行号（end + 1）。**内置模板均已把 `{next}` 包在 `offset=` 里**，因为 AI 要照着传参。

### 决策

- **D22 glob ignore note 不做池**：语义单一（"这些目录被忽略了，要搜就传 path"），随机化收益最低，反而增加池数量。
- **D23 5 个池，不是 1 个池 + 条件占位符**：`{all}`（完整时填充、部分时空）这类条件占位符规则难懂，用户容易写错。分开成独立池，语义清晰。
- **D24 设置页按工具分区**：「文件读取格式」= read 首行 2 个 + read 结尾 3 个；「文件搜索格式」= glob 结尾 2 个。改某个工具的观感时在同一分类里就能看全。
- **D25 glob 复用 read 的设置注入**：`read.ts` 导出 `readSettingRaw(key)` 供 `glob.ts` 使用，避免重复注入（两者都在 tools 层，互引合法）。

### 落地位置

| 文件 | 职责 |
|---|---|
| `src/infra/read-header-templates.ts` | 5 个新池 + 键名（原文件改名不改，仍是「工具输出格式模板」职责） |
| `src/tools/impl/read.ts` | footer 改走池；导出 `readSettingRaw` |
| `src/tools/impl/glob.ts` | footer 改走池（复用 read 的注入） |
| `src/ui/shell/scripts/pages/settings-react.tsx` | 「文件读取首行」→「文件读取格式」；新增「文件搜索格式」分类；`makeFooterBlock` 抽公共块 |
| `test/tools/*.test.js` | footer 断言改为检查结构（`offset=` 参数、行号、总数），不再检查具体措辞 |

## 扩展五：重试类提示词统一为「让 AI 继续」池

### 背景
原先散落 5 处独立的提示词，其中 3 处可配置（但仅单条）、2 处硬编码：

| 场景 | 原位置 | 原配置 |
|---|---|---|
| 请求失败自动重试 | `retry.ts` | `cuckoo-retry-prompt` |
| 流静默超时催继续 | `watchdog.ts` | `cuckoo-watchdog-prompt` |
| 手动「卡住了」按钮 | `overlay/events.ts` | 硬编码 |
| AI 输出 XML invoke | `observer.ts` | `cuckoo-ai-intercept-prompt` |
| AI 输出 JSON 工具调用 | `observer.ts` | 硬编码 |

### 方案
统一成一个 1000 条池 `cuckoo-continue-prompt`（`src/infra/continue-prompt-pool.ts`），5 处随机取。原 3 个独立配置项删除。

### 决策
- **D26 池只写「让 AI 继续」，不含格式要求**：用户确认。**代价**：XML/JSON 格式纠正场景下 AI 可能不知自己格式错了，反复触发后 `formatHintCount` 达 10 次上限则任务失败。这是有意取舍。
- **D27 删除旧 4 个函数**（`openSettings`/`closeSettings`/`resetSettings`/`saveSettings`）：查证 overlay.html 里已无对应 DOM，全是死代码（`events.ts` 里的 4 处按钮绑定空转）。
- **D28 池走通用设置（跨窗口共享）**，与前面几个池一致。

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/infra/continue-prompt-pool.ts` | 1000 条池 + `pickContinuePrompt()` |
| `src/bridge/entry.ts` | 注入 reader |
| `src/bridge/loop/retry.ts`、`watchdog.ts`、`src/bridge/intercept/observer.ts`、`src/overlay/events.ts` | 5 处调用点 |
| `src/overlay/panels/settings.ts` | 删旧字段，加 `continuePrompt` |
| `src/ui/shell/scripts/pages/settings-react.tsx` | 「失败自动重试」分类下加池编辑块 |
| `test/bridge/loop/retry.test.js`、`watchdog.test.js`、`test/overlay/panels/settings.test.js` | 断言更新 |

## 扩展六：edit 工具优化（P0~P3）

### 背景
`edit` 是最后一个未中文化的工具，且上一轮把 `getPromptSection()` 迁到 `apiMetas.usage` 时**丢了 7 行关键指导**——迁移脚本只取了首行，多行拼接版因 `oldString` 出现 2 次而替换失败，随后删除 `getPromptSection` 时该段内容一并消失。

### 四档改动

| 档 | 内容 |
|---|---|
| **P0** | 恢复丢失的 7 行 `usage`：空白/缩进提示、唯一匹配要求、replaceAll 建议、dryRun 预览、先 read 后 edit、行号/footer 警告 |
| **P1** | `formatEditOutput` / `formatDryRunOutput` 中文化（原为 `The file xxx has been updated` / `[DRY-RUN]`） |
| **P2** | doc 去掉「Claude-style 确认消息」；「未找到」错误补上「最常见原因是空白/缩进不一致」 |
| **P3** | 多匹配报错附上前 3 处行号（新增 `findOccurrencePositions` + `lineNumberOf`） |

### 输出对比

```
旧：The file a.txt has been updated. Replaced 3 occurrences successfully.
新：已更新 a.txt，替换了 3 处。

旧：[DRY-RUN] 文件未修改。a.txt：将全部替换 3 处。old: "x" → new: "y"
新：[预览] 文件未修改。a.txt：将全部替换 3 处。原内容 "x" → 新内容 "y"

旧：oldString 在文件中出现 3 次。若要全部替换，请设置 replaceAll: true...
新：oldString 在文件中出现 3 次（第 5、12、20 行）。若要全部替换，请设置 replaceAll: true...
```

### 决策
- **D29 `countOccurrences` 签名不变**：新增 `findOccurrencePositions` 供其内部调用，`countOccurrences` 仍是纯数字返回，既有测试断言（`countOccurrences('aaa','a') === 3`）无需改动。
- **D30 多匹配只报前 3 处行号**：超过 3 处时附「等」字。报全部会让错误信息过长，报 3 处已够 AI 定位。

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/tools/impl/edit.ts` | usage 恢复、输出中文化、错误信息增强、新增 2 个辅助函数 |
| `src/tools/api.d.ts` | 生成物，随 compile 更新 |
| `test/tools/EditTool.test.js`、`EditEol.test.js`、`FileTools.test.js` | 断言更新 + 新增 2 个测试 |

## 扩展七：pwsh 工具的 UTF-8 编码处理

### 背景（实测发现）
`pwsh` 工具完全没处理编码问题，三个实测结论：

| 场景 | 结果 |
|---|---|
| `Get-Content` 读 UTF-8 文件 | ❌ 乱码（`涓枃娴嬭瘯`）—— PowerShell 5.1 默认按 ANSI/GBK 读 |
| `Set-Content` 写中文 | ⚠️ 写成 GBK，我们自己的 `read` 读回来是 `��������ABC` |
| `Out-File` 写中文 | ⚠️ 同上，乱码更严重（UTF-16LE） |

**根因**：`bash.ts` 调用了 `normalizeCommand()`（会给 `Get-Content` 补 `-Encoding UTF8`），但 `pwsh.ts` 完全没调用；而且 `normalizeCommand` 的正则要求命令以 `powershell|pwsh` 开头，对 pwsh 工具（传入纯命令体）匹配不上。

**写入比读取更危险**：AI 用 pwsh 写文件后，自己的 `read` 读不回来，会误判写失败并重写，形成死循环。

### 方案（三条齐下）

1. **读取注入**：infra 抽出 `injectEncodingToBody(body)`，给 `Get-Content` / `Set-Content` / `Add-Content` / `Out-File` 补 `-Encoding UTF8`。pwsh.ts 在危险检查后调用。
2. **BOM 剥离**：PowerShell 5.1 的 `-Encoding UTF8` **必定写 BOM**（`EF BB BF`）。`read` / `readLines` 读取时用 `stripBom()` 去掉开头的 `\uFEFF`（只影响返回值，不改磁盘文件）。
3. **usage 提示**：告知 AI「读写文件请显式写 -Encoding UTF8」，并提示「PS 5.1 的 -Encoding UTF8 会写 BOM，对 BOM 敏感的格式（JSON/脚本）优先用 `[IO.File]::WriteAllText(路径, 内容, [System.Text.UTF8Encoding]::new($false))`」。

### 决策
- **D31 读+写都注入**：只修读会让问题从「读乱码」变成「写乱码」，更隐蔽。
- **D32 接受 BOM + read 剥离**：中文乱码是必然发生的显性故障，BOM 是可能发生的隐性故障。先保证不乱码，再用 `stripBom` 兜住我们自己的链路。
- **D33 已带 `-Encoding` 的命令整体不动**：宁可漏注，不覆盖用户的明确选择。
- **D34 `stripBom` 放 `infra/decode-output.ts`**：与 `decodeOutput` 同属「字节→文本」职责，不新建文件。

### 实测对比

```
读：Get-Content（无注入）        → 涓枃娴嬭瘯ABC    ❌
    Get-Content -Encoding UTF8  → 中文测试ABC      ✅
写：Set-Content（无注入）         → 9 字节，GBK     ❌ read 读回乱码
    Set-Content -Encoding UTF8  → 14 字节，UTF-8 带 BOM ⚠️ read 剥离后正常
```

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/infra/decode-output.ts` | `injectEncodingToBody` / `stripBom` / `ENCODING_SENSITIVE_CMDLETS` |
| `src/tools/impl/pwsh.ts` | 调用注入 + usage 补 BOM 提示 |
| `src/tools/impl/read.ts` / `read-lines.ts` | `stripBom` |
| `test/tools/decodeOutput.test.js` | 10 个新用例（注入 + stripBom） |
| `test/tools/FileTools.test.js` | BOM 剥离集成测试 |

## 扩展八：去除头部文案池的应答式前缀

### 问题
工具结果回传的消息**以"用户"身份注入聊天输入框**发给 AI。若头部文案以应答语开头（`好了，` / `OK，` / `嗯，` / `行，` / `好，` / `那，`），AI 可能先入为主地认为**用户在回答它上一轮的问题**，而不是「工具执行完了」。

真实风险场景：

| AI 上一条 | 工具结果回传 | AI 可能的误判 |
|---|---|---|
| 「要我改成 A 吗？」 | 「行，3 个脚本跑完了…」 | 「用户说行 = 同意 A」+ 工具结果 |
| 「需要我继续吗？」 | 「好，2 个活儿搞定…」 | 「用户说好 = 让我继续」 |
| 「两个方案你选哪个？」 | 「嗯，5 段代码执行完毕…」 | 「用户嗯了一声，但没选」 |

### 方案
把 327 条应答式前缀**替换**（不是删除整行）为非应答式前缀：

| 旧前缀 | 新前缀候选 |
|---|---|
| 好了，/ OK，/ 嗯，/ 行，/ 好，/ 那， | 刚才 / 刚刚 / 这次 / 这轮 / 已经把 / 顺手把 / 我把 / 上面这些 |

替换时保证不产生重复（用 `used` 集合去重）。

### 决策
- **D35 替换前缀而非删除整行**：用户明确要求保留模板，只改开头。
- **D36 新前缀全部指向"过去发生的动作"**：`刚才`/`刚刚`/`这次`/`这轮` 是时间限定，`已经把`/`顺手把`/`我把` 是动作主体，`上面这些` 是回指——都不会被理解成"对用户问题的应答"。

### 过程中的三次失败（记录教训）

| 次数 | 错误 | 根因 |
|---|---|---|
| 1 | 数组语法崩溃，92 测试失败 | 解析 TS 时忘去尾部 `'`，转义后每项多一层 `\'` |
| 2 | 找不到数组终点 | 用 `"\n];"` 匹配，文件是 CRLF |
| 3 | 生成出「这次来，」「刚才嘿，」等垃圾 | 「补齐到 1000 条」时素材筛选没排除已带前缀的行 |

**三次失败的总根源**：`readLines` 有 50KB 字节上限，而这个文件 82KB。我没检查返回的 `truncatedByBytes` 字段，把截断后的 848/948/940 条当成真实条数，后续所有逻辑都建立在错误数据上。

**教训**：读大文件必须检查 `result.truncatedByBytes`；为 true 时改用 `fs.readFileSync` 或分段读。

### 最终结果
| 项 | 值 |
|---|---|
| 条数 | 1000（去重 1000） |
| 应答式前缀 | **0** |
| 不含 `{n}` | 152 条（`部分脚本`/`手头这几段` 等模糊表达，正常） |
| 前缀 TOP5 | 这次 91 / 刚才 89 / 刚刚 81 / 这轮 80 / 已经把 74 |
| 连续标点、空条目 | 0 |

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/overlay/js-result-phrases.ts` | `DEFAULT_JS_RESULT_PHRASES` 全部替换前缀 |
| `src/ui/shell.html` | 生成物，随 compile 更新 |
| `wyp/vip/提示词文案/js-result-phrases.txt` | 同源素材（不在 git 跟踪） |

## 遗留

1. **未真机验证**：设置页 4 个池、跨窗口同步、read 首行效果均需 `npm start` 实机确认
2. **write / edit 输出仍是英文/XML**：`write` 返回 `<path>…</path><type>file</type>`，`edit` 返回 `The file … has been updated`。本次只改了 `read`，两者待后续统一
3. **其他硬编码提示语未配置化**：`prompt-builder.ts` 的「请继续你之前的工作」、`compaction.ts` 的摘要指令、`JsRunner.ts` 的无输出提示、`observer.ts` 的 JSON 格式提示、`glob.ts` 的 ignore note
4. **旧 overlay 设置弹窗**（`openSettings/saveSettings`）无对应 DOM，未在其中加入池的读写
5. **`src/ui/shell.html` / `src/tools/api.d.ts` 为生成物**，随 `npm run compile` 更新，不手改

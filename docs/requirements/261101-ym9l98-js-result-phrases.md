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

## 遗留

1. **未真机验证**：设置页 4 个池、跨窗口同步、read 首行效果均需 `npm start` 实机确认
2. **write / edit 输出仍是英文/XML**：`write` 返回 `<path>…</path><type>file</type>`，`edit` 返回 `The file … has been updated`。本次只改了 `read`，两者待后续统一
3. **其他硬编码提示语未配置化**：`prompt-builder.ts` 的「请继续你之前的工作」、`compaction.ts` 的摘要指令、`JsRunner.ts` 的无输出提示、`observer.ts` 的 JSON 格式提示、`glob.ts` 的 ignore note
4. **旧 overlay 设置弹窗**（`openSettings/saveSettings`）无对应 DOM，未在其中加入池的读写
5. **`src/ui/shell.html` / `src/tools/api.d.ts` 为生成物**，随 `npm run compile` 更新，不手改

# Changelog

## [0.7.0] - 2026-09-25

### Added
- **Skill 支持（对齐 Claude Code）**：纯文件驱动、无复杂界面。用户把技能写成
  `SKILL.md`（带 name/description 元数据）放到 `.cuckoo/skills/`（项目级）或
  `~/.cuckoo/skills/`（用户级），AI 按需加载执行。支持技能附带脚本（用现有 bash/pwsh 运行）。
  设置面板新增「发送skill信息」按钮可刷新技能清单。目录改为 `.cuckoo/`（兼容读旧 `.cuckooCode/`）。
- **窗口默认打开（多选）+ 记录大小位置**：窗口管理面板可为每个窗口勾选「默认」，
  启动时自动打开所有勾选的窗口（一个都没勾则回退上次活跃窗口）。
  关闭窗口时记录其大小、位置、（是否最大化）与最后访问的 URL，下次按记录恢复。
- **沙箱内可用 sleep / setTimeout**：AI 在 cuckoo 代码块里可直接 `await sleep(ms)`
  或 `new Promise(r => setTimeout(r, ms))`（如等页面加载、等操作生效）。

### Changed
- **换行符处理对齐 dsh（LF 归一化）**：编辑文件时读入归一化为 LF 匹配，写回恢复原风格；
  混合换行文件被规整为主导格式。替换旧方案（三级候选匹配）。
- **MCP 使用提示改为通用「先查后用」强制流程**：调用任何 MCP 工具前必须先
  `mcpGetTools` 查清参数，避免凭记忆猜参数导致失败（不硬编码任何具体 server）。
- **工具描述优化**：edit 强调跨行连续文本 + 注意空白缩进。
- **技能 / MCP 章节加引导语**：AI 可提示用户安装所需技能 / MCP。

### Fixed
- **压缩「不成对」修复**：长会话（含重新生成/编辑分支）压缩时，`share/create`
  报 MESSAGES_MUST_APPEAR_IN_PAIRS。改为沿 `parent_id` 回溯主对话链取消息。
- **设置面板无滚动条**：内容超出被 overflow:hidden 裁掉，现支持滚动。
- **glob/grep 空路径容错**：传空字符串/空白不再报错，视为"未提供"（用项目根）。

### Dev
- **工具失败日志（仅开发版）**：工具调用失败单独记到 `userData/wyp/log/tool-errors/<工具名>.log`，
  按工具分文件、长期保留，便于事后分析。

## [0.6.1] - 2026-09-23

### Added
- **启动恢复最后活跃窗口**：记住上次最后使用的窗口，重启后自动打开它（列表顺序不变）
- **工具遮罩「停止」按钮**：工具执行完等待回传时，可点击停止取消发送（待发内容保留在输入框）
- **限流自动重试**：DeepSeek 返回"操作过于频繁"（HTTP 429 / 业务码 40029）时，
  按"操作频繁"策略退避重试（默认 60 秒 / 20 次），不再误判为普通失败

### Changed
- **看门狗改为 SSE 流静默检测**：不再依赖"是否在工具循环"的猜测，直接监控流是否有数据；
  流静默超过阈值（默认 300 秒）才催 AI 继续，更准确
- **压缩流程改用「清 IDB + 刷新」**：让 DeepSeek 自己重建完整历史后再读取，
  数据更权威、摘要必然包含，去掉"从 SSE 补消息 id"的 hack
- **工具遮罩去掉 loading 光标**（`cursor: wait` → `default`）

### Fixed
- **hook 性能问题**：`cacheHeaders` 高频写 localStorage（去重 + 移到 send 时一次）、
  `fragmentTypes` 的 O(n²) 复制（改 push）、清理高频诊断日志、轮询仅在变化时执行

## [0.6.0] - 2026-09-21

> 本版为**架构重构版**：全仓 TypeScript + ESM + 目录按领域重组 + 工具契约自动生成。

### Added
- **窗口地址栏**：窗口改用 `WebContentsView` 架构，顶部提供地址栏
  （显示 URL、复制、粘贴跳转、前进/后退/刷新/主页）
- **工具调用执行遮罩**：工具执行期间对 AI 页面加全局遮罩，防止误操作干扰
- **AI 回复中断自动重试**：服务端截断（INCOMPLETE / 正文为空）时自动重发

### Changed
- **全仓迁移 TypeScript**：所有源码由 JS 迁移到 TS，编译产物输出到 `out/`；
  主应用开启 `strict` 模式（hook 作为独立编译单元，单独规则）
- **全面转向 ESM**：统一使用 ES 模块，原生动态 `import()`
- **依赖升级**：Electron 33 → 44、TypeScript 5 → 7、ESLint 9 → 10 等
- **目录按领域重组**：`src/{app, session, bridge, overlay, tools, providers, mcp, infra}`，
  取代原先的 `main / preload / utils / tools` 分层
- **工具系统重组**：`tools/` → `src/tools/`，内部按 `core / runtime / impl` 分层
- **工具 API 契约自动生成**：每个工具自持 API 元数据与沙箱注入函数，
  构建期自动生成 `api.d.ts` 与 `bootstrap.generated.ts`（工具成为唯一真相源）
- **Provider hook 模块化**：网络拦截器改为正常 TS 模块，构建期用 esbuild
  打包为自包含字符串（消除三平台 SSE 解码重复）
- **工具调用模式收敛**：仅保留 JS（cuckoo 代码块）调用方式

### Removed
- 旧工具别名（`FileReadTool` / `FileWriteTool` / `FileEditTool` / `GlobTool` / `GrepTool`）
- JSON 工具调用执行模式（改为仅识别并提示）
- `tool-names` 手工维护的工具白名单

## [0.5.3] - 2026-09-18

### Added
- **附件上传工具（attach_file）**：AI 可将本地文件（PDF、Word、Excel、PPT、图片等
  无法用 read 读取的二进制文件）作为附件主动上传到对话输入框，上传后随下一条
  消息发出；单文件、大小上限 30MB，按扩展名推断 MIME
- **附件上传间隔设置**：默认 0.5~1 秒可配置，触发上传后先等待再检测附件是否出现
  （保留兜底轮询，避免页面渲染慢时误判失败）
- **「卡住了?点我」快捷按钮**：原「手动解析」改为向 AI 发送
  「刚才卡住了请继续 爱你哦」，一键催促卡住的 AI 继续
- **MCP 初始化提示词注入已启用 server 列表**（含连接状态与工具数）
- **MCP 默认工作目录**：stdio server 的 cwd 固定为程序目录/mcp-cwd，
  不可写时回退用户数据目录；覆盖各平台各安装方式
- **AI 可定位 MCP 产物**：提示词注入 MCP 工作目录，AI 可用绝对路径读取/上传
  截图、下载等产物

### Fixed
- 修复 4 个提示词模板缺少 `{{MCP_SECTION}}` 占位符，导致 MCP 能力章节从未
  注入提示词的问题
- 修复 MCP 并发连接竞态（启动与初始化同时触发导致重复 spawn 子进程、连接泄漏）

### Changed
- 初始化项目不再阻塞等待 MCP 连接，改为后台异步连接，初始化更迅速

## [0.5.2] - 2026-09-17

### Added
- **请求失败自动重试**：AI 对话请求失败（网络错误 / 非 2xx / 流中断）时，
  按配置间隔自动重发提示词，触发 AI 重新回答
  - 普通失败：默认 4~10 秒间隔、10 次；操作频繁（429）：默认 60 秒、20 次
  - 倒计时浮层 + 取消按钮；次数为负数表示不限次
  - 成功回复即重置计数；压缩上下文期间自动暂停
- **工具循环看门狗**：AI 进入工具调用循环后，若某轮等待回复超时，
  自动发送「请继续」提示词催 AI 继续；超时默认 300 秒、默认 3 次
  - 工具执行期间不监控；会话切换自动失效，不打扰新会话
- **设置弹窗**：重试 / 看门狗 / 发送延迟集中配置，新增「恢复默认」按钮
- **内置 Provider 容错加载**：单个内置平台文件缺失/损坏不再拖垮应用启动

### Fixed
- 修复用户主动停止生成被误判为失败、触发自动重试的问题：
  通过拦截 DeepSeek 的 stop_stream 请求作为「用户停止」的可靠判据
- 修复 inject_js 无法处理多语句代码、顶层 await、if-return 的问题
  （改用两遍语法探测，兼容表达式与语句体）

## [0.5.1] - 2026-09-15

### Fixed
- 修复打包后系统提示词中 ts 代码围栏为空的问题：electron-builder 默认排除
  `*.d.ts` 不进 asar，导致 `tools/cuckoo-tools.d.ts` 缺失、`{{TOOL_API_TYPES}}`
  被替换为空。改用 `extraResources` 复制到 `resources/tools/`，运行时优先从
  `process.resourcesPath` 读取并回退到源码路径

## [0.5.0] - 2026-09-15

### Fixed
- 修复系统提示词中工具类型定义（cuckoo-tools.d.ts）注释里的 ``` 反引号破坏 ts 代码围栏的问题

## [0.4.0] - 2026-09-15

### Added
- **上下文压缩（手动 + 自动）**：当对话 token 过大时，生成摘要并只保留最近
  20% 对话，通过 DeepSeek 分享功能在新会话继续
  - 纯 API 实现：读 IndexedDB 全量消息，直接调用分享接口，不依赖 DOM 点击
  - 面板「压缩」按钮手动触发；「自动压缩」可配置阈值（默认 80 万 token）
  - 压缩后自动跳转新会话并初始化项目，末尾追加「请继续你之前的工作」

## [0.3.10] - 2026-09-14

### Fixed
- 修复选择平台时闪退：切换平台会先销毁旧窗口再重建，
  window-all-closed 期间窗口数短暂为 0 导致应用误退出
- 修复 userData 目录不存在时启动崩溃：app.setPath('userData') 前兜底创建目录

## [0.3.9] - 2026-09-14

### Added
- 面板显示 DeepSeek 服务端对话 token（读取 SSE 流的 accumulated_token_usage，
  过万自动简写为 x.xx万）

### Changed
- 彻底移除 DOM 抓取 AI 回复路径，仅保留网络请求拦截
  - 删除 observer / ai-response / detector 等 DOM 抓取模块
  - 抽出工具执行逻辑到 tool-executor，拦截与 DOM 共用
  - 手动解析改为复用拦截缓存文本，不再依赖 DOM
- 注释 provider 中已废弃的 DOM 抓取方法（isResponseComplete / getMessageCandidates /
  getMessageMarkdown / isUserMessage / getCodeBlockLanguage）
- 移除 token 本地估算，仅保留服务端权威数据

## [0.3.8] - 2026-09-11

### Changed
- **DeepSeek / Claude / ChatGPT 三个平台的 AI 回复获取，从 DOM 抓取改为网络请求拦截**
  - 在页面主世界（main world）注入拦截器，被动观察平台自身的 completion SSE 流，
    直接解析回复文本，不再依赖 MutationObserver + DOM 稳定性轮询
  - 仅旁路读取（response.clone / responseText 快照），不修改请求与响应
  - 正文提取区分并排除 THINK / reasoning 片段
  - DeepSeek：解析 response/fragments 的 THINK / RESPONSE 分片
  - Claude：解析 content_block_delta 的 text_delta（忽略 thinking_delta）
  - ChatGPT：解析 /backend-api/f/conversation 的裸 v 追加、patch 批量操作、
    message 快照（仅采纳 assistant）与 message/status 结束信号
  - 工具执行结果回传仍沿用原有模拟输入框发送方式

## [0.3.6] - 2026-09-08

### Fixed
- 添加标准编辑菜单，修复 macOS 无法在 DeepSeek 输入框复制/粘贴的问题

## [0.3.5] - 2026-09-08

### Fixed
- glob/grep 工具打包后 ripgrep ENOENT，通过 asarUnpack 解包二进制并修正运行路径
- 恢复 README 中 Codecov 覆盖率徽章

## [0.3.4] - 2026-09-07

### Fixed
- pwsh 工具改用 execFile，避免管道符被 cmd 预解析导致命令残缺
- 主窗口 UA 改为 Chrome 130 普通标识，避免 DeepSeek 提示隐私风险
- openBrowserWindow 工具窗口同步设置 Chrome 130 UA，不再暴露 Electron 标识
- XML invoke 检测不再要求必须位于文本开头，并避免提示语自触发循环
- 渲染进程可通过 --cuckoo-user-data 参数加载自定义 Provider

### Added
- Provider 发送扩展接口（provider.triggerSend），支持站点原生发送
- 流式稳定性双通道校验（mutation 快照 + interval 兜底）
- 完成检测兜底轮询（每 2s 主动复查），覆盖后台/最小化漏触发场景
- MCP 工具调用识别（await mcpXxx / log(await xxx））
- 无 pre 的 .md-code 代码容器兜底

### Changed
- 会话 ID 提取与跳转 URL 改为 Provider 方法，不再硬编码 DeepSeek 格式

## [0.3.0] - 2026-09-07

### Added
- 多平台 Provider 框架：支持 DeepSeek 与 Claude，按平台区分输入框/发送按钮/用户信息/消息解析
- 平台选择页：新窗口未指定平台时展示卡片式选择页（含官方品牌 logo）
- 提示词模板化：每平台独立模板，支持 `{{PLATFORM_INFO}}` `{{TOOL_API_TYPES}}` `{{TOOLS_LIST}}` `{{TOOL_SECTIONS}}` `{{PROJECT_DIR}}` `{{PROJECT_INTRO_SECTION}}` `{{MCP_SECTION}}` 占位符
- 自定义 Provider 功能：用户可通过平台选择页导入 JS 文件，支持复制到 userData、重名替换、删除前窗口占用检查
- 自定义 Provider 类型声明与模板：`src/providers/custom/provider.d.ts` + `provider.template.js`
- Provider 方法化：平台差异全部下沉到 Provider 方法（findInput/findSendButton/isResponseComplete/getMessageCandidates 等）
- Claude 自动解析：基于停止按钮边沿触发完成检测，跳过空消息，避免重复触发
- 按平台分文件记录渲染日志到 `wyp/log/{providerId}.log`
- 新增 Provider 单元测试

### Changed
- 系统提示词由单文件改为多平台模板，运行时按 providerId 选择并替换占位符
- 工具 API 类型定义从 `tools/cuckoo-tools.d.ts` 动态读取，避免多处维护
- 平台 logo 从首字母占位改为官方 SVG

### Fixed
- Claude 自动解析重复触发/漏触发问题
- 多个 `{{PROJECT_DIR}}` 占位符只替换第一个的问题
- 导入自定义 Provider 后源文件被删导致失效的问题

---

## [0.2.5-beta.1] - 2026-09-02

### Added
- 新增 MCP（Model Context Protocol）按需查询能力
  - mcpListServers() 查看已配置的 MCP server（名称/类型/状态/工具数/工具名）
  - mcpGetTools(serverName) 查看指定 server 的工具详情（描述+参数）
  - mcpCall(server, tool, args) 调用 MCP 工具
- MCP 启动时自动连接已启用的 server，初始化项目时等待连接（8 秒超时）
- MCP 配置保存前完整 JSON 结构校验（错误时明确提示且不覆盖输入）
- MCP 配置保存后弹确认框，由用户决定是否通知 AI（避免打断 AI 操作）
- showConfirmDialog 扩展支持确认/取消双按钮 + Promise 返回（向后兼容）
- 新增 McpCallTool、McpQueryTools 单元测试

### Changed
- MCP 提示词改为按需查看模式，不再全量注入工具列表（节省 token）
- MCP 保存后的自动通知改为简短格式，引导 AI 按需查询
- 移除 .cuckooCode/CUCKOO.md 作为全局项目介绍（避免干扰其他项目场景）

### Fixed
- 修复 connectEnabledServers 从未被调用导致 MCP 启动后未连接的问题
- 修复 initProject 同步逻辑中 MCP 连接时序竞态（改为 async + 等待）

---

## [0.2.0] - 2026-08-27

### Breaking Changes
- 主进程重构：main.js 拆分为 src/main/ 模块（应用生命周期、IPC、项目上下文、会话存储分离）
- preload 重构：preload.js 拆分为 src/preload/ 模块（DOM 监测、overlay UI、工具解析分离）
- 移除 MySQLTool.js（已无维护，提示词中不再暴露）
- 移除旧版工具桥接实现（ToolBridge.js、UnifiedToolManager.js、WebContentCapturer.js）
- bash/pwsh 不再强制要求 description 参数（改为可选）

### Added
- 新增 5 个对标 dsh 的工具实现：
  - read（offset/limit 分段读取，替代 readFile）
  - write（全量覆盖，替代 writeFile）
  - edit（精确替换，替代 editFile）
  - glob（ripgrep 引擎，替代旧 GlobTool）
  - grep（ripgrep JSON 输出，替代旧 GrepTool）
- 新增 todoWrite 工具（全量任务列表，对标 dsh todo_write）
- 新增 pwsh 工具（PowerShell 执行，对标 dsh tool-pwsh）
- 新增 webFetch 工具（HTML 转 Markdown，对标 dsh web_fetch）
- 新增 openBrowserWindow / injectJS 工具（打开调试窗口并注入 JS）
- 工具系统支持 section 机制（对标 dsh systemPrompt.section），每个工具有独立的 prompt section
- 系统提示词全面改版：中文 dsh 风格 + 动态平台检测（Windows/macOS/Linux）
- 发送延迟可配置（UI 设置 + localStorage 持久化）
- UI 全面改版：悬浮球模式（48px 右下角 FAB + 小面板），不再占用全高侧边栏
- 跨平台启动脚本 start.js（Windows/macOS/Linux 通用）
- 完整单元测试覆盖（tools / main / preload）

### Changed
- package.json start 脚本改为 node start.js（修复 macOS chcp: command not found）
- start.js 自动根据平台选择 UTF-8 编码设置
- 工具返回格式统一为 dsh 风格（纯文本 envelope / marker）
- 错误提示统一为英文 dsh 风格
- package.json 增加 allowScripts 配置（npm 新版本 electron postinstall 被阻止问题）

### Fixed
- edit 工具 CRLF 适配（LF 的 old_string 能匹配 CRLF 文件）
- bash/pwsh 非零退出不再报错，改用 [exit code: N] 标记
- glob 路径去掉 ./ 前缀
- Windows 平台信息动态生成（不再硬编码）
- Electron postinstall 被 npm allowScripts 阻止导致二进制缺失的问题
- JS 脚本无输出时提示使用 log()

### Security
- bash/pwsh 危险命令黑名单保留（Windows + PowerShell 特有命令）
- 命令执行超时限制保持 30 秒
- 输出缓冲 1MB 限制保持

### Dependencies
- 新增 @vscode/ripgrep（glob/grep 底层引擎）
- 新增 turndown + @joplin/turndown-plugin-gfm（webFetch HTML 转 Markdown）

---

## [1.0.0] - 2026-08-11

### Added
- 初始版本发布
- Electron 桌面应用，嵌入 DeepSeek 网页版
- 自动检测 AI 回复中的 cmd/powershell 代码块，弹窗确认后执行
- 工具调用系统：支持 file_write、file_read、file_edit、file_glob、file_grep、bash、file_delete 等工具
- 会话级项目目录绑定，工具操作以项目目录为基础
- 侧边覆盖层面板，显示命令预览、执行结果和历史记录
- Ctrl+Shift+C 快捷键切换覆盖层
- 项目初始化功能，自动生成目录树并注入系统提示词
- 支持危险命令检测与额外警告
- 会话持久化（cookies/localStorage 保存到 %APPDATA%/cuckoo-code-session）

### Security
- 命令执行前必须用户确认
- 危险命令（rm -rf /、format、shutdown 等）触发额外警告
- 30 秒命令执行超时限制
- 1MB 命令输出缓冲区限制

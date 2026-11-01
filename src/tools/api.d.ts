/**
 * Cuckoo Code 工具 API（TypeScript 声明）
 *
 * 本文件描述 cuckoo 代码块中可以调用的全部全局函数与数据类型。
 * 运行时由 JsRunner 在受限沙箱中注入这些函数；本声明用于帮助
 * AI 理解调用方式，与运行时行为保持一致。
 *
 * 使用规则速览：
 * - 所有工具函数都是异步的，调用时必须写 await
 * - 相对路径基于全局变量 projectDir（当前项目根目录）解析
 * - 多行文本使用反引号（`）模板字符串，不需要任何转义
 * - 工具出错时抛出异常（Error.message 为错误描述），可用 try/catch 处理；
 *   唯一例外是 bash()/pwsh()：非零退出不抛异常，通过返回文本中的 [exit code] 标记报告
 * - 用 log() 输出中间过程；脚本最后可用 return 返回结果值
 *
 * ⚠️ 本文件由 scripts/build-tool-api.mjs 自动生成，请勿手动编辑。
 *    真相源：各工具的 apiMetas 元数据（src/tools/impl/*.ts）。
 */

/** 当前项目根目录（初始化项目后由系统注入）。未初始化时为 null。 */
declare const projectDir: string | null;

/**
 * 输出中间结果到执行日志（不中断脚本）。
 * 日志内容随执行结果一起回传给 AI。
 * 注意：log() 只在 cuckoo 代码块的 JS 层可用。不要在 bash()/pwsh() 的命令字符串内部调用它——那些命令是独立的 shell 脚本，无法访问 JS 函数。
 */
declare function log(...args: unknown[]): void;

// ================= 文件读写 =================

/** read 的选项 */
interface ReadOptions {
  /** 1-based 起始行号，默认 1 */
  offset?: number;
  /** 最大返回行数，默认 2000，上限 2000 */
  limit?: number;
}

/**
 * 读取 UTF-8 文本文件并返回带行号的内容窗口。
 * 通过 offset 和 limit 分段读取大文件。输出为：
 * 首行是文件信息（路径 + 行号范围，模板可在设置里自定义），空行，
 * 然后正文是「行号: 内容」，最后一行是续读提示。
 *
 * 使用 read 工具（而不是 cat 等 shell 命令）来查看文本文件。结果包含行号。使用 offset 和 limit 继续读取大文件。
 * @param filePath 相对（基于项目根目录）或绝对路径
 * @param options 可选，offset/limit
 * @throws 文件不存在、不是文件、offset 越界或读取失败时抛出异常
 */
declare function read(filePath: string, options?: ReadOptions): Promise<string>;

/** readLines 返回的单行数据 */
interface ReadLine {
  /** 1-based 行号 */
  number: number;
  /** 行文本（不含换行符） */
  text: string;
}

/** readLines 的返回结果 */
interface ReadLinesResult {
  /** 窗口内的行数据 */
  lines: ReadLine[];
  /** 文件总行数 */
  totalLines: number;
  /** 本次起始行号 */
  offset: number;
  /** 是否因字节上限被截断 */
  truncatedByBytes: boolean;
}

/**
 * 读取 UTF-8 文本文件并返回结构化行数组，供 AI 在内存中精确处理。
 *
 * 使用 readLines 工具读取文件的结构化行数据（数组，每个元素含 number 和 text 字段），适合在内存中批量处理（如 map/filter/join 后写回）。如果只是查看文件内容，用 read 即可。
 * @param filePath 相对（基于项目根目录）或绝对路径
 * @param options 可选，offset/limit
 * @throws 文件不存在、不是文件、offset 越界或读取失败时抛出异常
 */
declare function readLines(filePath: string, options?: ReadOptions): Promise<ReadLinesResult>;

/**
 * 创建或完全覆盖 UTF-8 文本文件。
 * 返回一句确认（含文件路径），具体措辞可在设置里自定义。
 *
 * 使用 write 工具创建文件或完全替换文件内容。已有文件会被覆盖，所以覆盖前先 read 文件，针对局部修改优先用 edit。注意：read 输出的内容带行号和 footer，写入的 content 必须是文件原始内容，不要包含行号或 footer 提示。
 * @param filePath 相对（基于项目根目录）或绝对路径
 * @param content 完整 UTF-8 文本内容；空字符串合法（写入空文件）
 * @throws 路径为空、写入失败时抛出异常
 */
declare function write(filePath: string, content: string): Promise<string>;

/**
 * 在现有 UTF-8 文本文件中精确替换 oldString 为 newString。
 * 默认 oldString 必须唯一匹配；多匹配需设置 replaceAll。
 *
 * 使用 edit 工具对现有 UTF-8 文本文件做定向修改：用 newString 替换字面量 oldString。
 * oldString 应是一行或多行【连续】的原文（可跨行，不必逐行改）；【务必注意空白与缩进】——
 * 缩进、空格不一致是替换失败的最常见原因，请直接复制 read 到的原文。
 * 默认 oldString 必须唯一匹配：若出现多次，请提供更长的上下文使其唯一，或设置 replaceAll: true 全部替换。
 * 批量替换同一文本时优先用 replaceAll: true 一次完成，避免读全文后整体写回。
 * 批量修改前可用 dryRun: true 预览，确认无误后再真实写入。
 * 除非你刚在本会话中创建或编辑过该文件，否则先 read 文件。
 * 注意：read 输出的内容带行号，oldString/newString 必须是文件原始文本，不要包含行号或 footer 提示。
 * @param filePath 相对或绝对路径
 * @param oldString 要替换的字面文本
 * @param newString 替换后的字面文本（可空字符串删除匹配）
 * @param replaceAll 是否替换所有匹配，默认 false
 * @param dryRun 是否只预览不写入，默认 false；true 时返回将替换的处数和内容，不修改文件
 * @throws 文件不存在、oldString 未找到、多匹配未设置 replaceAll、oldString===newString 时抛出异常
 */
declare function edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean, dryRun?: boolean): Promise<string>;


// ================= 搜索 =================

/**
 * 按 glob 模式查找文件路径，返回纯文本路径列表（以 / 分隔，如 "src/utils/a.js"）。
 * 使用 ripgrep，包含隐藏文件和已忽略文件；未指定 path 时默认排除 VCS 元数据目录（.git 等）与常见产物目录（node_modules、dist、out、build 等）。
 * glob 语法：* 匹配单层内任意字符，** 匹配任意层级目录，? 匹配单个字符。
 * 结果包含 footer：未超限时"(共找到 N 个文件)"，超限时说明只列出了前 M 个。
 *
 * 使用 glob 工具（而不是 shell find）按路径模式查找文件。不含 "/" 的模式匹配任意深度的 basename，所以 "*" 匹配树中所有文件而非仅顶层。结果只包含文件，永不包含目录，且包含隐藏和已忽略文件。默认排除 node_modules、dist 等产物目录；若确需搜索这些目录，请显式传 path。
 * @param pattern glob 匹配模式，如 src 下所有 .js / .ts，或 *.json
 * @param searchPath 搜索起始目录（相对路径），默认项目根目录
 * @throws pattern 为空、搜索目录不存在或不是目录时抛出异常
 */
declare function glob(pattern: string, searchPath?: string): Promise<string>;

/** grep 的选项 */
interface GrepOptions {
  /** 搜索起始文件或目录（相对路径基于项目根目录），默认项目根目录 */
  path?: string;
  /** 过滤文件，单个正向 glob（如 "*.ts"、"*.{js,jsx}"），不支持否定和逗号列表 */
  include?: string;
}

/**
 * 用 ripgrep 正则表达式搜索文件内容。
 * 返回纯文本：header（Found N matches）+ 按文件分组的 "Line N: 内容"。
 * 无匹配返回 "No matches found"。
 *
 * 使用 grep 工具（而不是 shell grep 或 rg）搜索文件内容。需要查看匹配行的上下文时，对匹配文件使用 read。
 * @param pattern ripgrep 正则表达式
 * @param options 可选，path/include
 * @throws pattern 为空、include 非法、ripgrep 执行失败时抛出异常
 */
declare function grep(pattern: string, options?: GrepOptions): Promise<string>;


// ================= 命令执行 =================

/** bash 的选项 */
interface BashOptions {
  /** 命令用途说明（清晰、简洁、主动语态，5-10 词） */
  description?: string;
  /** 工作目录（相对路径基于项目根目录），默认项目根目录 */
  workdir?: string;
  /** 超时毫秒数，默认 30000 */
  timeoutMs?: number;
}

/**
 * 执行 shell 命令（Windows 使用 cmd.exe）。
 * 返回纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）。
 * 必须用 log() 方法打印才能看到返回内容。
 * 非零退出不抛异常，通过 [exit code] 标记报告。
 * 危险命令会被安全策略拒绝并抛异常。
 *
 * 执行 bash 命令并返回 stdout/stderr。每次调用在全新 shell 中运行：状态（cwd、变量、函数）不会跨调用保留——请用 workdir 参数而非 cd。非零退出以 [exit code: N] 标记报告。长输出会截断为尾部。
 * @param command 要执行的 shell 命令
 * @param options 可选，{ description?: string, workdir?: string, timeoutMs?: number }
 * @returns 纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）
 * @throws 危险命令被安全策略拒绝时抛出异常
 */
declare function bash(command: string, options?: BashOptions): Promise<string>;

/** pwsh 的选项 */
interface PwshOptions {
  /** 命令用途说明（清晰、简洁、主动语态，5-10 词） */
  description?: string;
  /** 工作目录（相对路径基于项目根目录），默认项目根目录 */
  workdir?: string;
  /** 超时毫秒数，默认 30000 */
  timeoutMs?: number;
}

/**
 * 执行 PowerShell 命令（powershell -NoProfile -Command）。
 * 返回纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）。
 * 必须用 log() 方法打印才能看到返回内容。
 * 非零退出不抛异常，通过 [exit code] 标记报告。
 * 危险命令会被安全策略拒绝并抛异常。
 *
 * 执行 PowerShell 命令（powershell -NoProfile -Command）并返回 stdout/stderr。每次调用在全新 pwsh 进程中运行：状态不会跨调用保留——请用 workdir 参数而非 cd。路径使用 Windows 原生形式（C:\\...）；用 $env:NAME 读取环境变量。非零退出以 [exit code: N] 标记报告。读写文件请显式写 -Encoding UTF8（Get-Content / Set-Content / Out-File / Add-Content），系统会自动补但别名和变量拼接时可能失效。注意 PowerShell 5.1 的 -Encoding UTF8 会写 BOM（文件开头多 3 个隐形字节），写 JSON/脚本等对 BOM 敏感的格式时优先用 [IO.File]::WriteAllText(路径, 内容, [System.Text.UTF8Encoding]::new($false))。
 * @param command 要执行的 PowerShell 命令
 * @param options 可选，{ description?: string, workdir?: string, timeoutMs?: number }
 * @returns 纯文本：stdout + [stderr] 分节 + 状态标记（[exit code]、[timed out]）
 * @throws 危险命令被安全策略拒绝时抛出异常
 */
declare function pwsh(command: string, options?: PwshOptions): Promise<string>;


// ================= 任务管理 =================

/** todo 条目状态 */
type TodoStatus = 'pending' | 'in_progress' | 'completed';

/** todo 条目 */
interface TodoItem {
  /** 任务内容，简短的祈使句 */
  content: string;
  /** pending（未开始）| in_progress（进行中）| completed（已完成） */
  status: TodoStatus;
}

/**
 * 记录并更新当前工作的结构化任务列表。
 * 每次发送完整列表，替换之前的列表（无部分更新）。
 * 串行模式：最多一条 in_progress。
 *
 * 记录并更新当前工作的结构化任务列表。每次调用发送完整列表——它替换之前的列表（没有部分更新）。完成任务后立即标记为 completed。对于简单的单步任务可跳过列表。
 * @param todos 完整任务列表
 * @returns 统计确认消息，如 "Updated todo list: 2 pending, 1 in progress, 0 completed."
 * @throws content 为空、重复、状态非法、超过一条 in_progress 时抛出异常
 */
declare function todoWrite(todos: TodoItem[]): Promise<string>;


// ================= 删除 =================

/** deleteFile 的返回值 */
interface FileDeleteResult {
  message: string;
  /** 被删除文件的绝对路径 */
  path: string;
}

/**
 * 删除指定文件（不可恢复，请谨慎使用；只能删除文件，不能删除目录）。
 *
 * 使用 deleteFile 工具永久删除文件。此操作不可撤销。返回 { message, path }，path 为被删除文件的绝对路径。删除前请仔细确认路径。
 * @param filePath 要删除的文件路径
 * @throws 文件不存在或路径不是文件时抛出异常
 */
declare function deleteFile(filePath: string): Promise<FileDeleteResult>;


// ================= MySQL =================

/** MySQL 连接与查询参数 */
interface MySQLOptions {
  /** MySQL 主机地址，默认 localhost */
  host?: string;
  /** MySQL 端口，默认 3306 */
  port?: number;
  /** 用户名 */
  user: string;
  /** 密码 */
  password?: string;
  /** 数据库名 */
  database: string;
  /** 要执行的 SQL 语句 */
  sql: string;
  /** SELECT 返回行数上限，默认 100，最大 1000 */
  limit?: number;
}

/**
 * 执行 MySQL SQL 语句。
 * SELECT/SHOW/DESCRIBE/EXPLAIN 等查询返回纯文本表格；
 * INSERT/UPDATE/DELETE/DDL 返回 affectedRows 等执行统计。
 *
 * 使用 mysql 工具执行 MySQL SQL 语句。传入 host/port/user/password/database 和 sql。SELECT/SHOW/DESCRIBE/EXPLAIN 返回纯文本表格，写操作返回 affectedRows。
 * @param options 连接参数 + sql
 * @returns 纯文本表格（查询）或执行统计（写操作）
 * @throws 连接失败、SQL 错误时抛出异常
 */
declare function mysql(options: MySQLOptions): Promise<string>;


// ================= WebFetch =================

/**
 * 获取指定 HTTP(S) URL 的内容并解码为文本。
 * HTML 会转换为 Markdown（turndown + GFM）。
 * 返回纯文本：Fetched <url> (HTTP <status>) + 正文。
 * 内容超过上限（约 20000 字符）会截断并附 footer。
 * 出于安全考虑，可在设置里开启"拒绝访问内网地址"（默认关闭）。
 *
 * 使用 webFetch 工具获取指定 HTTP(S) URL 的内容。返回解码为文本的页面内容（HTML 转 Markdown）。内容超过约 20000 字符会截断并附 footer。使用其内容时，请以 markdown 链接形式引用 URL。
 * @param url 要获取的 HTTP(S) URL
 * @throws URL 为空、非 http/https、指向内网/保留地址、请求超时或失败时抛出异常
 */
declare function webFetch(url: string): Promise<string>;

/**
 * 打开一个 Electron 浏览器窗口并返回窗口 ID。 打开浏览器后可以使用 injectJS 工具对窗口内容注入js , 以具备操控网页能力
 *
 * 使用 openBrowserWindow 打开 Electron 浏览器窗口。返回 windowId，后续用 injectJS(windowId, code) 注入 JS 并获取返回值。可传自定义 id 便于语义化管理。
 * @param url 要打开的网页 URL
 * @param options 可选，{ id?: string, width?: number, height?: number }
 * @returns 返回 { windowId: string, message: string }，用返回的 windowId 传给 injectJS
 */
declare function openBrowserWindow(url: string, options?: { id?: string; width?: number; height?: number }): Promise<any>;

/**
 * 向指定窗口注入 JS 代码并返回执行结果（支持 async/await）。 如果需要可以使用js模拟点击等任何操作.
 *
 * 使用 injectJS(windowId, code) 向指定窗口注入 JS。code 可以是任意 JS：单个表达式（如 `(() => ({a:1}))()`）、或一段语句（如 `const a=1; return a;`、`if (x) return y;`，顶层 await 亦可用）。内部优先按表达式解析，失败则按 async 函数体解析；返回值（return 的值 / 表达式结果）会返回给 AI。执行出错会抛出异常。
 * @param windowId 目标窗口 ID
 * @param code 要注入的 JS 代码（支持 await，返回值会被返回）
 * @returns JS 执行结果
 */
declare function injectJS(windowId: string, code: string): Promise<any>;


// ================= Agent =================

/**
 * 把任务委派给一个子代理（独立上下文的 AI 对话）执行，返回子代理的最终结果摘要。适合大范围搜索/分析、独立子任务，避免污染当前上下文。
 *
 * 使用 runAgent(name, task) 把任务委派给子代理。子代理在独立上下文中完成，只把结果摘要返回。
 * @param name 子代理名称（见系统提示词「可用子代理」章节）
 * @param task 要委派的任务描述
 * @returns 子代理的最终文本结果
 * @throws 代理不存在、父窗口上下文缺失或执行超时时抛出异常
 */
declare function runAgent(name: string, task: string): Promise<string>;


// ================= 附件上传 =================

/**
 * 将本地文件作为附件上传到当前对话输入框（不发送）。
 * 当你需要基于无法用 read 读取的文件内容（PDF、DOC、XLSX、PPT、图片等）作答，或需要把文件交给用户看时使用——无需用户明确要求上传。
 * 若只需判断文件是否存在或读取其文本内容，用 read/glob 即可，不要上传。
 * 上传成功后文件会随下一条消息一起发出，之后可基于其内容作答。
 *
 * 当你需要基于无法用 read 读取的文件（PDF、Word、Excel、PPT、图片等二进制文件）作答时，主动使用 attachFile(filePath) 将其上传到输入框——无需等用户明确说“上传”。适用于：用户给出这类文件的路径、描述了某个文件让你查看、或你生成了想交给用户的文件。文本类文件优先用 read 直接读取；若只需判断文件是否存在，用 glob 即可。上传后文件随下一条消息发出，你即可基于其内容作答。仅支持已存在的单个文件，大小上限 30MB。
 * @param filePath 要上传的文件路径（相对项目根目录或绝对路径）
 * @returns { fileName: string, size: number, message: string }
 * @throws 文件不存在、不是文件、超过 30MB、缺少窗口上下文或上传超时时抛出异常
 */
declare function attachFile(filePath: string): Promise<{ fileName: string; size: number; message: string }>;


// ================= MCP =================

/**
 * 调用 MCP server 提供的工具。
 * 使用前先调用 mcpListServers() 和 mcpGetTools() 查询可用能力。
 *
 * 调用 MCP 工具时使用 mcpCall(server, tool, args)。使用前先通过 mcpListServers() 和 mcpGetTools() 查询可用能力。
 * @param server MCP server 名称
 * @param tool 要调用的工具名
 * @param args 工具参数对象
 * @returns 工具执行结果（纯文本）
 * @throws 连接失败、工具不存在或调用出错时抛出异常
 */
declare function mcpCall(server: string, tool: string, args?: Record<string, unknown>): Promise<string>;


// ================= 会话 =================

/**
 * 给当前对话起一个简短标题（用于工作区列表识别）。对话主题明确后调用一次即可。
 *
 * **对话命名（重要）**：每次对话的**首条用户消息**处理时，**立即**调用一次 nameConversation(title) 给本次对话起个简短标题（中文，≤20 字，概括用户意图）。
 * 这是本次对话的**第一个动作**，先命名再干别的。
 * 示例：用户说"帮我修复登录 bug" → 先 await nameConversation("修复登录 bug")，再开始干活。
 * （若首条消息就很笼统如"你好"，可先用"打招呼"之类的标题，后续主题明确时可再调一次更新。）
 * @param title 对话标题（简短，建议不超过 20 字）
 * @returns { message: string }
 * @throws 缺少窗口上下文、当前无会话或标题为空时抛出异常
 */
declare function nameConversation(title: string): Promise<{ message: string }>;


// ================= MCP =================

/**
 * 列出所有已配置的 MCP server（含启用状态、连接状态和工具数量）。
 * 使用 MCP 前先调用此函数查看当前可用 server。
 *
 * mcpListServers() 列出已配置的 MCP server（含启用/连接状态）。
 * @returns 纯文本 server 列表
 */
declare function mcpListServers(): Promise<string>;

/**
 * 查看指定 MCP server 提供的工具列表（含描述和参数）。
 * 确认工具能力后再调用 mcpCall。
 *
 * mcpGetTools(serverName) 查看指定 MCP server 的工具和参数。
 * @param serverName MCP server 名称
 * @returns 纯文本工具列表
 * @throws server 不存在或连接失败时抛出异常
 */
declare function mcpGetTools(serverName: string): Promise<string>;


// ================= 任务管理 =================

/**
 * 宣告当前目标（/goal 设定的自动多轮任务）已全部完成，结束自动推进。
 * 仅在目标的所有要求都确实完成后调用；调用前先在正文给出完成情况总结。
 * 非目标模式的普通对话不需要调用本工具。
 *
 * 当 /goal 目标的所有要求都确实完成后，调用 goalDone() 结束目标的自动推进；调用前先在正文给出完成情况总结。目标未完成或遇到阻碍时不要调用，继续推进或说明原因。普通对话（非目标模式）不要调用本工具。
 * @returns 确认消息
 * @throws 缺少窗口上下文、窗口已关闭或纯净对话模式未开启时抛出异常
 */
declare function goalDone(): Promise<string>;

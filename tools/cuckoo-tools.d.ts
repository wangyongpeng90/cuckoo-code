/**
 * Cuckoo Code 工具 API（TypeScript 声明）
 *
 * 本文件描述 ```cuckoo 代码块中可以调用的全部全局函数与数据类型。
 * 运行时由 tools/JsRunner.js 在受限沙箱中注入这些函数；本声明用于帮助
 * AI 理解调用方式，与运行时行为保持一致。
 *
 * 使用规则速览：
 * - 所有工具函数都是异步的，调用时必须写 await
 * - 相对路径基于全局变量 projectDir（当前项目根目录）解析
 * - 多行文本使用反引号（`）模板字符串，不需要任何转义
 * - 工具出错时抛出异常（Error.message 为错误描述），可用 try/catch 处理；
 *   唯一例外是 bash()/pwsh()：非零退出不抛异常，通过返回文本中的 [exit code] 标记报告
 * - 用 log() 输出中间过程；脚本最后可用 return 返回结果值
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
 * 通过 offset 和 limit 分段读取大文件。输出为格式化文本：
 * <path>...</path>
 * <type>file</type>
 * <content>
 * 行号: 内容
 * ...
 * (footer 提示是否继续读取)
 * </content>
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
 * @param filePath 相对（基于项目根目录）或绝对路径
 * @param options 可选，offset/limit
 * @throws 文件不存在、不是文件、offset 越界或读取失败时抛出异常
 */
declare function readLines(filePath: string, options?: ReadOptions): Promise<ReadLinesResult>;

/**
 * 创建或完全覆盖 UTF-8 文本文件。
 * 返回格式化 envelope：<path>...</path><type>file</type><content>Created/Updated file</content>
 * @param filePath 相对（基于项目根目录）或绝对路径
 * @param content 完整 UTF-8 文本内容；空字符串合法（写入空文件）
 * @throws 路径为空、写入失败时抛出异常
 */
declare function write(filePath: string, content: string): Promise<string>;

/**
 * 在现有 UTF-8 文本文件中精确替换 old_string 为 new_string。
 * 默认 old_string 必须唯一匹配；多匹配需设置 replaceAll。
 * 返回 Claude-style 确认消息。
 * @param filePath 相对或绝对路径
 * @param oldString 要替换的字面文本
 * @param newString 替换后的字面文本（可空字符串删除匹配）
 * @param replaceAll 是否替换所有匹配，默认 false
 * @param dryRun 是否只预览不写入，默认 false；true 时返回将替换的处数和内容，不修改文件
 * @throws 文件不存在、old_string 未找到、多匹配未设置 replaceAll、old_string===new_string 时抛出异常
 */
declare function edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean, dryRun?: boolean): Promise<string>;

// ================= 搜索 =================

/**
 * 按 glob 模式查找文件路径，返回纯文本路径列表（以 / 分隔，如 "src/utils/a.js"）。
 * 使用 ripgrep，包含隐藏文件和已忽略文件，只排除 VCS 元数据目录（.git、.svn 等）。
 * glob 语法：* 匹配单层内任意字符，** 匹配任意层级目录，? 匹配单个字符。
 * 结果包含 footer：未超限时 "(Found N files)"，超限时 "(Showing M of N paths...)"。
 * @param pattern glob 匹配模式，如 **/*.js、src/**/*.ts、*.json
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
 * @param url 要获取的 HTTP(S) URL
 * @throws URL 为空、非 http/https、请求超时或失败时抛出异常
 */
declare function webFetch(url: string): Promise<string>;

/**
 * 打开一个 Electron 浏览器窗口并返回窗口 ID。 打开浏览器后可以使用 injectJS 工具对窗口内容注入js , 以具备操控网页能力
 * @param url 要打开的网页 URL
 * @param options 可选，{ id?: string, width?: number, height?: number }
 * @returns 返回 { windowId: string, message: string }，用返回的 windowId 传给 injectJS
 */
declare function openBrowserWindow(url: string, options?: { id?: string; width?: number; height?: number }): Promise<any>;

/**
 * 向指定窗口注入 JS 代码并返回执行结果（支持 async/await）。 如果需要可以使用js模拟点击等任何操作.
 * @param windowId 目标窗口 ID
 * @param code 要注入的 JS 代码（支持 await，返回值会被返回）
 * @returns JS 执行结果
 */
declare function injectJS(windowId: string, code: string): Promise<any>;

// ================= MCP =================

/**
 * 调用 MCP server 提供的工具。
 * 使用前先调用 mcpListServers() 和 mcpGetTools() 查询可用能力。
 * @param server MCP server 名称
 * @param tool 要调用的工具名
 * @param args 工具参数对象
 * @returns 工具执行结果（纯文本）
 * @throws 连接失败、工具不存在或调用出错时抛出异常
 */
declare function mcpCall(server: string, tool: string, args?: Record<string, unknown>): Promise<string>;

/**
 * 列出所有已配置的 MCP server（含启用状态、连接状态和工具数量）。
 * 使用 MCP 前先调用此函数查看当前可用 server。
 * @returns 纯文本 server 列表
 */
declare function mcpListServers(): Promise<string>;

/**
 * 查看指定 MCP server 提供的工具列表（含描述和参数）。
 * 确认工具能力后再调用 mcpCall。
 * @param serverName MCP server 名称
 * @returns 纯文本工具列表
 * @throws server 不存在或连接失败时抛出异常
 */
declare function mcpGetTools(serverName: string): Promise<string>;

// ================= 子 Agent 委派 =================

/** subagent 的入参 */
interface SubagentOptions {
  /** 子 Agent 模板 id（对应 agents/ 目录下的 .md 文件名，不含扩展名）。省略则用通用子 Agent。 */
  agentType?: string;
  /** 委派给子 Agent 的任务描述（必填）。子 Agent 是无状态的，任务描述要自包含、边界清晰。 */
  task: string;
  /** 任务总超时（毫秒）。默认 1800000（30 分钟）。 */
  timeoutMs?: number;
}

/** subagent 的返回值 */
interface SubagentResult {
  /** 完整结果的落盘文件绝对路径（结果统一写入 .cuckoo/subagent-results/{taskId}.md） */
  resultFile: string;
  /** 结果前 500 字预览，供快速判断交付内容 */
  preview: string;
  /** 质量检测/真实性校验发现的问题（Task 9 后可能存在） */
  warning?: string;
}

/**
 * 委派一个边界清晰的子任务给独立子 Agent 窗口执行，并阻塞等待其最终交付。
 * 子 Agent 拥有与主 Agent 相同的工具能力（read/write/bash 等）。
 *
 * 使用要点：
 * 1. task 要写清楚交付格式：让子 Agent 在 subagent_result 代码块中给出「纯文本/JSON」交付物。
 * 2. 返回值是对象，不是字符串——用 log(result.preview) 看摘要，用 read(result.resultFile) 读完整内容。
 * 3. 任务完成后子窗口会自动关闭；不要依赖子 Agent 保留上下文，续作时把上一轮 resultFile 路径写进 task。
 * 4. 串行执行：同一时间只会有一个子 Agent 在跑。
 *
 * @param options 入参：agentType / task / timeoutMs
 * @returns Promise<SubagentResult>（工具层统一包装：{ resultFile, preview, warning? }）
 * @throws task 为空、agentType 不存在、子 Agent 执行失败或超时
 */
declare function subagent(options: SubagentOptions): Promise<SubagentResult>;

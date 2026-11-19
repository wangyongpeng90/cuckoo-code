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
 */

/** 当前项目根目录（初始化项目后由系统注入）。未初始化时为 null。 */
declare const projectDir: string | null;

/** 向执行日志输出中间结果（随执行结果回传给 AI）；只在 cuckoo 代码块 JS 层可用，不要写进 bash/pwsh 命令字符串。 */
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
 * 读取 UTF-8 文本文件并返回带行号的内容窗口（首行文件信息，正文「行号: 内容」，末行续读提示）。
 * 大文件用 offset/limit 分段；查看文本用 read，不要用 cat 等 shell 命令。
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
 * 读取 UTF-8 文本文件并返回结构化行数组（number/text），适合在内存里批量处理；仅查看内容用 read。
 */
declare function readLines(filePath: string, options?: ReadOptions): Promise<ReadLinesResult>;

/**
 * 创建或完全覆盖 UTF-8 文本文件。
 * 已有文件会被覆盖：覆盖前先 read，局部修改优先用 edit；content 必须是文件原文，不要带 read 输出的行号/footer。
 */
declare function write(filePath: string, content: string): Promise<string>;

/**
 * 在现有 UTF-8 文本文件中用 newString 替换字面量 oldString。
 * oldString 必须是文件原文（可跨行），注意空白与缩进；默认要求唯一匹配，多次出现时提供更长上下文或 replaceAll: true。
 * 局部修改优先用 edit，不要整文件重写；批量替换前可用 dryRun 预览。
 */
declare function edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean, dryRun?: boolean): Promise<string>;


// ================= 搜索 =================

/**
 * 按 glob 模式查找文件路径（* 单层、** 任意层级、? 单字符），返回 / 分隔的纯文本列表。
 * 只返回文件，含隐藏/忽略文件，默认排除 node_modules、dist 等；不含 "/" 的模式匹配任意深度 basename。用 glob 而不是 shell find。
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
 * 用 ripgrep 正则搜索文件内容，返回按文件分组的「Line N: 内容」；无匹配返回 No matches found。
 * 用 grep 而不是 shell grep/rg；需要上下文时对匹配文件用 read。
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
 * 执行 shell 命令（Windows 用 cmd.exe），返回 stdout + [stderr] + 状态标记。
 * 每次调用是全新 shell：cwd/变量/函数不保留，用 workdir 而不是 cd；非零退出不抛异常，以 [exit code: N] 报告；长输出截断为尾部。危险命令会被安全策略拒绝并抛异常。
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
 * 执行 PowerShell 命令（powershell -NoProfile -Command），返回 stdout + [stderr] + 状态标记。
 * 每次调用是全新进程：状态不保留，用 workdir 而不是 cd；路径用 Windows 原生形式，环境变量用 $env:NAME；非零退出以 [exit code: N] 报告，长输出截断为尾部。
 * 读写文件显式加 -Encoding UTF8；PowerShell 5.1 的 UTF8 带 BOM，对 BOM 敏感的内容用 [IO.File]::WriteAllText(路径, 内容, [System.Text.UTF8Encoding]::new($false))。
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
 * 记录并更新当前工作的结构化任务列表：每次发送完整列表并替换旧列表，最多一条 in_progress；完成后立即标 completed，简单单步任务可跳过。
 */
declare function todoWrite(todos: TodoItem[]): Promise<string>;

/**
 * 宣告 /goal 自动多轮任务已全部完成并结束推进；仅在目标所有要求确实完成后调用，调用前先在正文总结。普通对话不要调用。
 */
declare function goalDone(): Promise<string>;


// ================= 删除 =================

/** deleteFile 的返回值 */
interface FileDeleteResult {
  message: string;
  /** 被删除文件的绝对路径 */
  path: string;
}

/**
 * 永久删除单个文件（不可恢复，不能删目录），返回 { message, path }；删除前确认路径。
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
 * 执行 MySQL 语句：查询（SELECT/SHOW/DESCRIBE/EXPLAIN）返回纯文本表格，写操作返回 affectedRows 等统计。
 */
declare function mysql(options: MySQLOptions): Promise<string>;


// ================= WebFetch =================

/**
 * 获取 HTTP(S) URL 内容并解码为文本（HTML→Markdown），返回 Fetched <url> (HTTP <status>) + 正文。
 * 超过约 20000 字符会截断并附 footer；引用内容时用 markdown 链接标注 URL。
 */
declare function webFetch(url: string): Promise<string>;

/**
 * 打开 Electron 浏览器窗口并返回 windowId；后续用 injectJS(windowId, code) 操控页面。可传自定义 id 便于管理。
 */
declare function openBrowserWindow(url: string, options?: { id?: string; width?: number; height?: number }): Promise<any>;

/**
 * 向指定窗口注入 JS 并返回执行结果（支持表达式或 async 函数体，顶层 await 可用）；执行出错抛异常。
 */
declare function injectJS(windowId: string, code: string): Promise<any>;


// ================= Agent =================

/**
 * 把任务委派给子代理（独立上下文）执行，只返回最终结果摘要；适合大范围搜索/分析等独立子任务，避免污染当前上下文。
 */
declare function runAgent(name: string, task: string): Promise<string>;


// ================= 附件上传 =================

/**
 * 将本地文件作为附件上传到当前输入框（不发送），随下一条消息发出。适合 PDF/Word/Excel/PPT/图片等 read 不了的二进制文件；文本文件优先 read。仅支持已存在的单个文件，上限 30MB。
 */
declare function attachFile(filePath: string): Promise<{ fileName: string; size: number; message: string }>;


// ================= MCP =================

/**
 * 调用 MCP server 的工具；使用前先用 mcpListServers / mcpGetTools 查询可用能力。
 */
declare function mcpCall(server: string, tool: string, args?: Record<string, unknown>): Promise<string>;

/**
 * 列出已配置的 MCP server（启用/连接状态、工具数量）；使用 MCP 前先调用。
 */
declare function mcpListServers(): Promise<string>;

/**
 * 查看指定 MCP server 的工具及参数；确认后再调 mcpCall。
 */
declare function mcpGetTools(serverName: string): Promise<string>;

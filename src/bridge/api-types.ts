/**
 * electronAPI 类型契约：preload（src/bridge/api.ts）暴露给渲染进程的桥接 API。
 * 返回类型按 src/app 下对应 IPC handler 的实际返回形状声明；
 * 覆盖层与 bridge 一律通过 window.electronAPI 访问，禁止 (window as any)。
 */

/** execute-command：执行结果（canceled 仅在用户取消时出现；stdout/stderr 仅在真正执行后出现） */
export interface ExecuteCommandResult {
  id: string;
  success: boolean;
  error: string | null;
  canceled?: boolean;
  stdout?: string;
  stderr?: string;
}

/** init-project / updateProjectDir：主进程 initProject 的返回（canceled 仅在用户取消目录选择时出现） */
export interface InitProjectResult {
  success: boolean;
  message: string;
  canceled?: boolean;
}

/** get-project-dir：当前窗口的项目目录（未选择时为 null） */
export interface GetProjectDirResult {
  success: boolean;
  projectDir: string | null;
}

/** execute-tool：工具执行结果（data 为工具自定义载荷） */
export interface ExecuteToolResult {
  callId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** execute-js：JS 沙箱执行结果（对应 JsRunner.run 的返回 + callId） */
export interface ExecuteJsResult {
  callId: string;
  success: boolean;
  output?: string;
  error?: string;
}

/** list-profiles：profile 记录（对应 app/profile.ts 持久化形状） */
export interface ProfileInfo {
  id: string;
  providerId: string;
  name: string;
  partition: string;
  createdAt: string;
  autoOpen: boolean;
  lastUrl?: string;
  isSubagent?: boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
}

/** list-providers：平台摘要 */
export interface ProviderSummary {
  id: string;
  name: string;
  custom: boolean;
  path: string | null;
}

/** import-provider / replace-provider：成功带 provider，失败带 canceled 或 error */
export type ImportProviderResult =
  | { success: true; provider: { id: string; name: string; path: string } }
  | { success: false; canceled?: boolean; error?: string };

/**
 * list-mcp-servers 返回的 server 条目。
 * 默认分支（mcp/client.ts listConfiguredServers）：name/source/type/enabled/connected/toolCount。
 * scope='user' 分支（mcp/config.ts getUserServers）：完整定义字段，无 connected/toolCount。
 */
export interface McpServerInfo {
  name: string;
  source: 'project' | 'user';
  type: 'http' | 'stdio';
  enabled: boolean;
  connected?: boolean;
  toolCount?: number;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  cwd?: string;
}

/** upsert-mcp-server 的 server 配置（Claude Desktop 兼容格式） */
export interface McpServerConfig {
  name: string;
  type: 'http' | 'stdio';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  cwd?: string;
}

/** get-mcp-tools 返回的工具条目（server 字段为宿主 server 名） */
export interface McpToolInfo {
  server: string;
  name: string;
  description: string;
  inputSchema: unknown;
}

/** refresh-skills：技能 + 代理清单 */
export type RefreshSkillsResult =
  | { success: true; section: string; skillCount: number; agentCount: number }
  | { success: false; error: string };

/**
 * 工具活动条目（任务面板）：executor 按 detected→running→done 上报，同 id 更新。
 * running 时 output 为空；历史存主进程内存（上限 50，窗口关闭即丢）。
 */
export interface ToolActivityEntry {
  id: string;
  command: string;
  success: boolean;
  canceled: boolean;
  output: string;
  timestamp: number;
  status: 'running' | 'done';
}

/**
 * overlay 设置（主进程 userData/settings.json 持久化，键名与字段一一对应）
 * 延迟类字段单位均为毫秒；autoCompactThreshold 单位为万 token。
 */
export interface Settings {
  /** 失败自动重试开关 */
  retryEnabled: boolean;
  /** 普通失败重试间隔（毫秒） */
  retryDelayMin: number;
  retryDelayMax: number;
  /** 普通失败重试次数（负数 = 无限） */
  retryCount: number;
  /** 操作频繁（429）重试间隔（毫秒） */
  retry429Delay: number;
  /** 操作频繁（429）重试次数（负数 = 无限） */
  retry429Count: number;
  /** 重试提示词 */
  retryPrompt: string;
  /** SSE 流静默阈值（毫秒，<=0 禁用；主世界 hook 经 localStorage 镜像读取） */
  xhrIdleTimeout: number;
  /** 看门狗催继续提示词 */
  watchdogPrompt: string;
  /** 看门狗最大催次数（负数 = 无限） */
  watchdogCount: number;
  /** 发送延迟（毫秒） */
  sendDelayMin: number;
  sendDelayMax: number;
  /** 附件上传间隔（毫秒） */
  attachDelayMin: number;
  attachDelayMax: number;
  /** 自动压缩开关 */
  autoCompactEnabled: boolean;
  /** 自动压缩阈值（万 token） */
  autoCompactThreshold: number;
}

export interface ElectronAPI {
  executeCommand(command: string, id: string): Promise<ExecuteCommandResult>;
  /** 平台选择页（无聊天输入框）初始化时传 skipPrompt=true：只选目录存映射，不发初始提示 */
  initProject(projectDir?: string | null, isCompaction?: boolean, extraPrompt?: string, noDialog?: boolean, skipPrompt?: boolean): Promise<InitProjectResult>;
  updateProjectDir(): Promise<InitProjectResult>;
  getProjectDir(): Promise<GetProjectDirResult>;
  executeTool(toolName: string, params: Record<string, unknown>, callId: string): Promise<ExecuteToolResult>;
  executeJs(code: string, callId: string): Promise<ExecuteJsResult>;
  sendEnterToChat(): Promise<boolean>;
  simulateMouse(action: 'move' | 'click', x: number, y: number): Promise<boolean>;
  listSessions(): Promise<{ success: true; sessions: string[] }>;
  navigateSession(sessionId: string): Promise<{ success: boolean; error?: string }>;
  createProfileWindow(): Promise<{ success: true }>;
  listProfiles(): Promise<{ success: true; profiles: ProfileInfo[] }>;
  openProfileWindow(profileId: string): Promise<{ success: boolean; focused?: boolean; error?: string }>;
  setProfileAutoOpen(profileId: string, autoOpen: boolean): Promise<{ success: boolean; error?: string }>;
  deleteProfileWindow(profileId: string): Promise<{ success: boolean; error: string | null }>;
  updateWindowName(displayName: string): Promise<{ success: boolean; name?: string | null; error?: string }>;
  showAiNotification(): Promise<{ success: boolean; skipped?: boolean; reason?: string; error?: string }>;
  updateTokenUsage(context: number, cumulative: number, windowCumulative: number, todayCumulative: number): Promise<{ success: true }>;
  /** 上报工具活动到任务面板（同 id 从 running 更新为 done） */
  reportToolActivity(entry: ToolActivityEntry): Promise<{ success: boolean }>;
  refreshSkills(): Promise<RefreshSkillsResult>;
  listMcpServers(opts?: { scope?: 'user' }): Promise<{ success: true; servers: McpServerInfo[] }>;
  upsertMcpServer(server: McpServerConfig): Promise<{ success: boolean; error?: string }>;
  removeMcpServer(name: string): Promise<{ success: true }>;
  enableMcpServer(name: string): Promise<{ success: boolean; error?: string }>;
  disableMcpServer(name: string): Promise<{ success: true }>;
  getMcpTools(): Promise<{ success: true; tools: McpToolInfo[] }>;
  listProviders(): Promise<{ success: true; providers: ProviderSummary[] }>;
  selectPlatform(providerId: string): Promise<{ success: boolean; error?: string }>;
  createProfileWindowWithProvider(providerId: string): Promise<{ success: true }>;
  importProvider(): Promise<ImportProviderResult>;
  removeProvider(filePath: string, providerId: string): Promise<{ success: boolean; error?: string }>;
  replaceProvider(providerId: string): Promise<ImportProviderResult>;
  // ========== 设置（主进程 settings.json）==========
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<{ success: true; settings: Settings }>;
  resetSettings(): Promise<{ success: true; settings: Settings }>;
  /** 旧版 localStorage 设置迁入（主进程只应用一次，applied 表示是否实际写入） */
  migrateSettings(patch: Partial<Settings>): Promise<{ success: true; applied: boolean }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

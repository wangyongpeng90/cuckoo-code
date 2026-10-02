/**
 * 壳页面 API 类型（preload 经 contextBridge 注入的 window.shellAPI）。
 * 全部方法可选——用防御式调用（if (api.xxx) api.xxx()）。
 */
export interface ShellAPI {
  navigate?: (url: string) => void;
  back?: () => void;
  forward?: () => void;
  reload?: () => void;
  home?: () => void;
  onUrlUpdated?: (cb: (data: any) => void) => void;
  toggleSidebar?: (width: number) => void;
  /** 网页端会话列表（DOM 读取，实时同步网页） */
  listWebSessions?: () => Promise<any>;
  navigateWebSession?: (url: string) => Promise<any>;
  newWebConversation?: () => Promise<any>;
  onWebUrlChanged?: (cb: () => void) => void;
  /** harness 生成中（busy=true → 禁用对话切换） */
  onHarnessBusy?: (cb: (busy: boolean) => void) => void;
  // 插件市场 / 安装
  pluginMarketList?: (opts?: any) => Promise<any>;
  pluginMarketRemote?: (targets: any) => Promise<any>;
  pluginInstall?: (repo: string, branch: string, upgrade: boolean) => Promise<any>;
  pluginUninstall?: (id: string) => Promise<any>;
  listInstalledPlugins?: () => Promise<any>;
  pluginSetEnabled?: (id: string, enabled: boolean) => Promise<any>;
  pluginOpenDir?: () => Promise<any>;
  /** 切换纯净对话模式（Harness） */
  toggleHarness?: () => Promise<any>;
  /** 纯净模式状态变化（harness=true 表示已进入纯净模式） */
  onHarnessMode?: (cb: (data: { harness: boolean }) => void) => void;
  reportShellSize?: (w: number, h: number) => void;
  initProject?: (dir?: string | null, isCompaction?: boolean, extraPrompt?: string, noDialog?: boolean) => Promise<any>;
  updateProjectDir?: () => Promise<any>;
  onProjectDir?: (cb: (dir: string | null) => void) => void;
  getProjectDir?: () => Promise<any>;
  onPlatformMode?: (cb: (data: any) => void) => void;
  /** 会话标题/归档变化（如 AI 命名对话）→ 刷新工作区列表 */
  onSessionsChanged?: (cb: () => void) => void;
  // 会话（侧边栏「工作区」页）
  listAllSessions?: () => Promise<any>;
  navigateSession?: (sessionId: string) => Promise<any>;
  setSessionArchived?: (sessionId: string, archived: boolean) => Promise<any>;
  getDirInfo?: (dir: string) => Promise<{ success: boolean; dir?: string; createdAt?: string | null; error?: string }>;
  setProjectArchived?: (dir: string, archived: boolean) => Promise<any>;
  setSessionTitle?: (sessionId: string, title: string) => Promise<any>;
  newConversationForProject?: (projectDir: string) => Promise<any>;
  // 提示词
  listSnippets?: () => Promise<any>;
  getSnippets?: () => Promise<any>;
  saveSnippets?: (list: any[]) => Promise<any>;
  triggerSnippet?: (content: string, autoSend?: boolean) => Promise<any>;
  appendSnippet?: (text: string) => Promise<any>;
  onSnippetsChanged?: (cb: () => void) => void;
  // 技能 / 子代理
  listSkills?: () => Promise<any>;
  listAgents?: () => Promise<any>;
  createAgentFile?: (name: string, scope: string) => Promise<any>;
  openAgentFile?: (agentPath: string) => Promise<any>;
  renameAgent?: (agentPath: string, newName: string) => Promise<any>;
  deleteAgentFile?: (agentPath: string) => Promise<any>;
  // MCP
  listMcpServers?: () => Promise<any>;
  enableMcpServer?: (name: string) => Promise<any>;
  disableMcpServer?: (name: string) => Promise<any>;
  // 窗口
  listProfiles?: () => Promise<any>;
  createProfileWindow?: () => Promise<any>;
  openProfileWindow?: (id: string) => Promise<any>;
  deleteProfileWindow?: (id: string) => Promise<any>;
  setProfileAutoOpen?: (id: string, on: boolean) => Promise<any>;
  // Token / 自动压缩
  getAutoCompact?: () => Promise<any>;
  saveAutoCompact?: (data: any) => Promise<any>;
  triggerCompact?: () => Promise<any>;
  // 设置
  getSettings?: () => Promise<any>;
  saveSettings?: (data: any) => Promise<any>;
  resetSettings?: () => Promise<any>;
  // 关于
  getAppInfo?: () => Promise<any>;
  checkUpdate?: () => Promise<any>;
  getAssetUrl?: (rel: string) => Promise<any>;
  openExternal?: (url: string) => Promise<any>;
  openFeishuSetup?: () => Promise<any>;
  // 飞书
  getFeishuConfig?: () => Promise<any>;
  saveFeishuConfig?: (data: any) => Promise<any>;
  reconnectFeishu?: () => Promise<any>;
  disconnectFeishu?: () => Promise<any>;
  listFeishuChats?: () => Promise<any>;
  getFeishuBinding?: () => Promise<any>;
  bindFeishuChat?: (chatId: string, chatName: string) => Promise<any>;
}

# DSH API 覆盖度清单

> 对照 DSH 官方源码自动提取的 Context 服务覆盖清单。
> 每次适配新插件后，回来更新「状态」列。
> 相关：[022 DSH 插件兼容](requirements/022-dsh-plugin-compat.md) | [DSH 兼容决策](dsh-compat-decisions.md)

## 总览

| 项 | 值 |
|---|---|
| DSH Context 服务总数 | 119 |
| 已实现 | 32 |
| 未实现 | 87 |
| 覆盖率 | 27% |

**说明**：
- `✅ Y` = 已在 `loader.ts` / `dsh-compat/*.ts` / `dsh-client-runtime.ts` 中实现（可能是最小可用版）
- `❌ N` = 未实现，插件访问时会走 stub 或报错
- 「最小实现」不代表功能完整——只代表 DSH 插件调用时不会崩，可能缺高级能力

---

## 核心 / 工具（6 / 11）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `tools` | core | ToolRuntime | ✅ Y |
| `systemPrompt` | core | SystemPrompt | ✅ Y |
| `fs` | fs | FileSystem | ✅ Y |
| `shell` | shell | ShellExecutor | ✅ Y |
| `terminals` | terminal | TerminalSessionService | ✅ Y |
| `web` | web | WebRuntime | ✅ Y |
| `mcpResources` | mcp | McpResourceRuntime | ✅ Y |
| `subprocess` | subprocess | SubprocessRuntime | ❌ N |
| `sandbox` | sandbox | SandboxProvider | ❌ N |
| `sandboxPolicy` | sandbox | SandboxPolicyService | ❌ N |
| `shellEnv` | shell | ShellEnvRegistry | ❌ N |

## 会话（6 / 15）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `sessions` | core | SessionStore | ✅ Y |
| `sessionTitle` | session | SessionTitleService | ✅ Y |
| `sessionProjections` | session | SessionProjectionRegistry | ✅ Y |
| `sessionQuery` | session-query | SessionQueryEngine | ✅ Y |
| `sessionPersistence` | session | SessionPersistence | ❌ N |
| `sessionProjectionCache` | session | SessionProjectionCache | ❌ N |
| `sessionLogDownload` | session-query | SessionLogDownloadController | ❌ N |
| `sessionController` | api | SessionController | ❌ N |
| `sessionFileReferences` | api | SessionFileReferences | ❌ N |
| `sessionReferenceResolver` | context | SessionReferenceResolver | ❌ N |
| `sessionSkillCatalog` | api | SessionSkillCatalog | ❌ N |
| `sessionTelemetry` | session | SessionTelemetryBackend | ❌ N |
| `sessionFeedback` | feedback | SessionFeedbackService | ❌ N |
| `fileReferences` | context | FileReferenceService | ❌ N |
| `spillStore` | spill | SpillStore | ❌ N |

## 存储（2 / 2）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `storage` | storage | Storage | ✅ Y |
| `storageDomain` | storage | DomainFacility | ✅ Y |

## 注册表（7 / 8）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `skills` | skill | SkillRegistry | ✅ Y |
| `subagents` | subagent | SubagentRuntime | ✅ Y |
| `workspaceRegistry` | workspace | WorkspaceRegistry | ✅ Y |
| `workspaceFiles` | api | WorkspaceFiles | ✅ Y |
| `goals` | goal | GoalService | ✅ Y |
| `llm` | llm | LlmRuntime | ✅ Y |
| `tokenMeter` | llm | TokenMeter | ✅ Y |
| `subagentModelSelection` | subagent | SubagentModelSelectionConfig | ❌ N |

## 客户端 UI（3 / 20）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `slots` | client | SlotRegistry | ✅ Y |
| `settings` | settings | SettingsForms | ✅ Y |
| `webServer` | host | WebServer | ✅ Y |
| `uiWorkspace` | client | UiWorkspace | ❌ N |
| `uiSession` | client | UiSession | ❌ N |
| `uiRenderer` | client | UiRendererService | ❌ N |
| `locale` | client | LocaleRuntime | ❌ N |
| `theme` | client | ThemeRuntime | ❌ N |
| `shortcuts` | client | Shortcuts | ❌ N |
| `sidebarRight` | client | SidebarRightController | ❌ N |
| `sidebarRightTabs` | client | SidebarRightTabRegistry | ❌ N |
| `resources` | client | Resources | ❌ N |
| `modules` | client | ClientModuleLoader | ❌ N |
| `fileUpload` | client | FileUploadService | ❌ N |
| `fileUploads` | client | FileUploads | ❌ N |
| `settingsSchema` | client | SettingsSchemaService | ❌ N |
| `settingsController` | api | SettingsController | ❌ N |
| `modelDirectories` | client | ModelDirectoryResolver | ❌ N |
| `userQuestionPanels` | client | UserQuestionPanels | ❌ N |
| `productAnalytics` | client | DesktopAnalytics | ❌ N |

## 扩展机制（1 / 9）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `lsp` | lsp | LspService | ✅ Y |
| `pluginManager` | boot | PluginManager | ❌ N |
| `pluginPackages` | boot | PluginPackages | ❌ N |
| `pluginRegistryProbe` | client | PluginRegistryProbe | ❌ N |
| `profileContext` | boot | ProfileContext | ❌ N |
| `hmr` | boot | Hmr | ❌ N |
| `ptcRuntime` | ptc-runtime | PtcRuntime | ❌ N |
| `typert` | typert | TypertRegistryContract | ❌ N |
| `typertGateway` | api | TypertGateway | ❌ N |

## 其他（13 / 54）

| 服务 | DSH 包 | 类型 | 状态 |
|---|---|---|---|
| `workspaceController` | api | WorkspaceController | ❌ N |
| `workspaceChanges` | deliverables | WorkspaceChanges | ❌ N |
| `workflowEngine` | workflow | WorkflowEngine | ❌ N |
| `webhookRuntime` | webhook | WebhookRuntime | ❌ N |
| `webTerminals` | api | ClientTerminals | ❌ N |
| `userQuestions` | interaction | UserQuestionService | ❌ N |
| `toolResultPruner` | compaction | ToolResultPruner | ❌ N |
| `terminalController` | api | TerminalController | ❌ N |
| `schedule` | schedule | ScheduleService | ❌ N |
| `jobs` | api | IJobs | ❌ N |
| `jobController` | api | JobController | ❌ N |
| `planMode` | plan | PlanModeController | ❌ N |
| `permissionPresets` | interaction | PermissionPresetService | ❌ N |
| `remote` | api | ClientRemote | ❌ N |
| `directoryPicker` | host | DirectoryPicker | ❌ N |
| `directoryPickerController` | api | DirectoryPickerController | ❌ N |
| `documentPreviews` | client | DocumentPreviewRegistry | ❌ N |
| `dynamicCordisRunner` | extensions | CordisRunnerFace | ❌ N |
| `feedbackUi` | client | FeedbackUi | ❌ N |
| `messageFeedback` | feedback | MessageFeedbackService | ❌ N |
| `deepseekAccount` | credentials | DeepSeekAccount | ❌ N |
| `credentials` | credentials | CredentialProvider | ❌ N |
| `credentialsController` | api | CredentialsController | ❌ N |
| `deepseekLlmApiExtensions` | llm | DeepSeekLlmApiExtensionRegistry | ❌ N |
| `inspector` | experimental | InspectorService | ❌ N |
| `invariants` | runtime-diagnostics | InvariantRegistry | ❌ N |
| `launchEnvironment` | util | LaunchEnvironmentSnapshot | ❌ N |
| `officeToPdf` | document | OfficeToPdf | ❌ N |
| `otel` | telemetry | OTel | ❌ N |
| `speechController` | experimental | SpeechController | ❌ N |
| `speechToText` | experimental | SpeechToText | ❌ N |
| *(其余低频服务见 DSH 源码)* | — | — | ❌ N |

---

## 适配新插件的流程

1. 拿到插件后，先看它 `apply(ctx)` 里访问了哪些 `ctx.xxx`
2. 对照本清单，看这些服务的状态
3. 未实现的按业务优先级补：优先补「插件启动时必调」的（如 `ctx.workspaceRegistry`），次要补「用户点击才调」的（如 `ctx.uiWorkspace.openSession`）
4. 补完后回到本清单，把状态改成 `✅ Y`

---

## 下一步建议优先补全的（按插件开发习惯推测）

| 服务 | 理由 |
|---|---|
| `uiWorkspace` | 客户端打开工作区（当前只有主进程版） |
| `sessions`（客户端版） | 客户端会话列表/切换 |
| `jobs` / `jobController` | 后台任务，定时类插件必用 |
| `settingsController` | 设置表单动态渲染（`settings` 已实现但只是最小版） |
| `sessionPersistence` | 会话持久化（如果插件要导出/导入会话） |

---

*本清单基于 DSH v0.2.0-rc.2 源码提取，DSH 版本升级后需重新对照。*

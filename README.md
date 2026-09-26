# Cuckoo Code

<p align="center">
  <a href="https://github.com/wangyongpeng90/cuckoo-code/releases/latest"><img src="https://img.shields.io/github/v/release/wangyongpeng90/cuckoo-code?style=flat-square&color=8b93ff" alt="Latest Release"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/wangyongpeng90/cuckoo-code/build.yml?style=flat-square&label=Build" alt="Build Status"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/wangyongpeng90/cuckoo-code/release.yml?style=flat-square&label=Release" alt="Release Status"></a>
  <a href="https://codecov.io/gh/wangyongpeng90/cuckoo-code"><img src="https://codecov.io/gh/wangyongpeng90/cuckoo-code/branch/master/graph/badge.svg" alt="codecov"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/github/stars/wangyongpeng90/cuckoo-code?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/releases"><img src="https://img.shields.io/github/downloads/wangyongpeng90/cuckoo-code/total?style=flat-square&color=green" alt="Downloads"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-8b93ff?style=flat-square" alt="Platform"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron"></a>
</p>

[English](README.en.md) | 中文

[下载最新版本](https://github.com/wangyongpeng90/cuckoo-code/releases/latest)

**Cuckoo Code** 是一个零 Token 成本的 AI Agent 桌面端。

> 📐 **要改代码 / 做新需求？先读 [架构与开发指南](docs/architecture.md)**（目录结构、依赖规则、构建流程、任务手册）。

它通过 Electron 将 AI 网页版（DeepSeek、Claude 等）嵌入本地窗口，并注入侧边覆盖层。AI 被系统提示词引导生成工具调用（JavaScript 代码块），经用户确认后在本地沙箱中执行，再把结果回传给 AI。整个过程不需要 API Key，不产生 API 调用费用——你用的是网页版账号，而不是按 Token 计费的接口。

---

## 核心特性

### 零 Token 成本

不调用任何 AI 平台 API，不使用 API Token。直接复用网页版聊天能力，把网页版 AI 变成可执行本地操作的 Agent。

### 多平台 Provider 框架

- 内置 **DeepSeek**、**Claude**、**ChatGPT** 三个平台
- 每个平台独立封装输入框定位、发送按钮检测、回复完成判断、消息解析等差异
- 新建窗口时可选择平台，也可**导入自定义 Provider**（提供类型声明和模板，降低扩展门槛）

### 真正的 AI Agent

不只是聊天。AI 可以读写文件、搜索代码、执行命令、查询数据库、调用 MCP 工具，并依据执行结果继续下一步，形成"思考 → 行动 → 观察 → 再行动"的 Agent 循环。

---

## 主要功能

- **多窗口管理**：每个窗口独立 Profile 上下文，互不干扰；可勾选「默认」在启动时自动打开
- **地址栏**：顶部地址栏显示/复制 URL、前进后退刷新、快速跳转；下方状态条显示 token 用量
- **项目初始化**：选择项目目录后，AI 获得目录树和系统提示词，操作基于真实项目上下文
- **Skill 支持**：对齐 Claude Code 的技能机制（项目级 `.cuckoo/skills/` + 用户级 `~/.cuckoo/skills/`），渐进式披露
- **工具调用系统**：AI 可调用读写文件、搜索代码、执行命令、查询数据库等工具
- **工具执行遮罩**：执行期间在 AI 页面显示遮罩，可点击「停止」取消回传
- **MCP 支持**：采用 Claude Desktop 兼容格式配置，支持 stdio / http 类型 server
- **覆盖层面板**：显示命令预览、执行结果和历史记录，支持 Ctrl+Shift+C 或 Esc 切换
- **上下文压缩**：长会话自动压缩（清 IDB + 刷新 + 建分享链接），避免超上下文上限
- **自动重试**：两类机制——① 回复被服务端截断/失败时按退避重试；② 看门狗检测 SSE 流静默时催「请继续」
- **会话持久化**：登录状态和设置保存到 %APPDATA%/cuckoo-ai-pro-session
- **安全机制**：30 秒命令超时、60 秒沙箱超时、1MB 输出缓冲区、危险命令确认

---

## 安装与运行

### 环境要求

- Node.js >= 16.0.0（与 `package.json` 的 `engines` 一致；建议 18+）
- npm

### 步骤

```bash
# 克隆仓库
git clone https://github.com/wangyongpeng90/cuckoo-code.git
cd cuckoo-code

# 安装依赖
npm install

# 若 npm 阻止了 electron/esbuild 的 postinstall 脚本（allowScripts 机制），先批准：
#   npm install-scripts ls          # 查看被阻止的包
#   npm install-scripts approve --all   # 或逐个 approve electron esbuild
#   npm install                     # 再装一次，确保二进制下载
# 否则 electron 二进制不会下载，启动会报错

# 启动应用
npm start
```

---

## 使用指南

1. 启动应用，选择平台（DeepSeek / Claude / 自定义 Provider）
2. 正常登录对应平台的网页版账号
3. 点击「初始化项目」选择项目目录，AI 会获得目录树和系统提示词
4. 与 AI 对话，让它帮你修改文件、运行命令、查询代码等
5. AI 回复中的工具调用会被自动检测并执行
6. 执行结果自动回传 AI，AI 继续下一步，直到任务完成

### 工具调用示例

AI 回复中包含以下格式的 `cuckoo` 代码块时，系统会在沙箱中执行，并把结果回传给 AI：

````markdown
```cuckoo
const content = await read("src/infra/paths.ts");
await write("src/infra/paths.ts", content.replace("resolveAsset", "resolveResource"));
```
````

---

## 工具系统

支持的工具（通过 `cuckoo` 代码块调用）：

| JS 函数 | 功能描述 |
|----------|----------|
| `read(path, options?)` | 读取文本文件（带行号窗口） |
| `readLines(path, options?)` | 读取文件为结构化行数组 |
| `write(path, content)` | 创建或覆盖文件 |
| `edit(path, old, new, replaceAll?, dryRun?)` | 精确替换文件内容 |
| `glob(pattern, searchPath?)` | 按 glob 模式查找文件 |
| `grep(pattern, options?)` | 正则搜索文件内容 |
| `bash(command, options?)` | 执行 shell 命令（cmd） |
| `pwsh(command, options?)` | 执行 PowerShell 命令 |
| `todoWrite(todos)` | 管理结构化任务列表 |
| `deleteFile(path)` | 删除文件（不可恢复） |
| `webFetch(url)` | 获取 HTTP(S) URL 内容（HTML 转 Markdown） |
| `mysql(options)` | 执行 MySQL SQL |
| `openBrowserWindow(url, options?)` | 打开 Electron 浏览器窗口 |
| `injectJS(windowId, code)` | 向指定窗口注入 JS |
| `attachFile(path)` | 将本地文件作为附件上传到输入框 |
| `mcpListServers()` | 列出已配置的 MCP server |
| `mcpGetTools(serverName)` | 查看 MCP server 工具列表 |
| `mcpCall(server, tool, args)` | 调用 MCP 工具 |
| `log(...args)` | 输出中间结果到执行日志 |

所有文件操作均相对于当前绑定的项目目录，确保安全。

---

## MCP 配置

MCP 配置采用 **Claude Desktop 兼容格式**（可直接分享/导入）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/my-project"]
    }
  }
}
```

支持 stdio（command + args）和 http（url + headers）两种类型。启用/禁用状态单独存储，不污染主配置。通过覆盖层的「MCP」按钮打开管理面板。

---

## 自定义 Provider

想要接入新的 AI 平台？复制 `src/providers/custom/provider.template.js`，按模板填写：

- `id` / `name` / `homeUrl` 等基本信息
- 输入框、发送按钮的选择器
- `matchesUrl()`、`extractSessionId()` 等方法
- 自动解析相关方法（完成检测、消息定位等）

类型声明见 `src/providers/types.ts`。在应用内通过平台选择页导入 JS 文件即可使用。

---

## 项目结构

```
cuckoo-code/
├── start.js                 # 跨平台启动脚本（先编译再启动，日志写入 wyp/log/）
├── package.json             # main 指向 out/src/app/entry.js（无薄壳入口）
├── src/
│   ├── app/                 # 应用外壳（主进程）
│   │   ├── entry.ts         # 应用入口、窗口创建、应用菜单
│   │   ├── shell-preload.ts # 地址栏壳页面 preload
│   │   ├── window.ts        # 多窗口管理（WebContentsView 架构）
│   │   ├── profile.ts       # 窗口 Profile 管理
│   │   ├── token-stats.ts   # 系统总累计 token（跨窗口持久化）
│   │   └── ipc/             # IPC 处理器（project/session/command/tool/renderer/shell）
│   ├── session/             # 会话与项目上下文
│   │   ├── store.ts         # 会话-目录映射持久化
│   │   ├── project-context.ts # 项目初始化
│   │   ├── prompt-builder.ts  # 系统提示词组装
│   │   └── compaction.ts      # 上下文压缩
│   ├── bridge/              # 与 AI 网页桥接（preload）
│   │   ├── entry.ts         # preload 入口
│   │   ├── api.ts           # contextBridge API 暴露
│   │   ├── intercept/       # 网络拦截响应处理
│   │   ├── parser/          # JS/JSON 工具调用解析
│   │   └── loop/            # 执行器、看门狗、重试引擎
│   ├── overlay/             # 覆盖层 UI
│   │   ├── panel.ts         # 面板基础能力（注入、提示、历史）
│   │   ├── events.ts        # 事件绑定（编排）
│   │   ├── panels/          # 各面板（窗口管理 / MCP / 设置）
│   │   ├── fab.ts           # 悬浮球拖动
│   │   └── template/        # HTML/CSS 模板（构建期生成 TS）
│   ├── tools/               # 工具系统
│   │   ├── api.d.ts         # AI 工具契约（构建期生成）
│   │   ├── core/            # Tool / ToolRegistry / ToolResult
│   │   ├── runtime/         # JsRunner 沙箱执行器
│   │   └── impl/            # 各工具实现
│   ├── providers/           # 平台 Provider
│   │   ├── types.ts         # Provider 接口
│   │   ├── deepseek.ts / claude.ts / chatgpt.ts
│   │   ├── hooks/           # 网络拦截器源码（构建期打包为字符串）
│   │   └── custom/          # 自定义 Provider 加载器与模板
│   ├── skills/              # Skill 机制（扫描 / frontmatter / 提示词）
│   ├── mcp/                 # MCP 客户端与配置
│   ├── infra/               # 基础设施（路径 / 换行符 / 日志 / 危险命令）
│   ├── prompt/              # 各平台提示词模板
│   └── ui/                  # 壳页面（shell.html / platform-select.html）
├── scripts/                 # 构建脚本（hook 打包、工具 API 生成）
├── test/                    # 单元测试
└── out/                     # TypeScript 编译产物
```

---

## 构建与发布

- 本仓库已配置 GitHub Actions，推送 `v*` 标签（如 `v0.7.1`）会自动构建 Windows 和 macOS 安装包并发布到 Releases
- 本地手动构建：`npm run build:win:local` 或 `npm run build:mac:local`
- 构建产物输出到 `dist/` 目录

---

## Roadmap

下一阶段计划见 [Roadmap.md](Roadmap.md)。

---

## 交流群

加入 Cuckoo Code 用户交流群，与其他用户交流使用经验：

**QQ 群**

<img src="assets/qq-group.jpg" alt="QQ 群" width="240">

**微信群**

<img src="assets/wechat-group.jpg" alt="微信群" width="360">

> 群二维码约 7 天过期，如已失效请在 Issues 中提醒更新。

---

## 贡献

欢迎提交 Issue 和 Pull Request。

- 报告 Bug 或建议新功能：Issues
- 提交代码：Pull Requests

---

## 许可证

本项目使用 GNU General Public License v3.0 许可证。详见 LICENSE 文件。

---

## 致谢

- DeepSeek、Claude 提供强大的 AI 能力
- Electron 提供跨平台桌面框架
- [@27584](https://github.com/27584)：Provider 发送扩展接口、流式稳定性双通道、自定义 Provider 渲染进程加载、MCP 工具识别等框架级改进（PR #9）
- 所有贡献者和用户

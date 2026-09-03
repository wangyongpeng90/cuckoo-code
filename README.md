# Cuckoo Code

<p align="center">
  <a href="https://github.com/wangyongpeng90/cuckoo-code/releases/latest"><img src="https://img.shields.io/github/v/release/wangyongpeng90/cuckoo-code?style=flat-square&color=8b93ff" alt="Latest Release"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/wangyongpeng90/cuckoo-code/build.yml?style=flat-square&label=Build" alt="Build Status"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/wangyongpeng90/cuckoo-code/release.yml?style=flat-square&label=Release" alt="Release Status"></a>
  <a href="https://codecov.io/gh/wangyongpeng90/cuckoo-code"><img src="https://codecov.io/gh/wangyongpeng90/cuckoo-code/graph/badge.svg?token=41fa2f2a-6d7e-4a6d-84b8-7971ce615668" alt="codecov"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/github/stars/wangyongpeng90/cuckoo-code?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code/releases"><img src="https://img.shields.io/github/downloads/wangyongpeng90/cuckoo-code/total?style=flat-square&color=green" alt="Downloads"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-8b93ff?style=flat-square" alt="Platform"></a>
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/badge/Electron-33-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron"></a>
</p>

[下载最新版本](https://github.com/wangyongpeng90/cuckoo-code/releases/latest)

**Cuckoo Code** 是一个零 Token 成本的 AI Agent 桌面端。

它通过 Electron 把 [chat.deepseek.com](https://chat.deepseek.com) 嵌入本地窗口，并注入一个侧边覆盖层。AI 被系统提示词引导生成工具调用（JavaScript 代码块），经用户确认后在本地沙箱中执行，再把结果回传给 AI。整个过程不需要 API Key，不产生 API 调用费用——你用的是网页版账号，而不是按 Token 计费的接口。

---

## 核心能力

### 零 Token 成本

不调用 DeepSeek API，不使用 API Token。直接复用网页版聊天能力，把网页版 DeepSeek 变成可执行本地操作的 Agent。无 API 调用费用。

### 真正的 AI Agent

不只是聊天。AI 可以读写文件、搜索代码、执行命令、查询数据库，并依据执行结果继续下一步，形成“思考 -> 行动 -> 观察 -> 再行动”的 Agent 循环。

---

## 主要特性

- 桌面应用：跨平台 Electron 原生窗口，体验接近本地工具
- 命令拦截：自动检测 cmd / powershell / bash 代码块，确认后执行
- 工具调用系统：AI 可调用 readFile、writeFile、editFile、glob、grep、bash、deleteFile 等工具
- 项目目录绑定：初始化项目后，AI 获得目录树和系统提示词，操作基于真实项目上下文
- 覆盖层面板：显示命令预览、执行结果和历史记录，支持 Ctrl+Shift+C 或 Esc 切换
- 安全机制：30 秒命令超时、60 秒沙箱超时、1MB 输出缓冲区
- 会话持久化：登录状态和设置保存到 %APPDATA%/cuckoo-ai-pro-session

---

## 下载

最新版本安装包请从 Releases 获取：

https://github.com/wangyongpeng90/cuckoo-code/releases/latest

---

## 安装与运行

### 环境要求

- Node.js >= 16.0.0
- npm

### 步骤

```bash
# 克隆仓库
git clone https://github.com/wangyongpeng90/cuckoo-code.git
cd cuckoo-code

# 安装依赖
npm install

# 如果 npm 提示 electron postinstall 脚本被阻止（allowScripts），先批准：
#   npm install-scripts ls
#   npm install-scripts approve electron
#   npm install
# 否则 electron 二进制不会下载，启动会报错

# 启动应用
npm start
```

---

## 构建与发布

- 本仓库已配置 GitHub Actions，推送 `v*` 标签（如 `v0.1.0`）会自动构建 Windows、mac、Linux 安装包并发布到 Releases
- 本地手动构建：`npm run build:win` 或 `npm run build:mac` 或 `npm run build:linux`
- 构建产物输出到 `dist/` 目录

---

## 使用指南

1. 启动应用，自动打开 DeepSeek 聊天页面
2. 正常登录你的 DeepSeek 网页版账号
3. 点击「初始化项目」选择项目目录，AI 会获得目录树和系统提示词，从而理解你的项目
4. 与 AI 对话，让它帮你修改文件、运行命令、查询代码等
5. AI 回复中的命令或工具调用会被侧边栏捕获
7. AI 执行工具后，结果会自动回传给 AI，AI 继续下一步，直到任务完成

### 工具调用示例

AI 回复中包含以下格式的代码块时，系统会在沙箱中执行，并把结果回传给 AI：

````markdown
```cuckoo
const content = await readFile("src/utils/helper.js");
await writeFile("src/utils/helper.js", content.replace("formatDate", "formatTime"));
```
````

旧版 JSON 工具调用格式仍然兼容。

---

## 工具系统

支持的工具列表（定义在 tools/ 目录）：

| JS 函数（cuckoo 代码块） | JSON 工具名（旧格式） | 功能描述 |
|----------|----------|----------|
| writeFile(file_path, content, encoding?) | file_write | 写入文件，自动创建父目录 |
| readFile(file_path, encoding?) | file_read | 读取文件内容 |
| editFile(file_path, old_string, new_string, replace_all?) | file_edit | 精确查找并替换文件内容 |
| glob(pattern, path?) | file_glob | 按 glob 模式搜索文件 |
| grep(pattern, options?) | file_grep | 按正则或文本搜索文件内容 |
| bash(command, options?) | bash | 执行 Shell 命令 |

| deleteFile(file_path) | file_delete | 删除文件 |
| webFetch(url, options?) | web_fetch | 访问网页或 API，获取文本/JSON/响应 |
| log(...args) | - | 输出中间结果到执行日志 |

所有工具操作均相对于当前绑定的项目目录，确保安全。

---

## 项目结构

```
cuckoo-code/
├── main.js               # Electron 主进程
├── preload.js            # 预加载脚本，注入覆盖层 UI 和 IPC
├── package.json
├── systemPrompt.md       # 系统提示词模板
├── tools/                # 工具实现
│   ├── ToolRegistry.js
│   ├── FileWriteTool.js
│   ├── FileReadTool.js
│   ├── JsRunner.js
│   └── rules.md          # 工具调用规则说明
└── .cuckooCode/          # 项目配置目录，自动生成
```

---

## 交流群

加入 Cuckoo Code 用户微信群，与其他用户交流使用经验：

![微信群](assets/wechat-group.jpg)

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

- DeepSeek 提供强大的 AI 能力
- Electron 提供跨平台桌面框架
- 所有贡献者和用户

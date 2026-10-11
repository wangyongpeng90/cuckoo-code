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
  <a href="https://github.com/wangyongpeng90/cuckoo-code"><img src="https://img.shields.io/badge/Electron-33-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron"></a>
</p>

English | [中文](README.md)

[Download the latest release](https://github.com/wangyongpeng90/cuckoo-code/releases/latest)

**Cuckoo Code** is a zero-token-cost AI Agent desktop application.

It uses Electron to embed the web versions of AI assistants (DeepSeek, Claude, etc.) into a local window and injects a sidebar overlay. The AI is guided by the system prompt to generate tool calls (JavaScript code blocks). After user confirmation, those calls are executed in a local sandbox and the results are sent back to the AI. The whole flow requires no API key and incurs no API usage fees — you use your web account instead of a pay-per-token API.

---

## Core Features

### Zero Token Cost

No AI platform API is called, and no API token is used. It directly reuses the chat capabilities of the web versions, turning a web-based AI into an agent that can perform local operations.

### Multi-Platform Provider Framework

- Built-in **DeepSeek**, **Claude**, and **ChatGPT** platforms
- Each platform independently encapsulates differences such as input box location, send button detection, reply completion detection, and message parsing
- You can choose a platform when creating a new window, or **import a custom Provider** (type declarations and templates are provided to lower the barrier to extension)

### A True AI Agent

Not just chat. The AI can read/write files, search code, execute commands, query databases, call MCP tools, and continue based on the execution results, forming a "think → act → observe → act again" agent loop.

---

## Main Features

- **Multi-window management**: each window has an independent profile context; tick "Default" to auto-open on startup
- **Address bar**: top bar to view/copy the URL, navigate back/forward/reload, quick-jump; a status bar below shows token usage and **output speed (TPS)**
- **Feishu push**: AI replies can be pushed to Feishu (rendered as interactive cards with Markdown, including tables)
- **Project initialization**: after selecting a project directory, the AI gets the directory tree and system prompt
- **Harness mode (pure chat)**: a Codex-like pure chat UI — hides low-level instructions, showing only user messages / model replies / tool cards; supports streaming, Markdown, KaTeX math, collapsible thinking, Goal/Plan panel (toggle with Ctrl+Shift+H)
- **Workspace sidebar**: lists all conversations grouped by project; rename / archive / new; expand a conversation to see its **subagents** and **compaction history** (session lineage)
- **Project file tree**: VSCode-style tree with type icons / colors, filename search, and one-click `@` path reference
- **File preview (Monaco)**: click a file to preview its content to the right of the tree (VSCode's editor: line numbers + syntax highlighting), without covering the AI; drag the left bar to resize the tree, the right bar to resize the sidebar
- **Plugin market**: auto-discovers plugins via GitHub `topic:cuckoo-plugin`; install / uninstall / toggle in one click (a plugin can bundle skills / agents / rules / MCP / custom providers / **web scripts**); **Gitee source supported**
- **Auto-naming conversations**: the AI names each conversation at the start; the workspace list refreshes live
- **Skill support**: Claude Code-aligned skills (project `.cuckoo/skills/` + user `~/.cuckoo/skills/`), progressive disclosure — teach the AI domain-specific workflows/rules/scripts. **→ [Configuration & usage](docs/skills.md)**
- **Agent support**: Claude Code-aligned subagents (project `.cuckoo/agents/` + user `~/.cuckoo/agents/`); the main conversation can delegate tasks to an isolated-context subagent that returns only a summary — isolating context and enabling specialization. **→ [Configuration & usage](docs/agents.md)**
- **Tool call system**: the AI can read/write files, search code, execute commands, query databases, and more
- **Tool execution mask**: a mask over the AI page during execution, with a "Stop" button to cancel sending results back
- **MCP support**: Claude Desktop compatible config format, stdio / http server types. **→ [Configuration & usage](docs/mcp.md)**
- **Overlay panel**: shows command previews, execution results, and history; toggle with Ctrl+Shift+C or Esc
- **Context compaction**: long sessions auto-compact (clear IDB + refresh + share link) to avoid hitting the context limit
- **Automatic retry**: two mechanisms — (1) retry with backoff when a reply is truncated/fails; (2) watchdog prompts "continue" when the SSE stream goes silent
- **Session persistence**: login state and settings are saved to %APPDATA%/cuckoo-ai-pro-session
- **Safety mechanisms**: 30-second command timeout, 60-second sandbox timeout, 1MB output buffer, dangerous command confirmation (including compound commands); webFetch can optionally **reject internal addresses** (SSRF protection, enabled in Settings)

---

## Installation and Running

### Requirements

- Node.js >= 16.0.0 (matches `engines` in `package.json`; 18+ recommended)
- npm

### Steps

```bash
# Clone the repository
git clone https://github.com/wangyongpeng90/cuckoo-code.git
cd cuckoo-code

# Install dependencies
npm install

# If npm blocks the electron/esbuild postinstall scripts (allowScripts), approve first:
#   npm install-scripts ls             # list blocked packages
#   npm install-scripts approve --all  # or approve electron esbuild individually
#   npm install                        # reinstall to ensure binaries are downloaded
# Otherwise the electron binary will not be downloaded and startup will fail.

# Start the app
npm start
```

---

## Usage Guide

1. Launch the app and choose a platform (DeepSeek / Claude / custom Provider)
2. Log in to the corresponding web platform normally
3. Click "Initialize Project" and select a project directory; the AI will get the directory tree and system prompt
4. Chat with the AI and ask it to modify files, run commands, inspect code, etc.
5. Tool calls in AI replies are automatically detected and executed
6. Execution results are automatically sent back to the AI, which continues until the task is complete

### Tool Call Example

When an AI reply contains a `cuckoo` code block in the following format, the system executes it in the sandbox and sends the result back to the AI:

````markdown
```cuckoo
const content = await read("src/infra/paths.ts");
await write("src/infra/paths.ts", content.replace("resolveAsset", "resolveResource"));
```
````

---

## Tool System

Supported tools (called through `cuckoo` code blocks):

| JS Function | Description |
|----------|----------|
| `read(path, options?)` | Read a text file (line-numbered window) |
| `readLines(path, options?)` | Read a file as a structured line array |
| `write(path, content)` | Create or overwrite a file |
| `edit(path, old, new, replaceAll?, dryRun?)` | Precisely replace file content |
| `glob(pattern, searchPath?)` | Find files by glob pattern |
| `grep(pattern, options?)` | Regex search over file contents |
| `bash(command, options?)` | Execute a shell command (cmd) |
| `pwsh(command, options?)` | Execute a PowerShell command |
| `todoWrite(todos)` | Manage a structured task list |
| `deleteFile(path)` | Delete a file (irreversible) |
| `webFetch(url)` | Fetch HTTP(S) URL content (HTML to Markdown) |
| `mysql(options)` | Execute MySQL SQL |
| `openBrowserWindow(url, options?)` | Open an Electron browser window |
| `injectJS(windowId, code)` | Inject JS into a specified window |
| `attachFile(path)` | Upload a local file as an attachment to the input box |
| `mcpListServers()` | List configured MCP servers |
| `mcpGetTools(serverName)` | List tools of an MCP server |
| `mcpCall(server, tool, args)` | Call an MCP tool |
| `log(...args)` | Output intermediate results to the execution log |

All file operations are relative to the currently bound project directory for safety.

---

## MCP Configuration

MCP configuration uses the **Claude Desktop compatible format** (can be shared/imported directly):

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

Both stdio (command + args) and http (url + headers) types are supported. Enable/disable state is stored separately and does not pollute the main configuration. Open the management panel via the "MCP" button in the overlay. **→ [Configuration & usage](docs/mcp.md)**

---

## Skill Configuration

Skills teach the AI domain-specific **workflows, rules, and scripts**, aligned with Claude Code's Agent Skills mechanism.

A skill is a `SKILL.md` with frontmatter, placed under a conventional directory:

- **Project-level**: `<project>/.cuckoo/skills/<name>/SKILL.md` (travels with the repo, shared by the team)
- **User-level**: `~/.cuckoo/skills/<name>/SKILL.md` (available across all projects)

On project initialization, skills are **scanned automatically**, and each skill's **name + description + path** is injected into the system prompt (**progressive disclosure**, no full text). When a task is relevant, the AI `read`s the full SKILL.md on demand and follows its instructions; if a skill ships scripts, the AI runs them via `bash`/`pwsh`.

```markdown
---
name: my-skill
description: One line describing what this skill does and when to use it.
when_to_use: when the user wants xxx
allowed-tools: read, edit, bash
---

# Skill body
Write the workflow, rules, and examples here.
```

**Full guide (directory conventions, fields, examples) → [Skill configuration & usage](docs/skills.md)**

---

## Agent Configuration

Agents let the main conversation **delegate** tasks to an **isolated-context** sub-conversation that returns only a summary, aligned with Claude Code's subagents mechanism.

An agent is a `.md` file with frontmatter:

- **Project-level**: `<project>/.cuckoo/agents/<name>.md` (travels with the repo, shared by the team)
- **User-level**: `~/.cuckoo/agents/<name>.md` (available across all projects)

On project initialization, agents are **scanned automatically**, and each agent's **name + description** is injected into the system prompt. When a task suits delegation, the main conversation calls `runAgent(name, task)` — the subagent works in an isolated context and **returns only a summary**.

**Twofold value**: (1) context isolation (relieves long-conversation lag); (2) specialization + tool restriction.

```markdown
---
name: code-reviewer
description: Review code quality. Use after writing code.
tools: read, grep, glob
maxTurns: 20
---

You are a senior code reviewer. Review the given code and report real issues.
```

**Full guide (directory conventions, fields, examples, built-in agents) → [Agent configuration & usage](docs/agents.md)**

---

## Custom Provider

Want to integrate a new AI platform? Copy `src/providers/custom/provider.template.js` and fill in according to the template:

- Basic info such as `id` / `name` / `homeUrl`
- Selectors for the input box and send button
- Methods such as `matchesUrl()` and `extractSessionId()`
- Auto-parsing related methods (completion detection, message location, etc.)

See `src/providers/types.ts` for type declarations. Import the JS file from the platform selection page in the app to use it.

---

## Project Structure

```
cuckoo-code/
├── start.js                 # Cross-platform startup script (compiles then starts, logs to wyp/log/)
├── package.json             # "main" points to out/src/app/entry.js (no thin-shell entry)
├── src/
│   ├── app/                 # Application shell (main process)
│   │   ├── entry.ts         # App entry, window creation, app menu
│   │   ├── shell-preload.ts # Address-bar shell page preload
│   │   ├── window.ts        # Multi-window management (WebContentsView architecture)
│   │   ├── profile.ts       # Window profile management
│   │   ├── token-stats.ts   # System-wide token total (cross-window, persisted)
│   │   └── ipc/             # IPC handlers (project/session/command/tool/renderer/shell)
│   ├── session/             # Session and project context
│   │   ├── store.ts         # Session-directory mapping persistence
│   │   ├── project-context.ts # Project initialization
│   │   ├── prompt-builder.ts  # System prompt assembly
│   │   └── compaction.ts      # Context compaction
│   ├── bridge/              # Bridge to the AI web page (preload)
│   │   ├── entry.ts         # Preload entry
│   │   ├── api.ts           # contextBridge API exposure
│   │   ├── intercept/       # Network interception response handling
│   │   ├── parser/          # JS/JSON tool-call parsing
│   │   └── loop/            # Executor, watchdog, retry engine
│   ├── overlay/             # Overlay UI
│   │   ├── panel.ts         # Panel basics (injection, toasts, history)
│   │   ├── events.ts        # Event binding (orchestration)
│   │   ├── panels/          # Panels (window manager / MCP / settings)
│   │   ├── fab.ts           # Floating-ball dragging
│   │   └── template/        # HTML/CSS templates (generated to TS at build time)
│   ├── tools/               # Tool system
│   │   ├── api.d.ts         # AI tool contract (generated)
│   │   ├── core/            # Tool / ToolRegistry / ToolResult
│   │   ├── runtime/         # JsRunner sandbox executor
│   │   └── impl/            # Individual tool implementations
│   ├── providers/           # Platform providers
│   │   ├── types.ts         # Provider interface
│   │   ├── deepseek.ts / claude.ts / chatgpt.ts
│   │   ├── hooks/           # Network interceptor sources (packed to a string at build time)
│   │   └── custom/          # Custom provider loader and template
│   ├── skills/              # Skill mechanism (scanner / frontmatter / prompt)
│   ├── mcp/                 # MCP client and config
│   ├── infra/               # Infrastructure (paths / EOL / logging / dangerous commands)
│   ├── prompt/              # Platform prompt templates
│   └── ui/                  # Shell pages (shell.html / platform-select.html)
├── scripts/                 # Build scripts (hook packing, tool API generation)
├── test/                    # Unit tests
└── out/                     # TypeScript build output
```

---

## Build and Release

- This repository has GitHub Actions configured. Pushing a `v*` tag (e.g. `v0.7.1`) automatically builds Windows and macOS installers and publishes them to Releases
- Local manual builds: `npm run build:win:local` or `npm run build:mac:local`
- Build output goes to the `dist/` directory

---

## Roadmap

See [Roadmap.md](Roadmap.md) for the next phase plan.

---

## Contributing

Issues and Pull Requests are welcome.

- Report bugs or suggest new features: Issues
- Submit code: Pull Requests

---

## License

This project is licensed under the GNU General Public License v3.0. See the LICENSE file for details.

---

## Acknowledgements

- DeepSeek and Claude for providing powerful AI capabilities
- Electron for the cross-platform desktop framework
- [@27584](https://github.com/27584):
  - Framework-level improvements: Provider send extension interface, dual-channel streaming stability, custom Provider renderer loading, MCP tool recognition (PR #9)
  - **Harness mode (pure chat)**: a Codex-like pure chat UI — hides low-level instructions, showing only user messages / model replies / tool cards; with streaming, collapsible thinking, Goal/Plan panel, slash menu (PR #22)
  - **Harness enhancements + Plugin market**: multi-session isolation, sidebar "Conversations" tab, Markdown/LaTeX (KaTeX) rendering, Goal/Plan auto-drive, plugin market (GitHub topic auto-discovery & install) (PR #23)
- [@jiangchengnay](https://github.com/jiangchengnay):
  - **Plugin web-script injection**: new `scripts/` contribution type for plugins — inject scripts into the web page's main world by URL match, works on built-in platforms (PR #26)
  - **Gitee plugin market support**: the plugin market gains a Gitee source (search / download / manifest), parallel to GitHub, for users with unstable GitHub access (PR #28)
  - **Subagent send fix**: fixes subagents getting stuck at "sending task prompt" on contenteditable platforms like Doubao (PR #29)
- [@8555uuy](https://github.com/8555uuy):
  - **Dangerous-command detection hardening**: fixes detection bypass via compound commands (`&&` `||` `;` `|` `&`); unifies into a single source of truth and adds more dangerous variants (PR #30)
  - **glob excludes artifact dirs**: excludes dependency/artifact dirs like `node_modules` by default when no path is given, avoiding drowning out the project's own files (PR #31)
  - **webFetch SSRF protection**: rejects internal/loopback/reserved addresses (opt-in via Settings, off by default) (PR #32)
  - **Status-bar output speed (TPS)**: shows model output speed — exact server-side token count on DeepSeek, estimated on ChatGPT/Claude (PR #33)
  - **Provider-customizable tool-result format**: new optional `transformToolResult` hook lets plugins customize the text format before tool results are sent back (PR #34)
- [@ZiJiangel](https://github.com/ZiJiangel):
  - **Feishu Markdown card**: AI replies pushed to Feishu now render Markdown (including tables) via interactive cards (PR #35)
- [@yangjh888](https://github.com/yangjh888):
  - **Full ChatGPT logged-in support**: reply interception rewritten as three-state (finished/stopped/error), fixed bare `{v:[...]}` SSE delta-frame parsing, `fillInput` (execCommand) + `triggerSend` (real Enter) for ProseMirror input/send, Google OAuth fingerprint fixes (Sec-CH-UA* / userAgentData / webdriver) (PR #47)
- All contributors and users

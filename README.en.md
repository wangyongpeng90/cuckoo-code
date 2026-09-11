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

- Built-in **DeepSeek** and **Claude** platforms
- Each platform independently encapsulates differences such as input box location, send button detection, reply completion detection, and message parsing
- You can choose a platform when creating a new window, or **import a custom Provider** (type declarations and templates are provided to lower the barrier to extension)

### A True AI Agent

Not just chat. The AI can read/write files, search code, execute commands, query databases, call MCP tools, and continue based on the execution results, forming a "think → act → observe → act again" agent loop.

---

## Main Features

- **Multi-window management**: each window has an independent profile context without interference
- **Project initialization**: after selecting a project directory, the AI gets the directory tree and system prompt, so operations are based on real project context
- **Tool call system**: the AI can call tools for reading/writing files, searching code, executing commands, querying databases, and more
- **Command interception**: automatically detects cmd / powershell / bash code blocks and executes them after confirmation
- **MCP support**: uses Claude Desktop compatible configuration format and supports stdio / http server types
- **Overlay panel**: shows command previews, execution results, and history; toggle with Ctrl+Shift+C or Esc
- **Automatic retry**: when JS execution fails and the code appears incomplete, it automatically waits 1 second, refetches, and retries (up to 3 times); only reports back to the AI if it still fails
- **Session persistence**: login state and settings are saved to %APPDATA%/cuckoo-ai-pro-session
- **Safety mechanisms**: 30-second command timeout, 60-second sandbox timeout, 1MB output buffer, dangerous command confirmation

---

## Installation and Running

### Requirements

- Node.js >= 16.0.0
- npm

### Steps

```bash
# Clone the repository
git clone https://github.com/wangyongpeng90/cuckoo-code.git
cd cuckoo-code

# Install dependencies
npm install

# If npm blocks the electron postinstall script (allowScripts), approve it first:
#   npm install-scripts ls
#   npm install-scripts approve electron
#   npm install
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
const content = await read("src/utils/helper.js");
await write("src/utils/helper.js", content.replace("formatDate", "formatTime"));
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
| `mcpListServers()` | List configured MCP servers |
| `mcpGetTools(serverName)` | List tools of an MCP server |
| `mcpCall(server, tool, args)` | Call an MCP tool |
| `skillList()` | List Skills available in the current project |
| `skillLoad(name)` | Load a Skill (returns SKILL.md instructions) |
| `skillExecute(skill, fn, args)` | Execute a Skill's tool.js function |
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

Both stdio (command + args) and http (url + headers) types are supported. Enable/disable state is stored separately and does not pollute the main configuration. Open the management panel via the "MCP" button in the overlay.

---

## Custom Provider

Want to integrate a new AI platform? Copy `src/providers/custom/provider.template.js` and fill in according to the template:

- Basic info such as `id` / `name` / `homeUrl`
- Selectors for the input box and send button
- Methods such as `matchesUrl()` and `extractSessionId()`
- Auto-parsing related methods (completion detection, message location, etc.)

See `src/providers/custom/provider.d.ts` for type declarations. Import the JS file from the platform selection page in the app to use it.

---

## Project Structure

```
cuckoo-code/
├── main.js                 # Electron main process entry (thin shell, forwards to src/main/)
├── start.js                # Cross-platform startup script (logs to wyp/log/)
├── preload.js              # Preload entry
├── src/
│   ├── main/               # Main process logic
│   │   ├── index.js        # App entry, window creation, IPC registration
│   │   ├── window.js       # Multi-window management (per-window profile context)
│   │   ├── ipc.js          # IPC handlers
│   │   ├── profile-manager.js  # Window profile management
│   │   ├── project-context.js  # Project initialization, directory tree, systemPrompt assembly
│   │   ├── session-store.js    # Session persistence
│   │   ├── mcp-config.js       # MCP configuration management
│   │   ├── mcp-client.js       # MCP SDK client
│   │   ├── tool-registry.js    # Tool registration (main process side)
│   │   ├── dangerous-commands.js  # Dangerous command detection
│   │   └── updater.js          # Auto update
│   ├── preload/            # Renderer process logic
│   │   ├── index.js        # Preload entry
│   │   ├── api.js          # contextBridge API exposure
│   │   ├── overlay/        # Overlay UI (templates, events, styles)
│   │   └── dom/            # DOM monitoring, parsing, execution
│   └── providers/          # Platform providers
│       ├── deepseek.js     # DeepSeek platform definition
│       ├── claude.js       # Claude platform definition
│       └── custom/         # Custom Provider loader and template
├── tools/                  # Tool implementations
│   ├── ToolRegistry.js     # Tool registry
│   ├── JsRunner.js         # JS sandbox executor
│   └── *.js                # Individual tool implementations
├── test/                   # Unit tests
└── dist/                   # Build output
```

---

## Build and Release

- This repository has GitHub Actions configured. Pushing a `v*` tag (e.g. `v0.3.0`) automatically builds Windows and macOS installers and publishes them to Releases
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
- [@27584](https://github.com/27584): framework-level improvements including the Provider send extension interface, dual-channel streaming stability, custom Provider renderer loading, and MCP tool recognition (PR #9)
- All contributors and users

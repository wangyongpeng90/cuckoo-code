/**
 * 系统提示词章节构建（从 prompt-builder.ts 拆出，纯函数/低副作用，便于单测）
 *
 * 分层：模板加载(loader) → 各章节构建(sections) → 占位符替换(render)
 * 与 deepseek-recipe 的「分层渲染」思路一致：章节独立、可测、可组合。
 */
import fs from 'node:fs';
import path from 'node:path';
import * as mcpClient from '../../mcp/client.js';

/** 生成平台信息章节（OS/arch/命令差异） */
export function buildPlatformInfo(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') {
    return '- 操作系统：Windows（' + arch + '）\n  - bash 使用 cmd.exe（Windows 命令：cd / dir / echo %cd% / type / findstr）\n  - pwsh 使用 PowerShell（Get-Location / $env:VAR / Get-ChildItem）\n  - 路径分隔符为反斜杠 \\，传给工具的相对路径统一用正斜杠 /';
  }
  if (platform === 'darwin') {
    return '- 操作系统：macOS（' + arch + '）\n  - bash 使用 zsh/bash（Unix 命令：pwd / ls / cat / grep）\n  - 路径分隔符为正斜杠 /';
  }
  return '- 操作系统：Linux（' + arch + '，常见为 Ubuntu 24.04）\n  - bash 使用 bash（Unix 命令：pwd / ls / cat / grep / apt）\n  - pwsh 在 Linux 上内部以 bash -lc 执行，按 bash 语法书写命令\n  - 路径分隔符为正斜杠 /；家目录用 $HOME 或 ~';
}

/** 生成 MCP 能力章节 */
export function buildMcpSection(selectedDir: string | null): string {
  const enabledMcpServers = mcpClient.listConfiguredServers(selectedDir).filter(s => s.enabled);
  const mcpServerList = enabledMcpServers.length
    ? enabledMcpServers.map(s => '- ' + s.name + '（' + s.type + '，' + (s.connected ? '已连接' : '未连接') + '，工具数 ' + s.toolCount + '）').join('\n')
    : '（当前没有已配置且启用的 MCP server）';
  const mcpCwd = mcpClient.getDefaultMcpCwd();
  const mcpCwdLine = mcpCwd
    ? 'MCP 子进程的工作目录（cwd）：' + mcpCwd + '\n注意：MCP 工具（如截图、下载）返回的路径多为相对路径，实际文件位于该 cwd 下。若需读取/上传这些文件（如 attachFile），请把该 cwd 与相对路径用 / 拼接成绝对路径传入，例如：' + mcpCwd + '/page-xxx.png'
    : 'MCP 子进程的工作目录（cwd）：未确定（继承父进程）。MCP 工具返回的相对路径请以实际返回为准。';

  return [
    '## MCP 能力',
    '',
    '本应用支持 MCP（Model Context Protocol）外部工具扩展。',
    '',
    mcpCwdLine,
    '',
    '当前已配置且启用的 MCP server：',
    mcpServerList,
    '',
    '**使用 MCP 的强制流程（务必遵守）**：',
    '1. 先调 mcpListServers() 看有哪些 server、是否已连接',
    '2. **调用任何工具前，必须先调 mcpGetTools(server) 查看该 server 的工具列表与参数**（每个工具的名称、描述、参数名/类型都在这里）。不同 server/版本参数名可能不同，凭记忆猜参数极易失败。',
    '3. 按 mcpGetTools 返回的准确参数，通过 mcpCall(server, tool, args) 调用',
    '4. 工具返回的错误要仔细读（通常已说明失败原因，如参数缺失、引用过期），据此调整后重试',
    '',
    '注意：MCP server 可能未连接或未启用，以 mcpListServers() 的实时返回为准。',
    '',
    '如果你需要使用某个 MCP（例如浏览器自动化、数据库访问等），可以提示用户安装并配置对应的 MCP server。'
  ].join('\n');
}

/**
 * 读取项目介绍（CUCKOO.md），无则返回空串。
 * 优先新路径 `.cuckoo/CUCKOO.md`，兼容旧路径 `.cuckooCode/CUCKOO.md`。
 */
export function readProjectIntro(selectedDir: string): string {
  const candidates = [
    path.join(selectedDir, '.cuckoo', 'CUCKOO.md'),
    path.join(selectedDir, '.cuckooCode', 'CUCKOO.md'),
  ];
  const cuckooMdPath = candidates.find((p) => fs.existsSync(p));
  if (!cuckooMdPath) return '';
  try {
    const content = fs.readFileSync(cuckooMdPath, 'utf-8');
    console.log('[Cuckoo Code] 已读取 CUCKOO.md 内容:', cuckooMdPath);
    return content;
  } catch (err: any) {
    console.error('[Cuckoo Code] 读取 CUCKOO.md 失败:', err.message);
    return '';
  }
}

/**
 * 用占位符映射替换模板内容。所有 key 均出现替换（单遍 split/join，值中的 '$' 不会被特殊处理）。
 */
export function applyPlaceholders(template: string, placeholders: Record<string, string>): string {
  let combined = template;
  for (const [key, value] of Object.entries(placeholders)) {
    combined = combined.split(key).join(value);
  }
  return combined;
}

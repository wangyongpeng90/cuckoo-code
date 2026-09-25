/**
 * 系统提示词组装：读取模板、填充占位符、拼装 MCP/平台/项目章节
 * 由 project-context.ts 拆分而来（P4.5）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '../providers/registry.js';
import * as mcpClient from '../mcp/client.js';
import { resolveSrc, resolveToolSpec } from '../infra/paths.js';
import { registry as toolRegistry } from '../tools/index.js';
import { scanSkills, buildSkillsSection } from '../skills/index.js';

// 提示词模板目录（D20：锚定应用根，与 dist 结构解耦）
const PROMPT_DIR = resolveSrc('prompt');

/**
 * 读取平台提示词模板。
 * 优先级：1) provider.getPromptTemplate()  2) src/prompt/{id}.md  3) src/prompt/default.md
 * @returns { content, path }，失败时 content 为空串并带 message
 */
function loadTemplate(providerId: string): { content: string; path: string; error?: string } {
  const provider = getProvider(providerId);
  let templateContent = '';
  let templatePath = '';

  if (provider && typeof provider.getPromptTemplate === 'function') {
    try {
      const fromMethod = provider.getPromptTemplate();
      if (fromMethod && typeof fromMethod === 'string' && fromMethod.trim()) {
        templateContent = fromMethod;
        templatePath = '(provider.getPromptTemplate)';
      }
    } catch (err: any) {
      console.warn('[Cuckoo Code] 调用 provider.getPromptTemplate 失败:', err.message);
    }
  }

  if (!templateContent && providerId) {
    const candidate = path.join(PROMPT_DIR, providerId + '.md');
    if (fs.existsSync(candidate)) templatePath = candidate;
  }

  if (!templateContent && templatePath) {
    try {
      templateContent = fs.readFileSync(templatePath, 'utf-8');
    } catch (err: any) {
      return { content: '', path: templatePath, error: '读取提示词模板失败: ' + err.message };
    }
  }

  if (!templateContent) {
    templatePath = path.join(PROMPT_DIR, 'default.md');
    try {
      templateContent = fs.readFileSync(templatePath, 'utf-8');
      console.warn('[Cuckoo Code] 未找到平台模板，使用默认模板:', templatePath);
    } catch (err: any) {
      return { content: '', path: templatePath, error: '读取默认提示词模板失败: ' + err.message };
    }
  }

  return { content: templateContent, path: templatePath };
}

/** 生成平台信息章节（OS/arch/命令差异） */
function buildPlatformInfo(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') {
    return '- 操作系统：Windows（' + arch + '）\n  - bash 使用 cmd.exe（Windows 命令：cd / dir / echo %cd% / type / findstr）\n  - pwsh 使用 PowerShell（Get-Location / $env:VAR / Get-ChildItem）\n  - 路径分隔符为反斜杠 \\，传给工具的相对路径统一用正斜杠 /';
  }
  if (platform === 'darwin') {
    return '- 操作系统：macOS（' + arch + '）\n  - bash 使用 zsh/bash（Unix 命令：pwd / ls / cat / grep）\n  - 路径分隔符为正斜杠 /';
  }
  return '- 操作系统：Linux（' + arch + '）\n  - bash 使用 bash（Unix 命令：pwd / ls / cat / grep）\n  - 路径分隔符为正斜杠 /';
}

/** 生成 MCP 能力章节 */
function buildMcpSection(): string {
  const enabledMcpServers = mcpClient.listConfiguredServers().filter(s => s.enabled);
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
    '使用 MCP 前，请先查询可用能力：',
    '1. 调用 mcpListServers() 查看当前已配置的 MCP server 列表（含启用/连接状态）',
    '2. 调用 mcpGetTools(serverName) 查看指定 server 提供的工具和参数',
    '3. 确认后通过 mcpCall(server, tool, args) 调用具体工具',
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
function readProjectIntro(selectedDir: string): string {
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
 * 组装完整的系统提示词。
 * @param opts { providerId, selectedDir, isCompaction }
 * @returns { prompt, error? }，error 存在时 prompt 为空
 */
function buildPrompt(opts: { providerId: string; selectedDir: string; isCompaction?: boolean }): { prompt: string; error?: string } {
  const { providerId, selectedDir, isCompaction } = opts;

  const tpl = loadTemplate(providerId);
  if (tpl.error) return { prompt: '', error: tpl.error };
  console.log('[Cuckoo Code] 已读取提示词模板:', tpl.path);

  // 工具 API 类型定义（从 d.ts 文件读取，避免与模板重复维护）
  let toolApiTypes = '';
  try {
    toolApiTypes = fs.readFileSync(resolveToolSpec(), 'utf-8');
  } catch (err) { /* 找不到时保持空串 */ }
  if (!toolApiTypes) {
    console.error('[Cuckoo Code] 读取 cuckoo-tools.d.ts 失败:', resolveToolSpec());
  }

  const toolsDescription = toolRegistry.getFormattedJsApiForPrompt();
  const promptSections = toolRegistry.getFormattedPromptSections();

  // 后台异步连接已启用的 MCP server，不阻塞初始化
  mcpClient.connectEnabledServers().catch((err: any) => {
    console.error('[MCP] 初始化时连接失败:', err.message);
  });

  const mcpSection = buildMcpSection();
  const platformInfo = buildPlatformInfo();
  const projectIntro = readProjectIntro(selectedDir);
  const projectIntroSection = projectIntro ? '---\n## 项目介绍\n' + projectIntro : '';
  const skillsSection = buildSkillsSection(scanSkills(selectedDir));

  const placeholders: Record<string, string> = {
    '{{TOOL_API_TYPES}}': toolApiTypes,
    '{{TOOLS_LIST}}': toolsDescription,
    '{{TOOL_SECTIONS}}': promptSections,
    '{{PLATFORM_INFO}}': platformInfo,
    '{{PROJECT_DIR}}': selectedDir,
    '{{PROJECT_INTRO_SECTION}}': projectIntroSection,
    '{{MCP_SECTION}}': mcpSection,
    '{{SKILLS_SECTION}}': skillsSection,
  };
  let combined = tpl.content;
  for (const [key, value] of Object.entries(placeholders)) {
    combined = combined.split(key).join(value);
  }


  // 压缩后初始化：末尾追加提示，让 AI 接着之前的工作继续
  if (isCompaction) {
    combined += '\n\n---\n\n请继续你之前的工作';
  }

  return { prompt: combined };
}

export { PROMPT_DIR, loadTemplate, buildPrompt };

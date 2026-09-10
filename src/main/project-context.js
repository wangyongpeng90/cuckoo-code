/**
 * 项目初始化：目录选择、目录树、系统提示词组合与发送
 * 由原 main.js 拆分而来，逻辑保持不变。
 */
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const windowState = require('./window');
const { toolRegistry } = require('./tool-registry');
const mcpClient = require('./mcp-client');

// 提示词模板目录
const PROMPT_DIR = path.join(__dirname, '..', 'prompt');

/**
 * 递归获取目录树结构字符串
 * @param {string} dir 目录路径
 * @param {number} depth 当前深度
 * @returns {string} 目录树字符串
 */
// 需要忽略的目录（依赖、构建产物、版本控制等）
const IGNORED_DIRS = new Set([
  'node_modules', 'target', 'build', 'dist', 'out',
  '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.coverage',
  'vendor', 'bower_components', 'jspm_packages',
  '.idea', '.vscode', '.vs',
  'logs', 'tmp', 'temp',
  'bin', 'obj',
]);

/**
 * 递归获取目录树结构字符串（类似 Windows tree 命令风格）
 * @param {string} dir 目录路径
 * @param {string} prefix 当前行前缀（用于绘制树形结构）
 * @returns {string} 目录树字符串
 */
function getDirectoryTree(dir, prefix = '') {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // 过滤：跳过隐藏文件和忽略的目录
    const visibleEntries = entries
      .filter(e => !e.name.startsWith('.'))
      .filter(e => !e.isDirectory() || !IGNORED_DIRS.has(e.name))
      .sort((a, b) => {
        // 目录优先，然后按名称排序
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    let tree = '';

    visibleEntries.forEach((entry, index) => {
      const isLast = index === visibleEntries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      tree += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

      if (entry.isDirectory()) {
        tree += getDirectoryTree(path.join(dir, entry.name), childPrefix);
      }
    });

    return tree;
  } catch (err) {
    console.error('[Cuckoo Code] 读取目录失败:', err.message);
    return `${prefix}└── [无法读取目录: ${dir}]\n`;
  }
}

/**
 * 组装完整系统提示词（模板 + 占位符替换）。
 * 主窗口与子 Agent 共用，避免两套不一致。
 * @param {string} providerId 平台 id（deepseek/claude），空则用 default 模板
 * @param {string} projectDir 项目根目录（用于 PROJECT_DIR 占位符）
 * @returns {string} 组装后的完整提示词
 */
function buildPrompt(providerId, projectDir, mcpSection = '', excludeTools = null) {
  const fsMod = require('fs');
  const pathMod = require('path');

  let templateContent = '';
  let templatePath = '';

  // 1. provider.getPromptTemplate() → 2. src/prompt/{providerId}.md → 3. default.md
  const provider = require('../providers').getProvider(providerId);
  if (provider && typeof provider.getPromptTemplate === 'function') {
    try {
      const fromMethod = provider.getPromptTemplate();
      if (fromMethod && typeof fromMethod === 'string' && fromMethod.trim()) {
        templateContent = fromMethod;
        templatePath = '(provider.getPromptTemplate)';
      }
    } catch (err) {
      console.warn('[Cuckoo Code] provider.getPromptTemplate 失败:', err.message);
    }
  }

  if (!templateContent && providerId) {
    const candidate = pathMod.join(PROMPT_DIR, providerId + '.md');
    if (fsMod.existsSync(candidate)) {
      templatePath = candidate;
      templateContent = fsMod.readFileSync(candidate, 'utf-8');
    }
  }

  if (!templateContent) {
    templatePath = pathMod.join(PROMPT_DIR, 'default.md');
    templateContent = fsMod.readFileSync(templatePath, 'utf-8');
  }

  // 2. 工具 API 类型定义
  let toolApiTypes = '';
  try {
    toolApiTypes = fsMod.readFileSync(pathMod.join(__dirname, '..', '..', 'tools', 'cuckoo-tools.d.ts'), 'utf-8');
  } catch (err) {
    console.error('[Cuckoo Code] 读取 cuckoo-tools.d.ts 失败:', err.message);
  }

  // 子 Agent 通过 excludeTools 过滤类型声明（如 subagent 段）：块级过滤
  if (excludeTools && excludeTools.length > 0) {
    const excluded = new Set(excludeTools);
    const lines = toolApiTypes.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\/\/ =+ /.test(line)) {
        // 段注释开始：收集整块（到下一个段注释）
        const blockLines = [line];
        i++;
        while (i < lines.length && !/^\/\/ =+ /.test(lines[i])) {
          blockLines.push(lines[i]);
          i++;
        }
        const blockText = blockLines.join('\n');
        const hasExcluded = [...excluded].some((t) => blockText.includes('declare function ' + t + '('));
        if (!hasExcluded) result.push(...blockLines);
      } else {
        result.push(line);
        i++;
      }
    }
    toolApiTypes = result.join('\n');
  }

  // 3. 工具清单 + 使用指导（子 Agent 可通过 excludeTools 过滤 subagent）
  const toolsDescription = toolRegistry.getFormattedJsApiForPrompt(excludeTools);
  const promptSections = toolRegistry.getFormattedPromptSections(excludeTools);

  // 4. 平台信息
  const platform = process.platform;
  const arch = process.arch;
  let platformInfo = '';
  if (platform === 'win32') {
    platformInfo = '- 操作系统：Windows（' + arch + '）\n  - bash 使用 cmd.exe（Windows 命令：cd / dir / echo %cd% / type / findstr）\n  - pwsh 使用 PowerShell（Get-Location / $env:VAR / Get-ChildItem）\n  - 路径分隔符为反斜杠 \\，传给工具的相对路径统一用正斜杠 /';
  } else if (platform === 'darwin') {
    platformInfo = '- 操作系统：macOS（' + arch + '）\n  - bash 使用 zsh/bash（Unix 命令：pwd / ls / cat / grep）\n  - 路径分隔符为正斜杠 /';
  } else {
    platformInfo = '- 操作系统：Linux（' + arch + '）\n  - bash 使用 bash（Unix 命令：pwd / ls / cat / grep）\n  - 路径分隔符为正斜杠 /';
  }

  // 5. 项目介绍 CUCKOO.md
  let projectIntro = '';
  if (projectDir) {
    const cuckooMdPath = pathMod.join(projectDir, '.cuckooCode', 'CUCKOO.md');
    if (fsMod.existsSync(cuckooMdPath)) {
      try { projectIntro = fsMod.readFileSync(cuckooMdPath, 'utf-8'); } catch (_) {}
    }
  }
  const projectIntroSection = projectIntro ? '---\n## 项目介绍\n' + projectIntro : '';

  // 6. 占位符替换
  const placeholders = {
    '{{TOOL_API_TYPES}}': toolApiTypes,
    '{{TOOLS_LIST}}': toolsDescription,
    '{{TOOL_SECTIONS}}': promptSections,
    '{{PLATFORM_INFO}}': platformInfo,
    '{{PROJECT_DIR}}': projectDir || '',
    '{{PROJECT_INTRO_SECTION}}': projectIntroSection,
    '{{MCP_SECTION}}': mcpSection,
  };
  let combined = templateContent;
  for (const [key, value] of Object.entries(placeholders)) {
    combined = combined.split(key).join(value);
  }

  // 模板无 {{MCP_SECTION}} 占位符时，追加到末尾（主窗口注入 MCP 能力说明）
  if (mcpSection && !combined.includes(mcpSection)) {
    combined += '\n\n---\n\n' + mcpSection;
  }
  return combined;
}

/**
 * 初始化项目：选择目录并发送目录树 + systemPrompt
 * 供 IPC 调用（用户点击初始化按钮时触发）
 * @param {boolean} skipPrompt - 如果为true，只更新目录映射，不发送初始提示（用于修改目录）
 */
async function initProject(skipPrompt = false, windowContext = null) {
  const ctx = windowContext || windowState.getMainContext();
  const mainWindow = ctx ? ctx.win : windowState.getMainWindow();
  const sessionStore = ctx ? ctx.sessionStore : null;
  // providerId 来自窗口上下文（可能为空，表示未确定平台）
  const providerId = (ctx && ctx.providerId) || '';

  // 先让用户选择目录
  const result = dialog.showOpenDialogSync(mainWindow, {
    properties: ['openDirectory'],
    buttonLabel: '选择目录',
    title: '请选择要分析的项目目录',
  });

  // 无论用户是否选择目录，对话框关闭后都恢复主窗口焦点（避免输入框失效）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }

  if (!result || result.length === 0) {
    console.log('[Cuckoo Code] 用户取消了目录选择');
    return { success: false, message: '用户取消了目录选择' };
  }

  const selectedDir = result[0];
  console.log('[Cuckoo Code] 用户选择目录:', selectedDir);

  // 保存选中的项目目录（若该窗口有独立的 sessionStore）
  if (sessionStore) {
    sessionStore.state.selectedProjectDir = selectedDir;

    // ========== 持久化存储会话-目录映射 ==========
    // 如果当前有会话ID，保存映射
    if (sessionStore.state.currentSessionId) {
      sessionStore.saveSessionDirMapping(sessionStore.state.currentSessionId, selectedDir);
      console.log(`[Cuckoo Code] 已保存会话 ${sessionStore.state.currentSessionId} -> ${selectedDir}`);
    } else {
      // 如果未能获取会话ID，尝试从当前URL提取
      let sessionId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        const url = mainWindow.webContents.getURL();
        sessionId = sessionStore.extractSessionIdFromUrl(url);
      }
      if (sessionId) {
        sessionStore.state.currentSessionId = sessionId;
        sessionStore.saveSessionDirMapping(sessionId, selectedDir);
        console.log(`[Cuckoo Code] 从URL提取会话ID并保存: ${sessionId} -> ${selectedDir}`);
      } else {
        // 无法获取会话ID，暂存项目目录，等待URL变化后绑定
        sessionStore.state.pendingProjectDir = selectedDir;
        console.log(`[Cuckoo Code] 暂存项目目录 ${selectedDir}，等待会话ID出现后绑定`);
      }
    }
  }

  // 发送目录更新事件到渲染进程
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('project-dir-updated', selectedDir);
  }

  // 如果只是修改目录，跳过发送初始提示
  if (skipPrompt) {
    return { success: true, message: '项目目录已更新' };
  }

  // MCP 章节（主窗口全量注入；子 Agent 走 buildPrompt 默认空，不注入）
  const mcpSection = [
    '## MCP 能力',
    '',
    '本应用支持 MCP（Model Context Protocol）外部工具扩展。',
    '',
    '使用 MCP 前，请先查询可用能力：',
    '1. 调用 mcpListServers() 查看当前已配置的 MCP server 列表（含启用/连接状态）',
    '2. 调用 mcpGetTools(serverName) 查看指定 server 提供的工具和参数',
    '3. 确认后通过 mcpCall(server, tool, args) 调用具体工具',
    '',
    '注意：MCP server 可能未连接或未启用，以 mcpListServers() 的实时返回为准。'
  ].join('\n');

  // 复用统一提示词组装（buildPrompt 同时处理模板选择 + 占位符替换）
  const combined = buildPrompt(providerId, selectedDir, mcpSection);

  // MCP 连接仍保持非阻塞（放在组装后连接，不影响主窗口初始化）
  try {
    await Promise.race([
      mcpClient.connectEnabledServers(),
      new Promise(resolve => setTimeout(resolve, 8000))
    ]);
  } catch (err) {
    console.error('[MCP] 初始化时连接失败:', err.message);
  }

  console.log('[Cuckoo Code] 准备发送初始提示（不含目录树），长度:', combined.length);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('initial-prompt', combined);
  }

  return { success: true, message: '初始化完成，已发送系统提示词、工具规则和工具库' };
}

module.exports = { PROMPT_DIR, IGNORED_DIRS, getDirectoryTree, initProject, buildPrompt };

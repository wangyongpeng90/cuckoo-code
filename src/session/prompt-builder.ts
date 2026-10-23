/**
 * 系统提示词组装：读取模板、填充占位符、拼装 MCP/平台/项目章节
 * 由 project-context.ts 拆分而来（P4.5）。
 *
 * 分层（P2 重构）：章节构建/占位符替换抽到 prompt/sections.ts；
 * 本文件只负责编排与数据采集，并 re-export 兼容既有调用方与测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '../providers/registry.js';
import * as mcpClient from '../mcp/client.js';
import { resolveSrc, resolveToolSpec, resolveToolSpecFeature } from '../infra/paths.js';
import { getEnabledToolFeatures } from '../infra/config.js';
import { registry as toolRegistry } from '../tools/index.js';
import { scanSkills, buildSkillsSection } from '../skills/index.js';
import { scanAgents, buildAgentsSection } from '../agents/index.js';
import { scanRules, getUnscopedRules, buildUnscopedRulesSection } from '../rules/index.js';
// 直接引 roots 子模块（不走 plugins 的 barrel），避免把整个插件模块图拉进来
import { getPluginScanRoots } from '../plugins/roots.js';
import type { PluginScanRoots } from '../plugins/roots.js';
// DSH 插件注册的提示词段（C4）
import { getPromptSections as getDshPromptSections } from '../plugins/dsh-compat/prompt-sections.js';
import { buildMemorySection } from '../infra/memories.js';
import {
  buildPlatformInfo,
  buildMcpSection,
  readProjectIntro,
  applyPlaceholders,
} from './prompt/sections.js';

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
    // 追加已启用功能分组的类型定义（如记忆功能开启时注入 api.memories.d.ts）
    for (const feat of getEnabledToolFeatures()) {
      try {
        const spec = fs.readFileSync(resolveToolSpecFeature(feat), 'utf-8');
        if (spec) toolApiTypes += '\n\n' + spec;
      } catch (_) { /* 该 feature 文件不存在则跳过 */ }
    }
  } catch (err) { /* 找不到时保持空串 */ }
  if (!toolApiTypes) {
    console.error('[Cuckoo Code] 读取 cuckoo-tools.d.ts 失败:', resolveToolSpec());
  }

  const toolsDescription = toolRegistry.getFormattedJsApiForPrompt();
  // C4：DSH 插件注册的提示词段（与工具 section 合并）
  let dshSections = '';
  try {
    const secs = getDshPromptSections();
    if (secs.length > 0) dshSections = secs.map((s) => s.text).join('\n\n');
  } catch (_) { /* ignore */ }
  const toolSections = toolRegistry.getFormattedPromptSections();
  const promptSections = dshSections ? (toolSections + '\n\n' + dshSections) : toolSections;

  // 后台异步连接已启用的 MCP server，不阻塞初始化（按当前项目）
  mcpClient.connectEnabledServers(selectedDir).catch((err: any) => {
    console.error('[MCP] 初始化时连接失败:', err.message);
  });

  const mcpSection = buildMcpSection(selectedDir);
  const platformInfo = buildPlatformInfo();
  const projectIntro = readProjectIntro(selectedDir);
  const projectIntroSection = projectIntro ? '---\n## 项目介绍\n' + projectIntro : '';
  // 已安装插件贡献的扫描根。
  // 由本层居中传递：scanner 不 import plugins，plugins 不 import scanner，两边无依赖环。
  let pluginRoots: PluginScanRoots = { skillDirs: [], agentDirs: [], ruleDirs: [], mcpFiles: [] };
  try {
    pluginRoots = getPluginScanRoots();
  } catch (err: any) {
    console.warn('[Cuckoo Code] 读取插件扫描根失败:', err && err.message ? err.message : String(err));
  }

  const skillsSection = buildSkillsSection(scanSkills(selectedDir, pluginRoots.skillDirs));
  const agentsSection = buildAgentsSection(scanAgents(selectedDir, pluginRoots.agentDirs));
  // 无 paths 的规则：始终注入（「## 项目规则」章节）
  const rulesSection = buildUnscopedRulesSection(getUnscopedRules(scanRules(selectedDir, pluginRoots.ruleDirs)));
  // 用户记忆（跨项目）：让模型了解用户习惯
  let memorySection = '';
  try { memorySection = buildMemorySection(); } catch (err: any) {
    console.warn('[Cuckoo Code] 读取用户记忆失败:', err && err.message ? err.message : String(err));
  }

  const placeholders: Record<string, string> = {
    '{{TOOL_API_TYPES}}': toolApiTypes,
    '{{TOOLS_LIST}}': toolsDescription,
    '{{TOOL_SECTIONS}}': promptSections,
    '{{PLATFORM_INFO}}': platformInfo,
    '{{PROJECT_DIR}}': selectedDir,
    '{{PROJECT_INTRO_SECTION}}': projectIntroSection,
    '{{MCP_SECTION}}': mcpSection,
    '{{SKILLS_SECTION}}': skillsSection,
    '{{AGENTS_SECTION}}': agentsSection,
    '{{PROJECT_RULES_SECTION}}': rulesSection,
    '{{MEMORY_SECTION}}': memorySection,
  };
  let combined = applyPlaceholders(tpl.content, placeholders);

  // 压缩后初始化：末尾追加提示，让 AI 接着之前的工作继续
  if (isCompaction) {
    combined += '\n\n---\n\n请继续你之前的工作';
  }

  return { prompt: combined };
}

export {
  PROMPT_DIR,
  loadTemplate,
  buildPrompt,
  // 章节构建（re-export，便于单测与其它模块按需引用）
  buildPlatformInfo,
  buildMcpSection,
  readProjectIntro,
  applyPlaceholders,
};

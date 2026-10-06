/**
 * 工具注册表 - 管理所有可用工具
 */
import { Tool } from './Tool.js';
import { ToolResult } from './ToolResult.js';
import type { PromptSection, ToolDescription } from './Tool.js';

class ToolRegistry {
  tools: Map<string, Tool>;

  constructor() {
    this.tools = new Map();
  }

  register(tool: Tool): void {
    if (!tool || !tool.name) {
      throw new Error('工具必须有 name 属性');
    }
    if (this.tools.has(tool.name)) {
      console.warn('[ToolRegistry] 工具 ' + tool.name + ' 已存在，将被覆盖');
    }
    this.tools.set(tool.name, tool);
    console.log('[ToolRegistry] 注册工具: ' + tool.name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, params: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return ToolResult.error('未找到工具: ' + name);
    }
    try {
      return await tool.execute(params);
    } catch (err: any) {
      return ToolResult.error('工具执行失败: ' + err.message);
    }
  }

  getDescriptions(): ToolDescription[] {
    return Array.from(this.tools.values()).map(t => t.getDescription());
  }

  /** 列出运行时动态工具（插件工具等，需运行期注入沙箱） */
  getDynamicTools(): Tool[] {
    return Array.from(this.tools.values()).filter((t) => (t as any).dynamic === true);
  }

  getFormattedToolsForPrompt(): string {
    const descriptions = this.getDescriptions();
    if (descriptions.length === 0) return '暂无可用工具';

    return descriptions.map((t, i) => {
      const params = t.parameters.properties ? Object.keys(t.parameters.properties).join(', ') : '无';
      return (i + 1) + '. **' + t.name + '** - ' + t.description + '\n   参数: ' + params;
    }).join('\n\n');
  }

  size(): number {
    return this.tools.size;
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getFormattedJsApiForPrompt(): string {
    const descriptions = this.getDescriptions().filter((t) => t.jsApi);
    if (descriptions.length === 0) return '暂无可用工具';

    return descriptions.map((t, i) => {
      const sig = '\u0060' + t.jsApi + '\u0060';
      return (i + 1) + '. ' + sig + ' — ' + t.description;
    }).join('\n');
  }

  getPromptSections(): PromptSection[] {
    const sections: PromptSection[] = [];
    for (const tool of this.tools.values()) {
      const section = tool.getPromptSection();
      if (section && typeof section.text === 'string' && section.text.trim().length > 0) {
        sections.push({
          name: section.name || ('tool:' + tool.name),
          order: typeof section.order === 'number' ? section.order : 100,
          text: section.text
        });
      }
    }
    sections.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return sections;
  }

  getFormattedPromptSections(): string {
    const sections = this.getPromptSections();
    if (sections.length === 0) return '';
    return sections.map(s => s.text).join('\n\n');
  }
}

export { ToolRegistry };

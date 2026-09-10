/**
 * 工具注册表 - 管理所有可用工具
 */

class Tool {
  constructor(name, description, parameters, jsApi) {
    this.name = name;
    this.description = description;
    this.parameters = parameters; // JSON Schema 格式
    this.jsApi = jsApi || null; // JS 调用签名，如 'editFile(file_path, old_string, new_string)'
  }

  async execute(params) {
    throw new Error('execute() 必须由子类实现');
  }

  /**
   * 获取工具描述，用于发送给 AI
   */
  getDescription() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      jsApi: this.jsApi
    };
  }

  /**
   * 获取工具的系统提示词 section（仿 dsh 的 ctx.systemPrompt.section）。
   * 返回 { name, order, text } 或 null（默认无 section）。
   * 子类可覆写此方法贡献工具使用指导。
   */
  getPromptSection() {
    return null;
  }
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /**
   * 注册工具
   * @param {Tool} tool - 工具实例
   */
  register(tool) {
    if (!tool || !tool.name) {
      throw new Error('工具必须有 name 属性');
    }
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] 工具 ${tool.name} 已存在，将被覆盖`);
    }
    this.tools.set(tool.name, tool);
    console.log(`[ToolRegistry] 注册工具: ${tool.name}`);
  }

  /**
   * 获取工具
   * @param {string} name - 工具名称
   * @returns {Tool|undefined}
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * 执行工具
   * @param {string} name - 工具名称
   * @param {Object} params - 参数
   * @returns {Promise<ToolResult>}
   */
  async execute(name, params) {
    const tool = this.tools.get(name);
    if (!tool) {
      return ToolResult.error(`未找到工具: ${name}`);
    }
    try {
      // 验证参数（可选，这里简化处理）
      return await tool.execute(params);
    } catch (err) {
      return ToolResult.error(`工具执行失败: ${err.message}`);
    }
  }

  /**
   * 获取所有工具描述
   * @returns {Array}
   */
  getDescriptions() {
    return Array.from(this.tools.values()).map(t => t.getDescription());
  }

  /**
   * 获取格式化的工具列表，用于 Prompt
   * @returns {string}
   */
  getFormattedToolsForPrompt() {
    const descriptions = this.getDescriptions();
    if (descriptions.length === 0) return '暂无可用工具';

    return descriptions.map((t, i) => {
      const params = t.parameters.properties ? Object.keys(t.parameters.properties).join(', ') : '无';
      return `${i + 1}. **${t.name}** - ${t.description}\n   参数: ${params}`;
    }).join('\n\n');
  }

  /**
   * 获取工具数量
   * @returns {number}
   */
  size() {
    return this.tools.size;
  }

  /**
   * 列出所有工具名称
   * @returns {string[]}
   */
  listNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取格式化的 JS API 列表，用于 Prompt（AI 生成 JS 代码调用这些函数）
   * @returns {string}
   */
  getFormattedJsApiForPrompt(excludeTools = null) {
    const excluded = new Set(excludeTools || []);
    const descriptions = this.getDescriptions().filter((t) => t.jsApi).filter((t) => !excluded.has(t.name));
    if (descriptions.length === 0) return '暂无可用工具';

    return descriptions.map((t, i) => {
      const sig = '`' + t.jsApi + '`';
      return (i + 1) + '. ' + sig + ' — ' + t.description;
    }).join('\n');
  }

  /**
   * 收集所有工具的系统提示词 section，按 order 升序排列。
   * 仿 dsh 的 systemPrompt section 机制。
   * @returns {Array<{name: string, order: number, text: string}>}
   */
  getPromptSections(excludeTools = null) {
    const excluded = new Set(excludeTools || []);
    const sections = [];
    for (const tool of this.tools.values()) {
      if (excluded.has(tool.name)) continue;
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

  /**
   * 获取格式化后的工具使用指导（所有 section 文本拼接）。
   * @returns {string}
   */
  getFormattedPromptSections(excludeTools = null) {
    const sections = this.getPromptSections(excludeTools);
    if (sections.length === 0) return '';
    return sections.map(s => s.text).join('\n\n');
  }
}

/**
 * 统一的工具执行结果
 */
class ToolResult {
  constructor(success, data, error) {
    this.success = success;
    this.data = data;
    this.error = error;
  }

  static success(data) {
    return new ToolResult(true, data, null);
  }

  static error(error) {
    return new ToolResult(false, null, error);
  }

  toString() {
    if (this.success) {
      return `✅ 成功: ${JSON.stringify(this.data)}`;
    } else {
      return `❌ 失败: ${this.error}`;
    }
  }
}

module.exports = { Tool, ToolRegistry, ToolResult };

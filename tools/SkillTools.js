const { Tool, ToolResult } = require('./ToolRegistry');
const { SkillManager } = require('../src/main/skill-manager');

// 全局 SkillManager 实例（延迟初始化，避免循环依赖）
let _skillManager = null;
function getSkillManager() {
  if (!_skillManager) {
    _skillManager = new SkillManager();
  }
  return _skillManager;
}

/**
 * Skill 列表工具 - 列出当前项目可用的 Skill 及已加载状态
 */
class SkillListTool extends Tool {
  constructor() {
    super(
      'skill_list',
      '列出当前项目可用的自定义 Skill（含加载状态）',
      {
        type: 'object',
        properties: {},
        required: []
      },
      'skillList()'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:skill-list',
      order: 121,
      text: 'skillList() 列出当前项目可用的自定义 Skill（含加载状态）。'
    };
  }

  async execute(params) {
    const { projectDir } = params;
    if (!projectDir) {
      return ToolResult.error('未初始化项目目录，无法扫描 Skill');
    }
    try {
      const manager = getSkillManager();
      const available = manager.scanAvailableSkills(projectDir);
      const loadedNames = manager.listSkillNames();

      if (available.length === 0) {
        return ToolResult.success(
          '当前项目没有自定义 Skill。\n' +
          '在 <projectDir>/.cuckoo/skills/<skill-name>/ 下创建 SKILL.md 即可定义 Skill，' +
          '可选添加 tool.js 导出可执行函数。'
        );
      }

      const lines = available.map(item => {
        const loaded = loadedNames.includes(item.name);
        const flags = [];
        if (item.hasSkillMd) flags.push('SKILL.md');
        if (item.hasToolJs) flags.push('tool.js');
        return '- ' + item.name + ' [' + (loaded ? '已加载' : '未加载') + ']' +
          (flags.length > 0 ? ' 文件: ' + flags.join(', ') : '');
      });

      return ToolResult.success(
        '当前项目 Skill（' + available.length + ' 个）：\n\n' + lines.join('\n') + '\n\n' +
        '使用 skill_load 加载，skill_execute 执行函数。'
      );
    } catch (err) {
      return ToolResult.error('扫描 Skill 失败: ' + (err.message || String(err)));
    }
  }
}

/**
 * Skill 加载工具 - 加载指定 Skill
 */
class SkillLoadTool extends Tool {
  constructor() {
    super(
      'skill_load',
      '加载指定的自定义 Skill（读取 SKILL.md 和可选 tool.js）',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill 名称（对应 .cuckoo/skills/<name> 目录）' }
        },
        required: ['name']
      },
      'skillLoad(name)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:skill-load',
      order: 122,
      text: 'skillLoad(name) 加载指定 Skill。Skill 位于 <projectDir>/.cuckoo/skills/<name>/。'
    };
  }

  async execute(params) {
    const { name, projectDir } = params;
    if (!name || typeof name !== 'string') {
      return ToolResult.error('name 不能为空');
    }
    if (!projectDir) {
      return ToolResult.error('未初始化项目目录，无法加载 Skill');
    }
    try {
      const manager = getSkillManager();
      const result = manager.loadSkill(projectDir, name);
      if (!result.success) {
        return ToolResult.error(result.error);
      }
      const skill = result.skill;
      const functions = skill.toolExports
        ? Object.keys(skill.toolExports).filter(k => typeof skill.toolExports[k] === 'function')
        : [];
      const functionInfo = functions.length > 0
        ? '可执行函数: ' + functions.join(', ') + '\n\n'
        : '该 Skill 没有 tool.js，不可执行函数。\n\n';
      return ToolResult.success(
        'Skill "' + name + '" 加载成功。\n\n' + functionInfo +
        '--- SKILL.md 指令内容 ---\n\n' + skill.skillMd
      );
    } catch (err) {
      return ToolResult.error('加载 Skill 失败: ' + (err.message || String(err)));
    }
  }
}

/**
 * Skill 执行工具 - 执行指定 Skill 的函数
 */
class SkillExecuteTool extends Tool {
  constructor() {
    super(
      'skill_execute',
      '执行指定 Skill 的指定函数（函数在 tool.js 中导出）',
      {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'Skill 名称' },
          function: { type: 'string', description: '要调用的函数名' },
          args: { type: 'object', description: '传给函数的参数对象' }
        },
        required: ['skill', 'function']
      },
      'skillExecute(skill, function, args)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:skill-execute',
      order: 123,
      text: 'skillExecute(skill, function, args) 执行已加载 Skill 的 tool.js 中导出的函数。'
    };
  }

  async execute(params) {
    const { skill, function: functionName, args, projectDir } = params;
    if (!skill || typeof skill !== 'string') {
      return ToolResult.error('skill 不能为空');
    }
    if (!functionName || typeof functionName !== 'string') {
      return ToolResult.error('function 不能为空');
    }
    try {
      const manager = getSkillManager();
      const result = await manager.executeSkill(skill, functionName, args || {}, projectDir);
      if (!result.success) {
        return ToolResult.error(result.error);
      }
      const data = result.data;
      if (typeof data === 'string') {
        return ToolResult.success(data);
      }
      if (data === undefined || data === null) {
        return ToolResult.success('(函数执行完成，无返回值)');
      }
      try {
        return ToolResult.success(JSON.stringify(data, null, 2));
      } catch (e) {
        return ToolResult.success(String(data));
      }
    } catch (err) {
      return ToolResult.error('执行 Skill 函数失败: ' + (err.message || String(err)));
    }
  }
}

module.exports = { SkillListTool, SkillLoadTool, SkillExecuteTool, getSkillManager };

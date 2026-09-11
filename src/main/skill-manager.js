/**
 * SkillManager - 管理自定义 Skill 的加载、注册与执行
 *
 * Skill 定义：
 * - 每个 Skill 是一个目录，位于 <projectDir>/.cuckoo/skills/<skill-name>/
 * - 目录下必须有 SKILL.md（Markdown 指令文件）
 * - 可选 tool.js（导出一个或多个异步函数，用于执行具体任务）
 *
 * 加载时机：项目初始化 / 手动调用 skill_load 工具
 * 执行方式：通过 skill_execute 工具调用指定 skill 的指定函数
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SKILLS_DIR_NAME = '.cuckoo';
const SKILLS_SUBDIR = 'skills';

/**
 * 安全序列化（处理循环引用等异常）
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    try {
      return String(value);
    } catch (e2) {
      return '[无法序列化的返回值]';
    }
  }
}

class SkillManager {
  constructor() {
    /** @type {Map<string, {name: string, dir: string, skillMd: string, toolExports: Object|null}>} */
    this.skills = new Map();
  }

  /**
   * 获取 Skill 根目录
   * @param {string} projectDir
   * @returns {string}
   */
  getSkillsRoot(projectDir) {
    return path.join(projectDir, SKILLS_DIR_NAME, SKILLS_SUBDIR);
  }

  /**
   * 列出所有已加载的 Skill 名称
   * @returns {string[]}
   */
  listSkillNames() {
    return Array.from(this.skills.keys());
  }

  /**
   * 列出指定项目目录下所有可用的 Skill（不加载，仅扫描）
   * @param {string} projectDir
   * @returns {Array<{name: string, hasToolJs: boolean, hasSkillMd: boolean}>}
   */
  scanAvailableSkills(projectDir) {
    const root = this.getSkillsRoot(projectDir);
    const result = [];
    try {
      if (!fs.existsSync(root)) return result;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(root, entry.name);
        const hasSkillMd = fs.existsSync(path.join(skillDir, 'SKILL.md'));
        const hasToolJs = fs.existsSync(path.join(skillDir, 'tool.js'));
        result.push({ name: entry.name, hasSkillMd, hasToolJs });
      }
    } catch (err) {
      // 扫描失败返回空列表
    }
    return result;
  }

  /**
   * 加载单个 Skill
   * @param {string} projectDir
   * @param {string} skillName
   * @returns {{success: boolean, error?: string, skill?: Object}}
   */
  loadSkill(projectDir, skillName) {
    if (!projectDir) {
      return { success: false, error: '未初始化项目目录，无法加载 Skill' };
    }
    if (!skillName || typeof skillName !== 'string') {
      return { success: false, error: 'skillName 不能为空' };
    }

    const root = this.getSkillsRoot(projectDir);
    const skillDir = path.join(root, skillName);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const toolJsPath = path.join(skillDir, 'tool.js');

    if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
      return { success: false, error: 'Skill 目录不存在: ' + skillDir };
    }
    if (!fs.existsSync(skillMdPath)) {
      return { success: false, error: 'Skill 缺少 SKILL.md: ' + skillMdPath };
    }

    let skillMd = '';
    try {
      skillMd = fs.readFileSync(skillMdPath, 'utf-8');
    } catch (err) {
      return { success: false, error: '读取 SKILL.md 失败: ' + err.message };
    }

    let toolExports = null;
    if (fs.existsSync(toolJsPath)) {
      try {
        const toolCode = fs.readFileSync(toolJsPath, 'utf-8');
        toolExports = this._loadToolModule(toolCode, skillDir, projectDir);
      } catch (err) {
        return { success: false, error: '加载 tool.js 失败: ' + err.message };
      }
    }

    const skill = {
      name: skillName,
      dir: skillDir,
      skillMd,
      toolExports,
    };
    this.skills.set(skillName, skill);

    console.log('[SkillManager] 加载 Skill: ' + skillName + (toolExports ? '（含 tool.js）' : ''));
    return { success: true, skill };
  }

  /**
   * 加载项目下所有 Skill
   * @param {string} projectDir
   * @returns {{success: boolean, loaded: string[], errors: string[]}}
   */
  loadAllSkills(projectDir) {
    const available = this.scanAvailableSkills(projectDir);
    const loaded = [];
    const errors = [];
    for (const item of available) {
      const res = this.loadSkill(projectDir, item.name);
      if (res.success) {
        loaded.push(item.name);
      } else {
        errors.push(item.name + ': ' + res.error);
      }
    }
    return { success: errors.length === 0, loaded, errors };
  }

  /**
   * 卸载全部 Skill（切换项目时调用）
   */
  unloadAll() {
    this.skills.clear();
  }

  /**
   * 获取所有已加载 Skill 的指令文本（用于拼入 systemPrompt）
   * @returns {string}
   */
  getSkillsPromptText() {
    if (this.skills.size === 0) return '';
    const sections = [];
    for (const skill of this.skills.values()) {
      sections.push('## Skill: ' + skill.name + '\n\n' + skill.skillMd);
    }
    return sections.join('\n\n---\n\n');
  }

  /**
   * 执行某个 Skill 的某个函数
   * @param {string} skillName
   * @param {string} functionName
   * @param {Object} args
   * @param {string} projectDir
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  async executeSkill(skillName, functionName, args, projectDir) {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return { success: false, error: 'Skill 未加载: ' + skillName + '，请先使用 skill_load 加载' };
    }
    if (!skill.toolExports) {
      return { success: false, error: 'Skill "' + skillName + '" 未提供 tool.js，无可执行函数' };
    }
    if (!functionName || typeof functionName !== 'string') {
      return { success: false, error: 'functionName 不能为空' };
    }

    const fn = skill.toolExports[functionName];
    if (typeof fn !== 'function') {
      const available = Object.keys(skill.toolExports).filter(k => typeof skill.toolExports[k] === 'function');
      return {
        success: false,
        error: 'Skill "' + skillName + '" 没有函数 "' + functionName + '"' +
          (available.length > 0 ? '，可用函数: ' + available.join(', ') : '')
      };
    }

    try {
      const result = await fn.call(null, args || {}, { projectDir, skillDir: skill.dir });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: '执行 Skill 函数失败: ' + (err.message || String(err)) };
    }
  }

  /**
   * 在受限沙箱中加载 tool.js 模块
   * 仅注入 fs/path 等有限的 Node 能力，不暴露 require/process
   * @param {string} toolCode
   * @param {string} skillDir
   * @returns {Object} 导出的函数对象
   */
  _loadToolModule(toolCode, skillDir, projectDir) {
    const moduleObj = { exports: {} };
    const sandbox = {
      module: moduleObj,
      exports: moduleObj.exports,
      console: {
        log: (...args) => console.log('[Skill:' + path.basename(skillDir) + ']', ...args),
        error: (...args) => console.error('[Skill:' + path.basename(skillDir) + ']', ...args),
        warn: (...args) => console.warn('[Skill:' + path.basename(skillDir) + ']', ...args),
      },
      // 有限的文件能力：仅允许在 skillDir 与 projectDir 内读写
      fs: (() => {
        const allowedFs = {};
        const methods = ['readFileSync', 'writeFileSync', 'existsSync', 'readdirSync', 'statSync', 'lstatSync'];
        for (const method of methods) {
          allowedFs[method] = (...args) => {
            // 第一个参数是路径
            const p = args[0];
            const resolved = this._resolveAllowedPath(skillDir, projectDir, p);
            return fs[method].apply(fs, [resolved, ...args.slice(1)]);
          };
        }
        return allowedFs;
      })(),
      path: (() => {
        const allowedPath = {};
        const pathMethods = ['join', 'basename', 'dirname', 'extname', 'resolve', 'relative', 'isAbsolute', 'sep', 'normalize'];
        for (const method of pathMethods) {
          if (typeof path[method] === 'function') {
            allowedPath[method] = (...args) => path[method](...args);
          } else {
            allowedPath[method] = path[method];
          }
        }
        return allowedPath;
      })(),
      __skillDir: skillDir,
      __filename: path.join(skillDir, 'tool.js'),
      __dirname: skillDir,
    };

    // 截断原型链，防止逃逸
    try { Object.setPrototypeOf(sandbox, null); } catch (e) { /* 尽力而为 */ }

    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
      name: 'cuckoo-skill-sandbox',
    });

    const wrappedCode = '(function(require, module, exports, __filename, __dirname, console, fs, path, __skillDir) {\n' +
      toolCode + '\n})';

    const script = new vm.Script(wrappedCode, { filename: 'cuckoo-skill-tool.js' });
    script.runInContext(context, { timeout: 10000 });

    // 调用包装函数，传入受限依赖
    const wrapperFn = vm.runInContext('(' + wrappedCode + ')', context, { timeout: 10000 });
    wrapperFn(
      (name) => {
        // 禁止 require 任意模块，仅允许内建有限集
        const allowedModules = ['fs', 'path'];
        if (allowedModules.includes(name)) {
          if (name === 'fs') return sandbox.fs;
          if (name === 'path') return sandbox.path;
        }
        throw new Error('Skill tool.js 禁止 require: ' + name);
      },
      moduleObj,
      moduleObj.exports,
      __filename,
      __dirname,
      sandbox.console,
      sandbox.fs,
      sandbox.path,
      skillDir
    );

    return moduleObj.exports;
  }

  /**
   * 将 Skill 内使用的路径解析到允许的目录范围内（skillDir 或 projectDir）
   * 防止越权访问文件系统
   */
  _resolveAllowedPath(skillDir, projectDir, p) {
    if (typeof p !== 'string') throw new Error('路径必须是字符串');
    const normalized = path.isAbsolute(p) ? p : path.join(skillDir, p);
    const resolved = path.resolve(normalized);

    const allowedRoots = [];
    if (skillDir) allowedRoots.push(path.resolve(skillDir));
    if (projectDir) allowedRoots.push(path.resolve(projectDir));

    for (const root of allowedRoots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        return resolved;
      }
    }

    throw new Error('禁止访问 Skill 目录和项目目录之外的路径: ' + p);
  }

  /**
   * 兼容旧方法名（保持向后兼容）
   */
  _resolveInSkillDir(skillDir, p) {
    return this._resolveAllowedPath(skillDir, null, p);
  }
}

// 全局单例（懒加载）
let _instance = null;
function getSkillManager() {
  if (!_instance) {
    _instance = new SkillManager();
  }
  return _instance;
}

module.exports = { SkillManager, getSkillManager, safeStringify };

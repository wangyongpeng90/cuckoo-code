/**
 * IPC：项目初始化
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as windowState from '../window.js';
import * as mcpClient from '../../mcp/client.js';
import { initProject } from '../../session/project-context.js';
import { scanSkills } from '../../skills/index.js';
import { buildSkillsSection } from '../../skills/prompt.js';
import { scanAgents } from '../../agents/index.js';
import { buildAgentsSection } from '../../agents/prompt.js';
import { getPluginScanRoots } from '../../plugins/roots.js';
import { parseFrontmatter } from '../../skills/frontmatter.js';

const require = createRequire(import.meta.url);
const { ipcMain, shell } = require('electron');

function registerProjectIpc(): void {
  // 初始化项目
  ipcMain.handle('init-project', async (event: any, { skipPrompt = false, projectDir = null, isCompaction = false, extraPrompt = '', noDialog = false }: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const windowId = ctx && ctx.win ? ctx.win.id : null;
    const result = await initProject(skipPrompt, ctx, projectDir, isCompaction, extraPrompt || '', !!noDialog);
    // 项目目录可能变化：释放该窗口对"旧项目"的 MCP 连接引用
    if (windowId !== null) {
      try {
        const newDir = (ctx && ctx.sessionStore && ctx.sessionStore.state.selectedProjectDir) || null;
        mcpClient.releaseProject(windowId, newDir);
      } catch (_) {}
    }
    return result;
  });

  // 列出所有技能（结构化，供壳页面「技能」页展示）
  ipcMain.handle('list-skills', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = store ? store.state.selectedProjectDir : null;
      const skills = scanSkills(projectDir || null, getPluginScanRoots().skillDirs);
      return {
        success: true,
        skills: skills.map((s: any) => ({
          name: s.name,
          description: s.description,
          whenToUse: s.whenToUse || '',
          source: s.source,
          skillPath: s.skillPath,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 列出所有子代理（结构化，供壳页面「子代理」页展示）
  ipcMain.handle('list-agents', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = store ? store.state.selectedProjectDir : null;
      const agents = scanAgents(projectDir || null);
      return {
        success: true,
        agents: agents.map((a: any) => ({
          name: a.name,
          description: a.description,
          source: a.source,
          agentPath: a.agentPath,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 新建子代理文件（生成模板 + 用系统默认程序打开编辑）
  ipcMain.handle('create-agent-file', async (event: any, { name, scope }: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = store ? store.state.selectedProjectDir : null;

      let baseDir: string;
      if (scope === 'project') {
        if (!projectDir) return { success: false, error: '请先选择项目目录' };
        baseDir = projectDir;
      } else {
        baseDir = os.homedir();
      }

      const agentsDir = path.join(baseDir, '.cuckoo', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const safeName = String(name || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'my-agent';
      const filePath = path.join(agentsDir, safeName + '.md');
      if (fs.existsSync(filePath)) return { success: false, error: '同名子代理已存在：' + safeName };

      const tpl = [
        '---',
        'name: ' + safeName,
        'description: （一句话说明何时委派给这个子代理）',
        '---',
        '',
        '（这里是子代理的系统提示词：写清它的职责、执行方式、输出要求。）',
        '',
      ].join('\n');
      fs.writeFileSync(filePath, tpl, 'utf-8');

      // 用系统默认程序打开（编辑器/预览）
      await shell.openPath(filePath);
      return { success: true, path: filePath, name: safeName };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 安全校验：只允许操作 .cuckoo/agents/ 下的 .md 文件
  function isAgentFile(p: any): boolean {
    if (typeof p !== 'string' || !p) return false;
    const norm = p.replace(/\\/g, '/').toLowerCase();
    return norm.includes('/.cuckoo/agents/') && norm.endsWith('.md');
  }

  // 重命名子代理：改名（重命名文件 + 更新 frontmatter 的 name 字段）
  ipcMain.handle('rename-agent', async (_event: any, { agentPath, newName }: any) => {
    try {
      if (!isAgentFile(agentPath)) return { success: false, error: '非法路径' };
      if (!fs.existsSync(agentPath)) return { success: false, error: '文件不存在' };
      const safe = String(newName || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!safe) return { success: false, error: '名称不能为空' };
      const dir = path.dirname(agentPath);
      const newPath = path.join(dir, safe + '.md');
      if (newPath === agentPath) return { success: true, path: agentPath };
      if (fs.existsSync(newPath)) return { success: false, error: '同名子代理已存在：' + safe };

      // 更新内容里的 frontmatter name 字段
      let content = fs.readFileSync(agentPath, 'utf-8');
      const { data, body } = parseFrontmatter(content);
      if (Object.keys(data).length > 0) {
        // 有 frontmatter：重写 name
        const fmLines = ['---'];
        const keys = Object.keys(data);
        if (!keys.includes('name')) keys.unshift('name');
        for (const k of keys) {
          fmLines.push(k + ': ' + (k === 'name' ? safe : data[k]));
        }
        fmLines.push('---');
        content = fmLines.join('\n') + '\n' + body;
      } else {
        // 无 frontmatter：补一个
        content = '---\nname: ' + safe + '\n---\n\n' + content;
      }
      fs.writeFileSync(newPath, content, 'utf-8');
      fs.unlinkSync(agentPath);
      return { success: true, path: newPath, name: safe };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 用系统默认程序打开子代理文件（供「编辑」按钮）
  ipcMain.handle('open-agent-file', async (_event: any, { agentPath }: any) => {
    try {
      if (!isAgentFile(agentPath)) return { success: false, error: '非法路径' };
      if (!fs.existsSync(agentPath)) return { success: false, error: '文件不存在' };
      await shell.openPath(agentPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 删除子代理文件（供「删除」按钮）
  ipcMain.handle('delete-agent-file', async (_event: any, { agentPath }: any) => {
    try {
      if (!isAgentFile(agentPath)) return { success: false, error: '非法路径' };
      if (!fs.existsSync(agentPath)) return { success: false, error: '文件不存在' };
      fs.unlinkSync(agentPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 重新扫描技能 + 代理，返回合并清单文本（供「刷新技能与代理」按钮使用）
  ipcMain.handle('refresh-skills', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = store ? store.state.selectedProjectDir : null;
      const skills = scanSkills(projectDir || null, getPluginScanRoots().skillDirs);
      const agents = scanAgents(projectDir || null, getPluginScanRoots().agentDirs);
      // 合并：技能章节 + 代理章节（各自无内容时返回空串）
      const sections = [buildSkillsSection(skills), buildAgentsSection(agents)].filter((s) => s && s.trim());
      const section = sections.join('\n');
      return { success: true, section, skillCount: skills.length, agentCount: agents.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerProjectIpc };

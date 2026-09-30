/**
 * IPC：项目初始化
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import * as mcpClient from '../../mcp/client.js';
import { initProject } from '../../session/project-context.js';
import { scanSkills } from '../../skills/index.js';
import { buildSkillsSection } from '../../skills/prompt.js';
import { scanAgents } from '../../agents/index.js';
import { buildAgentsSection } from '../../agents/prompt.js';
import * as skillConfig from '../../skills/config.js';
import * as skillMarket from '../../skills/market.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

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
      const skills = scanSkills(projectDir || null);
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

  // 重新扫描技能 + 代理，返回合并清单文本（供「刷新技能与代理」按钮使用）
  ipcMain.handle('refresh-skills', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = store ? store.state.selectedProjectDir : null;
      const skills = scanSkills(projectDir || null);
      const agents = scanAgents(projectDir || null);
      // 合并：技能章节 + 代理章节（各自无内容时返回空串）
      const sections = [buildSkillsSection(skills), buildAgentsSection(agents)].filter((s) => s && s.trim());
      const section = sections.join('\n');
      return { success: true, section, skillCount: skills.length, agentCount: agents.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 临时探测（用完删除）
  ipcMain.handle('ck-dump-dom', async (_event: any, { data }: any) => {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { app } = require('electron');
      fs.appendFileSync(path.join(app.getPath('userData'), 'fold-state.log'), JSON.stringify(data) + '\n', 'utf-8');
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ========== 技能管理（应用级，userData/skills）==========

  // 列出应用级技能（带启用状态）
  ipcMain.handle('list-app-skills', async () => {
    try {
      return { success: true, skills: skillConfig.listSkills() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 新增或更新技能
  ipcMain.handle('upsert-skill', async (_event: any, { skill }: any) => {
    try {
      const saved = skillConfig.upsertSkill(skill || {});
      return { success: true, skill: saved };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 删除技能
  ipcMain.handle('remove-skill', async (_event: any, { id }: any) => {
    try {
      const ok = skillConfig.removeSkill(id);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 启用/禁用技能
  ipcMain.handle('set-skill-enabled', async (_event: any, { id, enabled }: any) => {
    try {
      const ok = skillConfig.setSkillEnabled(id, !!enabled);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ========== SkillHub 市场 ==========

  // 搜索市场技能
  ipcMain.handle('search-skills', async (_event: any, { keyword, page, pageSize }: any) => {
    try {
      const result = await skillMarket.searchSkills(keyword || '', page || 1, pageSize || 24);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 市场技能详情
  ipcMain.handle('get-skill-detail', async (_event: any, { slug, namespace }: any) => {
    try {
      const detail = await skillMarket.getSkillDetail(slug, namespace);
      return { success: true, detail };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 安装市场技能
  ipcMain.handle('install-skill', async (_event: any, { slug, namespace }: any) => {
    try {
      const dir = await skillMarket.downloadAndExtract(slug, namespace);
      const saved = skillConfig.installSkillFromDir(dir);
      return { success: true, skill: saved };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerProjectIpc };

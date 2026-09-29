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

  // 查询当前窗口的项目目录（壳页面「项目」面板打开时拉取；事件转发可能发生在面板打开前）
  ipcMain.handle('get-project-dir', async (event: any) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    const dir = (ctx && ctx.sessionStore && ctx.sessionStore.state.selectedProjectDir) || null;
    return { success: true, projectDir: dir };
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
}

export { registerProjectIpc };

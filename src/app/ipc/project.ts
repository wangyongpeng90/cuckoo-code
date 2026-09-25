/**
 * IPC：项目初始化
 */
import { createRequire } from 'node:module';
import * as windowState from '../window.js';
import { initProject } from '../../session/project-context.js';
import { scanSkills } from '../../skills/index.js';
import { buildSkillsSection } from '../../skills/prompt.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function registerProjectIpc(): void {
  // 初始化项目
  ipcMain.handle('init-project', async (event: any, { skipPrompt = false, projectDir = null, isCompaction = false }: any = {}) => {
    const ctx = windowState.getContextByWebContents(event.sender);
    return initProject(skipPrompt, ctx, projectDir, isCompaction);
  });

  // 重新扫描技能，返回技能清单文本（供「发送skill信息」按钮使用）
  ipcMain.handle('refresh-skills', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = store ? store.state.selectedProjectDir : null;
      const skills = scanSkills(projectDir || null);
      const section = buildSkillsSection(skills);
      return { success: true, section, count: skills.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerProjectIpc };

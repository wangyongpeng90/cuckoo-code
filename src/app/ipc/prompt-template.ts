/**
 * IPC：系统提示词模板（读取内置模板 + 用户自定义模板）[261105-uw877b]
 *
 * 只读接口。保存 / 恢复默认走现有的 save-shared-settings / reset-shared-settings
 * （键：cuckoo-system-prompt-template:{providerId}）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getAllProviders, getProvider } from '../../providers/registry.js';
import { getSetting } from '../settings-store.js';
import { PROMPT_DIR, customTemplateKey } from '../../session/prompt-builder.js';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

/**
 * 计算某平台的「内置模板」内容（复刻 prompt-builder.loadTemplate 的优先级，
 * 但不含自定义一级）：
 *   1) provider.getPromptTemplate()
 *   2) src/prompt/{id}.md
 *   3) src/prompt/default.md
 */
function readBuiltinTemplate(providerId: string): string {
  const provider = getProvider(providerId);
  if (provider && typeof provider.getPromptTemplate === 'function') {
    try {
      const fromMethod = provider.getPromptTemplate();
      if (fromMethod && typeof fromMethod === 'string' && fromMethod.trim()) return fromMethod;
    } catch (_) { /* ignore */ }
  }
  if (providerId) {
    const candidate = path.join(PROMPT_DIR, providerId + '.md');
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf-8');
    } catch (_) { /* ignore */ }
  }
  try {
    return fs.readFileSync(path.join(PROMPT_DIR, 'default.md'), 'utf-8');
  } catch (_) {
    return '';
  }
}

function registerPromptTemplateIpc(): void {
  ipcMain.handle('get-prompt-template', async (_event: any, payload: any) => {
    try {
      const providerId = (payload && payload.providerId) || '';
      // 平台列表：内置 + 用户导入 + 插件贡献（动态）
      const providers = getAllProviders().map((p: any) => ({ id: p.id, name: p.name || p.id }));
      const builtin = providerId ? readBuiltinTemplate(providerId) : '';
      const custom = providerId ? (getSetting(customTemplateKey(providerId)) || '') : '';
      return { success: true, providers, builtin, custom };
    } catch (err: any) {
      return { success: false, error: err && err.message };
    }
  });
}

export { registerPromptTemplateIpc };

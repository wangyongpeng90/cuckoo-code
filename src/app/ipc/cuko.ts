/**
 * [261109-8ms69z-cuko-api] Cuko API IPC 处理器（整合 Provider、Session、工具执行）
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 */

/**
 * Cuko API 独立窗口的 IPC 处理器。
 * 采用 Provider / Model 分离结构（类似 DSH 的工业级设计）。
 */
import { createRequire } from 'node:module';
import { buildPrompt } from '../../session/prompt-builder.js';
import { jsRunner } from '../../tools/index.js';
import { pickJsResultPhrase } from '../../overlay/js-result-phrases.js';
import { splitPromptByH1 } from '../cuko-run-protocol.js';
import {
  startCukoRun,
  cancelCukoRun,
  cancelAllCukoRuns,
  listCukoRuns,
  subscribeCukoRuns,
} from '../cuko-runner.js';
const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function getDb() {
  return (global as any).__globalDb;
}


export function registerCukoIpc(): void {
  // ====== 杂项配置（保留） ======
  ipcMain.handle('cuko:get-config', () => {
    const db = getDb();
    if (!db) return {};
    try {
      const rows = db.prepare('SELECT key, value FROM cuko_config').all() as Array<{ key: string; value: string }>;
      const config: Record<string, string> = {};
      for (const row of rows) config[row.key] = row.value;
      return config;
    } catch { return {}; }
  });

  ipcMain.handle('cuko:save-config', (_event: any, config: Record<string, string>) => {
    const db = getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO cuko_config (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(config)) stmt.run(key, String(value));
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== Provider 管理 ======
  ipcMain.handle('cuko:list-providers', () => {
    const db = getDb();
    if (!db) return [];
    try {
      const rows = db.prepare('SELECT * FROM cuko_providers').all() as any[];
      return rows.map(p => {
        const models = db.prepare('SELECT * FROM cuko_models WHERE provider_id = ?').all(p.id) as any[];
        return {
          id: p.id,
          name: p.name,
          baseUrl: p.base_url,
          apiKey: p.api_key,
          protocol: p.protocol,
          models: models.map(m => ({ id: m.model_id, name: m.name }))
        };
      });
    } catch { return []; }
  });

  ipcMain.handle('cuko:save-provider', (_event: any, provider: any) => {
    const db = getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    try {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT id FROM cuko_providers WHERE id = ?').get(provider.id);
      
      if (existing) {
        db.prepare(`
          UPDATE cuko_providers 
          SET name = ?, base_url = ?, api_key = ?, protocol = ?, updated_at = ?
          WHERE id = ?
        `).run(provider.name, provider.baseUrl, provider.apiKey || null, provider.protocol || 'cuko', now, provider.id);
      } else {
        db.prepare(`
          INSERT INTO cuko_providers (id, name, base_url, api_key, protocol, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(provider.id, provider.name, provider.baseUrl, provider.apiKey || null, provider.protocol || 'cuko', now, now);
      }
      
      // 同步模型列表（先清空旧的）
      if (provider.models && Array.isArray(provider.models)) {
        db.prepare('DELETE FROM cuko_models WHERE provider_id = ?').run(provider.id);
        const stmt = db.prepare(`
          INSERT INTO cuko_models (provider_id, model_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const m of provider.models) {
          stmt.run(provider.id, m.id, m.name || m.id, now, now);
        }
      }
      
      return { success: true };
    } catch (err: any) {
      console.error('[cuko:save-provider]', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cuko:delete-provider', (_event: any, id: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('DELETE FROM cuko_providers WHERE id = ?').run(id);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== 当前激活状态 ======
  ipcMain.handle('cuko:get-active', () => {
    const db = getDb();
    if (!db) return {};
    try {
      const rows = db.prepare("SELECT key, value FROM cuko_config WHERE key IN ('active_provider', 'active_model')").all() as any[];
      const res: Record<string, string> = {};
      for (const r of rows) res[r.key] = r.value;
      return { providerId: res.active_provider, modelId: res.active_model };
    } catch { return {}; }
  });

  ipcMain.handle('cuko:set-active', (_event: any, providerId: string, modelId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO cuko_config (key, value) VALUES (?, ?)');
      stmt.run('active_provider', providerId);
      stmt.run('active_model', modelId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== 会话管理 ======
  ipcMain.handle('cuko:list-sessions', () => {
    const db = getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM cuko_sessions ORDER BY updated_at DESC').all();
  });

  ipcMain.handle('cuko:create-session', (_event: any, sessionId: string, providerId?: string, modelId?: string, projectDir?: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('INSERT INTO cuko_sessions (id, title, provider_id, model_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sessionId, 'New Chat', providerId || null, modelId || null, projectDir || null, now, now);
    return { success: true };
  });

  ipcMain.handle('cuko:rename-session', (_event: any, sessionId: string, title: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, sessionId);
    return { success: true };
  });

  // 执行 cuckoo 代码块（复用主项目 JsRunner，projectDir 由调用方传入）
  ipcMain.handle('cuko:execute-js', async (event: any, code: string, projectDir: string) => {
    if (!code || typeof code !== 'string') {
      return { success: false, error: '无效的 JS 代码' };
    }
    try {
      const win = require('electron').BrowserWindow.fromWebContents(event.sender);
      const windowId = win && !win.isDestroyed() ? win.id : null;
      const result = await jsRunner.run(code, projectDir || null, windowId, {});
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 从工具结果回复语池随机取一条
  ipcMain.handle('cuko:pick-result-phrase', (_event: any, n: number) => {
    try {
      return { success: true, phrase: pickJsResultPhrase(n || 1) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 组装完整系统提示词并按一级标题切分成段
  ipcMain.handle('cuko:build-system-prompt', (_event: any, projectDir: string) => {
    try {
      if (!projectDir) return { success: true, segments: [] };
      const built = buildPrompt({ providerId: 'cuko', selectedDir: projectDir });
      if (built.error) return { success: false, error: built.error };
      const segments = splitPromptByH1(built.prompt);
      return { success: true, segments };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ====== 工作区管理 ======
  ipcMain.handle('cuko:list-workspaces', () => {
    const db = getDb();
    if (!db) return [];
    try {
      return db.prepare('SELECT path, name, COALESCE(archived, 0) AS archived FROM cuko_workspaces ORDER BY created_at ASC').all();
    } catch { return []; }
  });

  ipcMain.handle('cuko:add-workspace', (_event: any, path: string, name: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('INSERT OR IGNORE INTO cuko_workspaces (path, name) VALUES (?, ?)').run(path, name);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:open-workspace-folder', async (_event: any, path: string) => {
    try {
      const err = await require('electron').shell.openPath(path);
      if (err) return { success: false, error: err };
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:rename-workspace', (_event: any, path: string, name: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_workspaces SET name = ? WHERE path = ?').run(name, path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:get-active-workspace', () => {
    const db = getDb();
    if (!db) return null;
    try {
      const row = db.prepare("SELECT value FROM cuko_config WHERE key = 'active_workspace'").get() as any;
      return row ? row.value : null;
    } catch { return null; }
  });

  ipcMain.handle('cuko:set-active-workspace', (_event: any, path: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('INSERT OR REPLACE INTO cuko_config (key, value) VALUES (?, ?)').run('active_workspace', path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:select-directory', async (event: any) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    const result = require('electron').dialog.showOpenDialogSync(win, {
      properties: ['openDirectory'],
      title: '选择工作区目录',
      buttonLabel: '选择',
    });
    if (!result || result.length === 0) return { success: false, canceled: true };
    return { success: true, dir: result[0] };
  });

  ipcMain.handle('cuko:delete-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    // 正在后台跑的会话先停掉，避免删完还在往库里写
    cancelCukoRun(sessionId);
    db.prepare('DELETE FROM cuko_sessions WHERE id = ?').run(sessionId);
    return { success: true };
  });

  ipcMain.handle('cuko:update-session-model', (_event: any, sessionId: string, providerId: string, modelId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET provider_id = ?, model_id = ?, updated_at = ? WHERE id = ?').run(providerId, modelId, now, sessionId);
    return { success: true };
  });

  ipcMain.handle('cuko:archive-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_sessions SET archived = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:unarchive-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_sessions SET archived = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:archive-workspace', (_event: any, path: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_workspaces SET archived = 1 WHERE path = ?').run(path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:unarchive-workspace', (_event: any, path: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_workspaces SET archived = 0 WHERE path = ?').run(path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:update-session-project', (_event: any, sessionId: string, projectDir: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      const now = new Date().toISOString();
      db.prepare('UPDATE cuko_sessions SET project_dir = ?, updated_at = ? WHERE id = ?').run(projectDir || null, now, sessionId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:update-provider-id', (_event: any, sessionId: string, providerSessionId: string) => {
    const db = getDb();
    if (!db || !sessionId) return { success: false };
    // 前端允许留空（下次请求重新开始），这里只做去空白与长度兜底
    const value = String(providerSessionId ?? '').trim().slice(0, 512);
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?').run(value, now, sessionId);
    return { success: true };
  });

  // ====== 附件管理 ======
  // 原文件落盘：<userData>/cuko-attachments/<sessionId>/<messageId>/<index>.<ext>
  // 消息里只存相对路径，换模型 / 换供应商后历史附件依然可读（见需求档案 261109-8ms69z）
  const attachmentsRoot = () => require('node:path').join(require('electron').app.getPath('userData'), 'cuko-attachments');
  const safeSegment = (v: string) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '');

  ipcMain.handle('cuko:save-attachments', async (_event: any, sessionId: string, messageId: string, files: Array<{ filename: string; mimeType: string; data: string }>) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const sid = safeSegment(sessionId);
    const mid = safeSegment(messageId);
    if (!sid || !mid || !Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'invalid arguments' };
    }
    const baseDir = path.join(attachmentsRoot(), sid, mid);
    try {
      fs.mkdirSync(baseDir, { recursive: true });
      const saved: Array<{ filename: string; mimeType: string; path: string }> = [];
      files.forEach((f, i) => {
        const ext = (/\.([a-zA-Z0-9]+)$/.exec(f.filename || '') || ['', ''])[1];
        const fileName = String(i) + (ext ? '.' + ext.toLowerCase() : '');
        fs.writeFileSync(path.join(baseDir, fileName), Buffer.from(String(f.data || ''), 'base64'));
        saved.push({
          filename: f.filename || fileName,
          mimeType: f.mimeType || 'application/octet-stream',
          path: sid + '/' + mid + '/' + fileName,
        });
      });
      return { success: true, attachments: saved };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:read-attachment', async (_event: any, relPath: string) => {
    const fs = require('node:fs');
    const path = require('node:path');
    try {
      const root = attachmentsRoot();
      const abs = path.resolve(root, String(relPath || ''));
      const rel = path.relative(root, abs);
      // 防止 ../ 越权读到附件目录之外的文件
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return { success: false, error: 'invalid path' };
      }
      const buf = fs.readFileSync(abs);
      return { success: true, data: buf.toString('base64') };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== 消息管理 ======
  ipcMain.handle('cuko:get-messages', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return [];
    // 同毫秒插入的多条消息按 rowid 稳定排序（工具消息在后台运行时连续写入）
    return db.prepare('SELECT * FROM cuko_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC').all(sessionId);
  });

  ipcMain.handle('cuko:save-message', (_event: any, msg: any) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('INSERT INTO cuko_messages (id, session_id, role, content, think, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.sessionId, msg.role, msg.content, msg.think || null, msg.usage ? JSON.stringify(msg.usage) : null, now);
    
    db.prepare('UPDATE cuko_sessions SET updated_at = ? WHERE id = ?').run(now, msg.sessionId);
    return { success: true };
  });

  // ====== 后台运行（运行循环在主进程，关窗后继续；每个会话可并行） ======
  ipcMain.handle('cuko:start-run', (event: any, params: any) => {
    // 把发起窗口的 id 传给运行器：nameConversation / runAgent 这类工具需要窗口上下文
    let windowId: number | null = null;
    try {
      const win = require('electron').BrowserWindow.fromWebContents(event.sender);
      windowId = win && !win.isDestroyed() ? win.id : null;
    } catch { /* ignore */ }
    return startCukoRun({ ...(params || {}), windowId });
  });
  ipcMain.handle('cuko:cancel-run', (_event: any, sessionId: string) => cancelCukoRun(sessionId));
  ipcMain.handle('cuko:get-runs', () => listCukoRuns());
  ipcMain.handle('cuko:subscribe-runs', (event: any) => {
    try {
      if (event && event.sender) subscribeCukoRuns(event.sender);
    } catch (err: any) {
      return { success: false, error: err?.message || 'subscribe failed', runs: listCukoRuns() };
    }
    return { success: true, runs: listCukoRuns() };
  });
  // 退出主进程前把仍在跑的请求 abort 掉，避免半截消息
  try { require('electron').app.once('before-quit', () => cancelAllCukoRuns()); } catch { /* ignore */ }
}

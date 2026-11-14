/**
 * Cuko API 独立窗口的 IPC 处理器。
 * 采用 Provider / Model 分离结构（类似 DSH 的工业级设计）。
 */
import { createRequire } from 'node:module';
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

  ipcMain.handle('cuko:create-session', (_event: any, sessionId: string, providerId?: string, modelId?: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('INSERT INTO cuko_sessions (id, title, provider_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, 'New Chat', providerId || null, modelId || null, now, now);
    return { success: true };
  });

  ipcMain.handle('cuko:rename-session', (_event: any, sessionId: string, title: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, sessionId);
    return { success: true };
  });

  ipcMain.handle('cuko:delete-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
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

  ipcMain.handle('cuko:update-provider-id', (_event: any, sessionId: string, providerSessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?').run(providerSessionId, now, sessionId);
    return { success: true };
  });

  // ====== 消息管理 ======
  ipcMain.handle('cuko:get-messages', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM cuko_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
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
}

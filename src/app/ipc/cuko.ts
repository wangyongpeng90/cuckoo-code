/**
 * Cuko API 独立窗口的 IPC 处理器。
 * 负责配置存取以及多会话、消息的 CRUD。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function getDb() {
  return (global as any).__globalDb;
}

export function registerCukoIpc(): void {
  // ====== 配置 ======
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

  // ====== 会话 ======
  ipcMain.handle('cuko:sessions:list', () => {
    const db = getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM cuko_sessions ORDER BY updated_at DESC').all();
  });

  ipcMain.handle('cuko:sessions:create', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('INSERT INTO cuko_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, 'New Chat', now, now);
    return { success: true };
  });

  ipcMain.handle('cuko:sessions:rename', (_event: any, payload: { sessionId: string; title: string }) => {
    const { sessionId, title } = payload;
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, sessionId);
    return { success: true };
  });

  ipcMain.handle('cuko:sessions:delete', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    db.prepare('DELETE FROM cuko_sessions WHERE id = ?').run(sessionId);
    return { success: true };
  });

  ipcMain.handle('cuko:sessions:update-provider', (_event: any, payload: { sessionId: string; providerId: string }) => {
    const { sessionId, providerId: providerSessionId } = payload;
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cuko_sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?').run(providerSessionId, now, sessionId);
    return { success: true };
  });

  // ====== 消息 ======
  ipcMain.handle('cuko:messages:get', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM cuko_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  });

  ipcMain.handle('cuko:messages:save', (_event: any, msg: any) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = new Date().toISOString();
    db.prepare('INSERT INTO cuko_messages (id, session_id, role, content, think, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.sessionId, msg.role, msg.content, msg.think || null, msg.usage ? JSON.stringify(msg.usage) : null, now);
    
    // 顺便更新 session 的时间戳
    db.prepare('UPDATE cuko_sessions SET updated_at = ? WHERE id = ?').run(now, msg.sessionId);
    return { success: true };
  });
}

import type { DatabaseSync } from 'node:sqlite';
import type { WebId, LogicId } from './ids.js';

interface LogicIdMap {
  webIdOf(logicId: LogicId): WebId | null;
  logicIdOf(webId: WebId): LogicId | null;
  bind(logicId: LogicId, webId: WebId, profileId?: string | null): void;
  ensureLogicId(webId: WebId, profileId?: string | null): LogicId;
  has(logicId: LogicId): boolean;
  remove(logicId: LogicId): void;
}

/**
 * 基于 SQLite 的翻译层。
 * 不再读写 JSON，而是直接查 sessions 表。
 */
function createLogicIdMap(db: DatabaseSync): LogicIdMap {
  return {
    webIdOf(logicId: LogicId): WebId | null {
      if (!logicId) return null;
      const row = db.prepare('SELECT web_id FROM sessions WHERE logic_id = ?').get(logicId) as any;
      return row && row.web_id ? (row.web_id as WebId) : null;
    },

    logicIdOf(webId: WebId): LogicId | null {
      if (!webId) return null;
      const row = db.prepare('SELECT logic_id FROM sessions WHERE web_id = ?').get(webId) as any;
      return row && row.logic_id ? (row.logic_id as LogicId) : null;
    },

    bind(logicId: LogicId, webId: WebId, profileId?: string | null): void {
      if (!logicId || !webId) return;
      try {
        // 1. 查一下这个 webId 是否已经被绑过了
        const existWeb = db.prepare('SELECT logic_id FROM sessions WHERE web_id = ?').get(webId) as any;
        if (existWeb) {
          // 如果已经绑过了，且不是当前的 logicId，说明这是一次错误的绑定尝试（比如点开了老会话），直接放弃
          if (existWeb.logic_id !== logicId) return;
        }

        // 2. 看看目标 logicId 是否已存在
        const existLogic = db.prepare('SELECT logic_id FROM sessions WHERE logic_id = ?').get(logicId) as any;
        if (existLogic) {
          // 存在则更新 webId
          db.prepare('UPDATE sessions SET web_id = ?, profile_id = COALESCE(profile_id, ?) WHERE logic_id = ?').run(webId, profileId || null, logicId);
        } else {
          // 不存在，新建
          const now = new Date().toISOString();
          db.prepare('INSERT INTO sessions (logic_id, web_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(logicId, webId, profileId || null, now, now);
        }
      } catch (e: any) {
        console.error('[Cuckoo Code] bind 失败:', e.message);
      }
    },

    ensureLogicId(webId: WebId, profileId?: string | null): LogicId {
      if (!webId) throw new Error('ensureLogicId: webId 为空');
      const row = db.prepare('SELECT logic_id FROM sessions WHERE web_id = ?').get(webId) as any;
      if (row && row.logic_id) return row.logic_id as LogicId;
      
      // 不存在，则 logicId = webId
      const now = new Date().toISOString();
      db.prepare('INSERT INTO sessions (logic_id, web_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(webId, webId, profileId || null, now, now);
      return webId as unknown as LogicId;
    },

    has(logicId: LogicId): boolean {
      if (!logicId) return false;
      const row = db.prepare('SELECT 1 FROM sessions WHERE logic_id = ?').get(logicId);
      return !!row;
    },

    remove(logicId: LogicId): void {
      if (!logicId) return;
      try { db.prepare('DELETE FROM sessions WHERE logic_id = ?').run(logicId); } catch (_) {}
    },
  };
}

export { createLogicIdMap };
export type { WebId, LogicId, LogicIdMap };

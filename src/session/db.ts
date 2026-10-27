import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// 当前数据库结构版本（每次改表结构 +1）
const CURRENT_DB_VERSION = 2;

// [022] workspaces 表 DDL——启动时建表（和 sessions 一致）
// 决策 9.5：持久化注册表。详见 docs/dsh-compat-decisions.md 9.5
// 注：workspace-registry.ts 里也有同一 DDL 的兜底副本（供测试用 :memory: 场景）
const WORKSPACES_DDL = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    session_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * 初始化并打开 SQLite 数据库。
 * 包含：自动建表、开启 WAL、版本迁移、老 JSON 数据迁移。
 * @param userDataDir 用户数据目录（通常是 app.getPath('userData')）
 * @returns DatabaseSync 实例
 */
function initDatabase(userDataDir: string): DatabaseSync {
  const dbPath = path.join(userDataDir, 'cuckoo.db');
  const db = new DatabaseSync(dbPath);

  // 开启 WAL 模式（支持多窗口并发读写）
  db.exec('PRAGMA journal_mode = WAL;');
  // 开启外键约束
  db.exec('PRAGMA foreign_keys = ON;');

  // 检查当前数据库版本
  const verRow = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let dbVersion = verRow.user_version;

  if (dbVersion === 0) {
    // 全新安装：建最新表
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        logic_id TEXT PRIMARY KEY,
        web_id TEXT UNIQUE,
        profile_id TEXT,
        project_dir TEXT,
        title TEXT,
        pending_messages TEXT,
        archived INTEGER DEFAULT 0,
        superseded INTEGER DEFAULT 0,
        parent_id TEXT,
        kind TEXT,
        agent_name TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      ${WORKSPACES_DDL}
    `);
    dbVersion = CURRENT_DB_VERSION;
    db.exec(`PRAGMA user_version = ${dbVersion};`);
    
    // 全新安装直接结束，不需要迁移老数据
    return db;
  }

  // 如果有历史版本，在此处按顺序写 Migration 逻辑
  // 版本 2 不再需要 system_prompt_sent，所以不升级，直接跳过。
  if (dbVersion < 2) {
    dbVersion = 2;
  }

  // 最后确保版本号是最新的
  if (dbVersion < CURRENT_DB_VERSION) {
    db.exec(`PRAGMA user_version = ${CURRENT_DB_VERSION};`);
  }

  // [022] 老库补建 workspaces 表（幂等，已在全新安装分支建过则无副作用）
  // 决策 9.5：workspaces 表随会话表一起在启动时建好，避免"谁用谁建"的补丁感
  db.exec(WORKSPACES_DDL);

  return db;
}

/**
 * 从旧的 JSON 文件迁移数据到 SQLite。
 * 只读，绝不修改或删除用户的原始 JSON 文件。
 */
function migrateLegacyData(db: DatabaseSync, userDataDir: string): void {
  // 0. 检查是否已经迁移过
  try {
    const migrated = db.prepare("SELECT value FROM meta WHERE key = 'legacy_migrated'").get();
    if (migrated && (migrated as any).value === '1') {
      return; // 已经迁移过，直接跳过
    }
  } catch (_) {
    // 如果 meta 表不存在（比如刚升级上来的），建一下
    try { db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);"); } catch (_) {}
  }

  // 0.1 清理之前迁移失败的脏数据（如果有 profile_id 结尾带 .bak 的错误记录）
  try {
    db.exec("DELETE FROM sessions WHERE profile_id LIKE '%.bak'");
  } catch (_) { /* ignore */ }



  // 1. 只找真正的 .json 文件
  const files = fs.readdirSync(userDataDir).filter(f => f.startsWith('session-dir-map-') && f.endsWith('.json'));
  if (files.length === 0) return;

  console.log('[DB] 开始检查并迁移老 JSON 数据...');
  
  // 准备插入语句（如果存在则覆盖更新，解决老数据脏的问题）
  const stmt = db.prepare(`
    INSERT INTO sessions (
      logic_id, web_id, profile_id, project_dir, title, pending_messages, 
      archived, superseded, parent_id, kind, agent_name, 
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(logic_id) DO UPDATE SET
      profile_id = excluded.profile_id,
      project_dir = excluded.project_dir,
      title = excluded.title,
      pending_messages = excluded.pending_messages,
      archived = excluded.archived,
      superseded = excluded.superseded,
      parent_id = excluded.parent_id,
      kind = excluded.kind,
      agent_name = excluded.agent_name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  
  // 专门针对 project_archive 的补丁语句
  const archiveStmt = db.prepare(`
    INSERT INTO sessions (
      logic_id, web_id, profile_id, project_dir, kind, archived, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, 'project_archive', 1, ?, ?)
    ON CONFLICT(logic_id) DO UPDATE SET
      profile_id = excluded.profile_id,
      project_dir = excluded.project_dir,
      kind = excluded.kind,
      archived = excluded.archived,
      updated_at = excluded.updated_at
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const f of files) {
      const filePath = path.join(userDataDir, f);
      const raw = fs.readFileSync(filePath, 'utf-8');
      let data: any = {};
      try { data = JSON.parse(raw); } catch (_) { continue; }

      // 从文件名推断 profileId（兼容 .json 和 .json.bak）
      const match = f.match(/^session-dir-map-(.*?)\.json/);
      const profileId = match ? match[1] : f.replace('session-dir-map-', '').replace('.json', '').replace('.bak', '');

      // 先处理归档项目列表
      if (data._archivedProjects && Array.isArray(data._archivedProjects)) {
        const now = new Date().toISOString();
        for (const dir of data._archivedProjects) {
          if (typeof dir !== 'string') continue;
          // 修正参数：logic_id, web_id, profile_id, project_dir, kind, archived, created_at, updated_at
          archiveStmt.run(
            'project_archive_' + dir, profileId, dir, now, now
          );
        }
      }

      for (const [webId, meta] of Object.entries(data)) {
        if (webId === '_archivedProjects') continue;
        if (!meta) continue;

        let projectDir = null;
        let title = null;
        let pendingMessages = null;
        let archived = 0;
        let superseded = 0;
        let parentId = null;
        let kind = null;
        let agentName = null;
        let createdAt = null;
        let updatedAt = null;

        if (typeof meta === 'string') {
          projectDir = meta;
        } else if (typeof meta === 'object') {
          projectDir = (meta as any).projectDir || null;
          title = (meta as any).title || null;
          pendingMessages = Array.isArray((meta as any).pendingMessages) ? JSON.stringify((meta as any).pendingMessages) : null;
          archived = (meta as any).archived ? 1 : 0;
          superseded = (meta as any).superseded ? 1 : 0;
          parentId = (meta as any).parentId || null;
          kind = (meta as any).kind || null;
          agentName = (meta as any).agentName || null;
          createdAt = (meta as any).createdAt || null;
          updatedAt = (meta as any).updatedAt || null;
        }

        // 因为老规矩：logicId = webId，所以直接插入
        // 注意：这里即使 logic-id-map.json 里有错乱的映射，我们也强行纠正为 logicId = webId
        // 真正插入会话
        stmt.run(
          webId, webId, profileId, projectDir, title, pendingMessages,
          archived, superseded, parentId, kind, agentName,
          createdAt, updatedAt
        );
      }
      
      // 再处理归档列表
      if (data._archivedProjects && Array.isArray(data._archivedProjects)) {
        const now = new Date().toISOString();
        for (const dir of data._archivedProjects) {
          if (typeof dir !== 'string') continue;
          archiveStmt.run('project_archive_' + dir, profileId, dir, now, now);
        }
      }
    }
    
    db.exec('COMMIT;');

    // [022] 决策 9.5：从 sessions 的 project_dir 回填 workspaces
    // 背景：JSON 时代没有独立 workspace 概念，工作区是从 session.project_dir 动态聚合的。
    //       接线到持久化 registry 后，必须迁移这些"隐式工作区"，否则侧栏工作区会消失。
    // 幂等：path UNIQUE + INSERT OR IGNORE
    // 排除 project_archive：归档是 Cuckoo 独有的项目归档概念，不是工作区
    // 失败不阻塞：最坏情况是侧栏显示不全，用户重新选目录时自动补建
    try {
      const dirs = db.prepare(`
        SELECT DISTINCT project_dir FROM sessions
        WHERE project_dir IS NOT NULL
          AND project_dir != ''
          AND (kind IS NULL OR kind != 'project_archive')
      `).all() as Array<{ project_dir: string }>;

      const insertWs = db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, path, title, session_ids, created_at, updated_at)
        VALUES (?, ?, ?, '[]', ?, ?)
      `);

      const now = new Date().toISOString();
      let created = 0;
      for (const row of dirs) {
        let canonical = row.project_dir;
        try {
          if (fs.existsSync(canonical)) canonical = fs.realpathSync(canonical);
        } catch { /* 保留原值 */ }
        const title = canonical.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || canonical;
        try {
          insertWs.run(randomUUID(), canonical, title, now, now);
          created++;
        } catch { /* 单条失败不影响其他 */ }
      }
      if (created > 0) console.log('[DB] workspaces 回填完成，共 ' + created + ' 条');
    } catch (err: any) {
      console.error('[DB] workspaces 回填失败（不阻塞）:', err.message);
    }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_migrated', '1')").run();
    console.log('[DB] 老数据迁移完成，已打上标记，以后不再重复读取老 JSON。');
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('[DB] 数据迁移失败，已回滚:', err.message);
  }
}

export { initDatabase, migrateLegacyData, DatabaseSync };

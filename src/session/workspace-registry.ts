/**
 * Workspace Registry —— 持久化的工作区注册表
 *
 * [022] 决策 9.5：升级为 SQLite 持久化注册表（原先是"从 session.projectDir 动态聚合"）
 * [022] 决策 9.6：attachSession 完整对齐 DSH 五道校验（entity.ts:109-149）
 *
 * 详见 docs/requirements/022-dsh-plugin-compat.md C4-D + docs/dsh-compat-decisions.md 第九章
 *
 * 为什么需要持久化：
 *   - 旧实现每次 list() 现扫 session.projectDir 去重，导致"空工作区（无 session）"不出现
 *   - dsh-tasks 配置 workspaceId 后，get() 找不到 → throw "workspace not found"
 *   - DSH 的 WorkspaceId 是 uuid，与 path 分离（path 会被 realpath 重写，id 必须稳定）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** [022] 工作区对象（对齐 DSH workspace/src/types.ts:63-129 的精简版） */
export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionIds: readonly string[];
  /** [022] 决策 9.6：五道校验后前插到 sessionIds */
  attachSession(sessionId: string): Promise<void>;
}

/** [022] 只实现 dsh-tasks 用到的方法（create/get/list/resolveByPath） */
export interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<Workspace>;
  get(id: string): Workspace | undefined;
  list(): Workspace[];
  resolveByPath(path: string): Workspace | undefined;
}

interface SessionRow {
  project_dir: string | null;
}

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    session_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

async function realpathNormalize(p: string): Promise<string> {
  return fs.promises.realpath(p);
}

function titleFromPath(p: string): string {
  const seg = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return seg || p;
}

/**
 * 创建一个 workspace 注册表实例。
 * @param db 已有的 SQLite 连接（生产：应用启动时 initDatabase；测试：:memory:）
 */
export function createWorkspaceRegistry(db: DatabaseSync): WorkspaceRegistry {
  db.exec(TABLE_DDL);

  function rowToWorkspace(row: any): Workspace {
    const self: Workspace = {
      id: row.id,
      path: row.path,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      get sessionIds(): readonly string[] {
        const r = db.prepare('SELECT session_ids FROM workspaces WHERE id = ?').get(row.id) as any;
        return r ? JSON.parse(r.session_ids) : [];
      },
      async attachSession(sessionId: string): Promise<void> {
        // [022] 决策 9.6 第一道：幂等——已挂过则跳过校验、不重复写入
        const cur = db.prepare('SELECT session_ids FROM workspaces WHERE id = ?').get(self.id) as any;
        const ids: string[] = cur ? JSON.parse(cur.session_ids) : [];
        if (ids.includes(sessionId)) return;

        // 读 session 的 project_dir 作为 cwd
        const sess = db.prepare('SELECT project_dir FROM sessions WHERE logic_id = ?').get(sessionId) as SessionRow | undefined;
        if (!sess || !sess.project_dir) {
          throw new Error(
            'cannot attach session ' + sessionId + ' to workspace ' + self.path
            + ': its stored header carries no cwd to validate against'
          );
        }

        // [022] 决策 9.6 第二道：cwd 可解析（realpath）
        let cwd: string;
        try {
          cwd = await realpathNormalize(sess.project_dir);
        } catch (error) {
          throw new Error(
            'cannot attach session ' + sessionId + ' to workspace ' + self.path
            + ': its cwd ' + sess.project_dir + ' does not resolve, so it cannot be validated'
          );
        }

        // [022] 决策 9.6 第三道：cwd 是目录
        let isDir = false;
        try { isDir = (await fs.promises.stat(cwd)).isDirectory(); } catch (_) { /* ignore */ }
        if (!isDir) {
          throw new Error(
            'cannot attach session ' + sessionId + ' to workspace ' + self.path
            + ': its cwd ' + sess.project_dir + ' is not a directory'
          );
        }

        // [022] 决策 9.6 第四道：cwd 与 workspace.path 一致
        if (cwd !== self.path) {
          throw new Error(
            'cannot attach session ' + sessionId + ' to workspace ' + self.path
            + ': its cwd resolves to ' + cwd
          );
        }

        // 通过：前插 + 更新 updated_at
        const next = [sessionId, ...ids];
        const now = new Date().toISOString();
        db.prepare('UPDATE workspaces SET session_ids = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(next), now, self.id);
      },
    };
    return self;
  }

  return {
    async create(p: string, title?: string): Promise<Workspace> {
      if (!p || typeof p !== 'string') throw new Error('create: path required');
      const canonical = await realpathNormalize(p);

      const st = await fs.promises.stat(canonical);
      if (!st.isDirectory()) {
        throw new Error('cannot create a workspace at ' + canonical + ': path is not a directory');
      }

      // 幂等：同 path 已存在则直接返回
      const existing = db.prepare('SELECT * FROM workspaces WHERE path = ?').get(canonical) as any;
      if (existing) return rowToWorkspace(existing);

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const finalTitle = title && title.trim() ? title.trim() : titleFromPath(canonical);
      db.prepare(
        'INSERT INTO workspaces (id, path, title, session_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, canonical, finalTitle, '[]', now, now);

      return rowToWorkspace({
        id, path: canonical, title: finalTitle,
        session_ids: '[]', created_at: now, updated_at: now,
      });
    },

    get(id: string): Workspace | undefined {
      if (!id) return undefined;
      const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
      return row ? rowToWorkspace(row) : undefined;
    },

    list(): Workspace[] {
      const rows = db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as any[];
      return rows.map(rowToWorkspace);
    },

    resolveByPath(p: string): Workspace | undefined {
      if (!p) return undefined;
      const row = db.prepare('SELECT * FROM workspaces WHERE path = ?').get(p) as any;
      return row ? rowToWorkspace(row) : undefined;
    },
  };
}

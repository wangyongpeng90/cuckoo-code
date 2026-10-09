/**
 * DSH ctx.agents 的简化实现（C4-C）。
 *
 * DSH 的 AgentRegistry 管"活着的 agent"（get/list/roots）；
 * Cuckoo 没有 agent registry，但有"会话"——把会话映射成 agent 视图：
 *   agent = { id, session: { id, projectDir } }
 *
 * 依赖：host 注入的会话接口（不直接 import session/app）。
 */

/** 简化 Agent 视图（DSH Agent 的核心面：id + session） */
interface CuckooAgent {
  id: string;
  session: { id: string; projectDir: string | null };
}

/** 由宿主会话接口构造 ctx.agents */
function createAgents(host: any): any {
  function sessionToAgent(s: { id: string; title?: string; projectDir?: string | null }): CuckooAgent {
    return { id: s.id, session: { id: s.id, projectDir: (s.projectDir as string | null) ?? null } };
  }

  return {
    /** 按 id 取 agent（找不到返回 undefined） */
    get(id: string): CuckooAgent | undefined {
      if (!host || !host.getSession) return undefined;
      const s = host.getSession(id);
      return s ? sessionToAgent(s) : undefined;
    },
    /** 当前 agent（当前会话） */
    current(): CuckooAgent | null {
      if (!host || !host.getCurrentSession) return null;
      const s = host.getCurrentSession();
      return s && s.id ? sessionToAgent(s) : null;
    },
    /** 所有 agent（所有会话） */
    list(): CuckooAgent[] {
      if (!host || !host.listSessions) return [];
      return host.listSessions().map(sessionToAgent);
    },
    /** 顶层 agent（简化：等同 list） */
    roots(): CuckooAgent[] {
      return this.list();
    },
  };
}

export { createAgents };
export type { CuckooAgent };

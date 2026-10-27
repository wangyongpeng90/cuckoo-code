/**
 * DSH ctx.agents 的简化实现（C4-C）。
 *
 * DSH 的 AgentRegistry 管"活着的 agent"（get/list/roots + create）；
 * Cuckoo 没有 agent registry，但有"会话"——把会话映射成 agent 视图。
 *
 * 关键差异：
 * - DSH 的 create 是"内存组合作用域"，Cuckoo 的 create 是"登记一个 AgentSession"
 * - DSH 的 followup 进 inbox，Cuckoo 的 followup 负责"开对话 + 发消息 + 队列持久化"
 */
import fs from 'node:fs';
import pathMod from 'node:path';

/** 简化 Agent 视图（DSH Agent 的核心面） */
interface CuckooAgent {
  id: string;
  session: {
    id: string;
    projectDir: string | null;
    append: (type: string, data: any) => void;
  };
  followup: (msg: any) => void;
  whenIdle: () => Promise<void>;
}

interface CuckooAgentHandle {
  agent: CuckooAgent;
  dispose: () => Promise<void>;
}

interface AgentSessionState {
  id: string;              // logicId
  webId: string | null;    // 网页 id（URL 里的）
  projectDir: string | null;
  profileId: string | null;  // 窗口 profile.id（来自 agentOptions.model）
  providerId: string | null; // 平台（来自 agentOptions.provider）
  status: 'initializing' | 'idle' | 'busy' | 'disposed';
  systemPromptSent: boolean;
  queue: Array<{ text: string; source: any }>;
  _host: any;              // 必须在 create 时注入
}

/** 全局的活动会话（进程级） */
const activeSessions = new Map<string, AgentSessionState>();
/** 显式调用 whenIdle() 的等待者 */
const idleWaiters = new Map<string, Array<() => void>>();

/** 会话变成 idle 时，唤醒所有 whenIdle() 等待者 */
function notifyIdleWaiters(logicId: string): void {
  const waiters = idleWaiters.get(logicId);
  if (!waiters) return;
  idleWaiters.delete(logicId);
  for (const resolve of waiters) {
    try { resolve(); } catch (_) { /* ignore */ }
  }
}

function extractText(msg: any): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c: any) => (c && c.type === 'text' ? c.text : '')).join('');
  }
  return '';
}

/**
 * 消费队列（模块级，供 create / followup / onAssistantDone 共享）。
 * 只发一条，发送成功后结束，等 onAssistantDone 触发下一轮。
 */
async function processQueue(logicId: string, host: any): Promise<void> {
  const state = activeSessions.get(logicId);
  if (!state || state.status === 'disposed') return;
  if (state.status === 'busy' || state.status === 'initializing') return;
  if (state.queue.length === 0) return;

  const item = state.queue[0]; // 不立即出队
  state.status = 'busy';
  state._host = host;

  try {
    // 1) 如果首次（还没有 webId 且没发过系统提示词），先开新对话（导航）
    if (!state.webId && !state.systemPromptSent) {
      state.status = 'initializing';
      if (host && host.navigateWindowToHome) {
        const ok = await host.navigateWindowToHome(state.id, state.profileId, state.providerId);
        if (!ok) throw new Error('no window to navigate');
      }
    }

    // 2) 构造消息（首次合并系统提示词）
    let messageText = item.text;
    if (!state.systemPromptSent) {
      if (host && host.buildSystemPrompt) {
        const sysPrompt = host.buildSystemPrompt(state.projectDir || '', state.providerId || '');
        messageText = sysPrompt + '\n\n---\n\n' + item.text;
      }
      state.systemPromptSent = true;
    }

    // 3) 发送消息
    if (host && host.sendUserMessage) {
      const ok = host.sendUserMessage(state.id, state.profileId, messageText);
      if (!ok) throw new Error('send failed');
    }

    // 4) 发送成功，出队
    state.queue.shift();

    // 4.5) 如果此时拿到了 webId（比如页面刷新后），立刻绑定
    if (!state.webId && host && host.getCurrentSession) {
      const cur = host.getCurrentSession();
      if (cur && cur.id) {
        state.webId = cur.id;
        if (host.logicIdMap) host.logicIdMap.bind(state.id as any, cur.id as any);
      }
    }

    // 4.6) 持久化剩余队列
    if (host && host.setSessionQueue) {
      try { host.setSessionQueue(state.id, state.queue); } catch (_) { /* ignore */ }
    }

    // 5) 等 onAssistantDone 来触发下一轮
  } catch (err: any) {
    console.error('[Cuckoo AgentSession] processQueue 失败:', err.message);
    state.status = 'idle';
    // 发送失败，丢弃这条并尝试下一条
    state.queue.shift();

    // 【选 B】队列空了才唤醒
    if (state.queue.length === 0) {
      notifyIdleWaiters(logicId);
    }
    void processQueue(logicId, host);
  }
}

/** 入队并触发处理 */
function handleFollowup(logicId: string, text: string, source: any): void {
  const state = activeSessions.get(logicId);
  if (!state) throw new Error('session not found: ' + logicId);
  if (state.status === 'disposed') throw new Error('session disposed: ' + logicId);

  // 入队
  state.queue.push({ text, source });

  // 持久化队列
  if (state._host && state._host.setSessionQueue) {
    try { state._host.setSessionQueue(state.id, state.queue); } catch (_) { /* ignore */ }
  }

  // 触发处理
  if (state._host) {
    void processQueue(logicId, state._host);
  }
}

/**
 * AI 回复完成时调用（由 harness 层在 assistant-done 时触发）。
 * 把所有 busy 的会话标记为 idle，并消费队列。
 */
function onAssistantDone(): void {
  for (const [id, s] of activeSessions) {
    if (s.status === 'busy') {
      s.status = 'idle';

      const host = s._host;
      if (host) {
        // 本轮 AI 回复完成，广播 turn/end
        try { if (host.broadcastTurnEnd) host.broadcastTurnEnd(id, 'completed'); } catch (_) { /* ignore */ }
        // 继续消费队列
        void processQueue(id, host);
      }

      // 【选 B】只有整个队列空了，才唤醒 whenIdle 的等待者
      if (s.queue.length === 0) {
        notifyIdleWaiters(id);
      }
    }
  }
}

/** 由宿主会话接口构造 ctx.agents */
function createAgents(host: any): any {
  function sessionToAgent(s: { id: string; title?: string; projectDir?: string | null }): CuckooAgent {
    const state = activeSessions.get(s.id);
    if (state) {
      return {
        id: s.id,
        session: {
          id: s.id,
          projectDir: state.projectDir,
          append: (type: string, data: any) => {
            if (type === 'session/title' && data && data.title) {
              if (host && host.setSessionTitleForId) {
                host.setSessionTitleForId(state.id, data.title);
              }
            }
          },
        },
        followup: (msg: any) => {
          const text = extractText(msg);
          handleFollowup(s.id, text, msg && msg.source);
        },
        whenIdle: () => new Promise<void>((resolve) => {
          const st = activeSessions.get(s.id);
          if (!st || st.status === 'idle' || st.status === 'disposed') {
            resolve();
            return;
          }
          const list = idleWaiters.get(s.id) || [];
          list.push(resolve);
          idleWaiters.set(s.id, list);
        }),
      };
    }
    // 没有活动 session（历史会话），返回只读视图
    return {
      id: s.id,
      session: { id: s.id, projectDir: (s.projectDir as string | null) ?? null, append: () => {} },
      followup: () => { throw new Error('agent is not active (use create first)'); },
      whenIdle: async () => {},
    };
  }

  return {
    /** 按 id 取 agent */
    get(id: string): CuckooAgent | undefined {
      if (!host || !host.getSession) return undefined;
      const s = host.getSession(id);
      return s ? sessionToAgent(s) : undefined;
    },
    /** 当前 agent */
    current(): CuckooAgent | null {
      if (!host || !host.getCurrentSession) return null;
      const s = host.getCurrentSession();
      return s && s.id ? sessionToAgent(s) : null;
    },
    /** 所有 agent */
    list(): CuckooAgent[] {
      if (!host || !host.listSessions) return [];
      return host.listSessions().map(sessionToAgent);
    },
    /** 顶层 agent（简化：等同 list） */
    roots(): CuckooAgent[] {
      return this.list();
    },
    /** DSH 契约：创建 agent（只登记，不发消息） */
    async create(options: any): Promise<CuckooAgentHandle> {
      const logicId = options.sessionId;
      if (!logicId) throw new Error('create: sessionId required');
      if (activeSessions.has(logicId)) throw new Error('session already exists: ' + logicId);

      // [022] 决策 9.2：meta.cwd 严格校验（对齐 DSH prepare 的 cwd 规则）
      //   - 传了必须是字符串
      //   - 传了必须是绝对路径
      //   - 传了要做 realpath 规范化（与 workspace-registry 的 create(path) 一致，
      //     否则 attachSession 第 5 道校验 cwd === workspace.path 会失败）
      let projectDir: string | null = null;
      const rawCwd = options.meta && options.meta.cwd;
      if (rawCwd !== undefined && rawCwd !== null) {
        if (typeof rawCwd !== 'string') {
          throw new Error('meta.cwd must be a string, got ' + typeof rawCwd);
        }
        if (!pathMod.isAbsolute(rawCwd)) {
          throw new Error('meta.cwd must be an absolute path, got "' + rawCwd + '"');
        }
        try {
          projectDir = fs.realpathSync(rawCwd);
        } catch (e: any) {
          throw new Error('meta.cwd does not resolve: "' + rawCwd + '" (' + (e && e.message) + ')');
        }
      }

      const profileId = (options.agentOptions && options.agentOptions.model) || null;
      const providerId = (options.agentOptions && options.agentOptions.provider) || null;
      const state: AgentSessionState = {
        id: logicId,
        webId: null,
        projectDir,
        profileId,
        providerId,
        status: 'idle',
        systemPromptSent: false,
        queue: [],
        _host: host,
      };
      activeSessions.set(logicId, state);

      // 记目录（setup 成功后再落库，避免 setup 失败留下脏数据）
      const persistDirMapping = () => {
        if (projectDir && host && host.saveSessionDirMapping) {
          // [022] 传 state.profileId（来自 agentOptions.model），确保会话归属正确的窗口
          try { host.saveSessionDirMapping(logicId, projectDir, state.profileId); } catch { /* ignore */ }
        }
      };

      // [022] 决策 9.3：调 setup（若提供），失败则回滚 activeSessions
      //   agentCtx 最小实现：get 返回 undefined（agentPresets 由 C-light 处理）、
      //   plugin 返回空 disposer、effect 执行回调
      //   详见 docs/dsh-compat-decisions.md 9.3
      const handle: CuckooAgentHandle = {
        agent: sessionToAgent({ id: logicId, title: undefined, projectDir }),
        dispose: async () => {
          const s = activeSessions.get(logicId);
          if (s) s.status = 'disposed';
          activeSessions.delete(logicId);
        },
      };

      if (typeof options.setup === 'function') {
        const agentCtx = {
          get: (_name: string) => undefined,
          plugin: (_p: any) => () => { /* no-op */ },
          effect: (fn: any) => {
            try { fn(); } catch { /* ignore */ }
            return () => { /* no-op */ };
          },
        };
        try {
          await options.setup(agentCtx, handle.agent);
        } catch (e: any) {
          // 回滚：清 activeSessions，让同 id 可重新 create
          activeSessions.delete(logicId);
          throw e;
        }
      }

      persistDirMapping();
      return handle;
    },
  };
}

/** 供外部更新 webId（保留以兼容） */
function updateAgentWebId(logicId: string, webId: string): void {
  const s = activeSessions.get(logicId);
  if (s) s.webId = webId;
}

/**
 * 启动时恢复队列：
 * 遍历所有已落盘的 webId，如果有 pendingMessages，就恢复到 activeSessions 并继续消费。
 */
function restorePendingQueues(host: any): void {
  if (!host || !host.listSessions) return;
  const sessions = host.listSessions();
  for (const s of sessions) {
    const webId = s.id;
    if (!webId) continue;
    // 跳过没有 pendingMessages 的
    let queue: any[] = [];
    try {
      if (host.getSessionQueue) queue = host.getSessionQueue(webId);
    } catch (_) { continue; }
    if (!Array.isArray(queue) || queue.length === 0) continue;

    // 看是否已经有活跃会话（避免重复恢复）
    let logicId = webId;
    if (host.logicIdMap && host.logicIdMap.logicIdOf) {
      const lid = host.logicIdMap.logicIdOf(webId);
      if (lid) logicId = lid;
    }

    if (activeSessions.has(logicId)) {
      // 已有活跃，合并队列
      const existing = activeSessions.get(logicId)!;
      existing.queue.push(...queue);
    } else {
      // 新建状态
      const state: AgentSessionState = {
        id: logicId,
        webId,
        projectDir: s.projectDir || null,
        profileId: null,
        providerId: null,
        status: 'idle',
        systemPromptSent: true, // 能落盘说明已经发过系统提示词
        queue: [...queue],
        _host: host,
      };
      activeSessions.set(logicId, state);
    }

    // 清空已恢复的 pendingMessages
    try { host.setSessionQueue(logicId, []); } catch (_) { /* ignore */ }

    // 触发消费
    void processQueue(logicId, host);
  }
}

export { createAgents, updateAgentWebId, onAssistantDone, restorePendingQueues };
export type { CuckooAgent };

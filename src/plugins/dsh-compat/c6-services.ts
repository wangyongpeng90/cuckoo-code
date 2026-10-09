/**
 * DSH 插件 ctx 服务扩展（C6）：skills/commands/goals/compaction/workspaceFiles/sessionTitle/tokenMeter。
 *
 * 都由宿主能力（host）注入，plugins 层不直接依赖 app/session。
 */

/** 由宿主提供的能力（扩展 CuckooHost） */
interface C6Host {
  listSkills?: () => Array<{ name: string; description?: string; source?: string }>;
  listCommands?: () => Array<{ id: string; title: string }>;
  registerCommand?: (cmd: { id: string; title: string; run: () => any }) => () => void;
  getGoal?: () => { active: boolean; text?: string } | null;
  triggerCompaction?: () => Promise<boolean>;
  listWorkspaceFiles?: () => Array<{ path: string; type: string }>;
  getSessionTitle?: () => string | null;
  setSessionTitle?: (title: string) => boolean;
  getTokens?: () => { context: number; cumulative: number; today: number; windowCumulative: number; total: number };
}

/** 构造 C6 服务（挂到插件 ctx 上） */
function createC6Services(host: C6Host | undefined): {
  skills: any; commands: any; goals: any; compaction: any;
  workspaceFiles: any; sessionTitle: any; tokenMeter: any;
} {
  const h = host || {};
  return {
    // 技能：列清单
    skills: {
      list() { return h.listSkills ? h.listSkills() : []; },
    },
    // 命令：注册 / 列
    commands: {
      register(cmd: any) { return h.registerCommand ? h.registerCommand(cmd) : (() => {}); },
      list() { return h.listCommands ? h.listCommands() : []; },
    },
    // 目标模式：当前状态
    goals: {
      current() { return h.getGoal ? h.getGoal() : null; },
    },
    // 压缩：触发
    compaction: {
      async trigger() { return h.triggerCompaction ? h.triggerCompaction() : false; },
    },
    // 工作区文件：列
    workspaceFiles: {
      list() { return h.listWorkspaceFiles ? h.listWorkspaceFiles() : []; },
    },
    // 会话标题：读 / 设
    sessionTitle: {
      get() { return h.getSessionTitle ? h.getSessionTitle() : null; },
      set(title: string) { return h.setSessionTitle ? h.setSessionTitle(String(title)) : false; },
    },
    // token 统计
    tokenMeter: {
      total() { return h.getTokens ? h.getTokens().total : 0; },
      context() { return h.getTokens ? h.getTokens().context : 0; },
      cumulative() { return h.getTokens ? h.getTokens().cumulative : 0; },
      today() { return h.getTokens ? h.getTokens().today : 0; },
      windowCumulative() { return h.getTokens ? h.getTokens().windowCumulative : 0; },
    },
  };
}

export { createC6Services };
export type { C6Host };

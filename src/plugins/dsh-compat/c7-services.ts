/**
 * DSH 插件 ctx 服务扩展（C7）：subagents / shell / sessionQuery。
 *
 * 均由宿主（host）注入，plugins 层不直接依赖 app/tools。
 */

interface C7Host {
  /** 列可用子代理 */
  listSubagents?: () => Array<{ name: string; description?: string }>;
  /** 执行子代理（返回最终文本） */
  runSubagent?: (name: string, task: string) => Promise<string>;
  /** 执行命令（shell） */
  runCommand?: (command: string, opts?: { cwd?: string; timeoutMs?: number }) => Promise<{ stdout: string; stderr?: string; exitCode: number }>;
  /** 查询会话 */
  querySession?: (sessionId: string) => { id: string; title?: string; projectDir?: string | null } | null;
}

/** 构造 C7 服务 */
function createC7Services(host: C7Host | undefined): { subagents: any; shell: any; sessionQuery: any } {
  const h = host || {};
  return {
    // 子代理管理
    subagents: {
      list() { return h.listSubagents ? h.listSubagents() : []; },
      async run(name: string, task: string) {
        if (!h.runSubagent) throw new Error('subagents.run: 宿主未注入 runSubagent');
        return h.runSubagent(String(name), String(task));
      },
    },
    // shell：执行命令
    shell: {
      async exec(command: string, opts?: any) {
        if (!h.runCommand) return { stdout: '', stderr: '宿主未注入 runCommand', exitCode: 1 };
        return h.runCommand(String(command), opts);
      },
    },
    // 会话查询
    sessionQuery: {
      get(id: string) { return h.querySession ? h.querySession(String(id)) : null; },
    },
  };
}

export { createC7Services };
export type { C7Host };

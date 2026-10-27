/**
 * DSH 插件 ctx 服务扩展（C8）：mcpResources / web / browserUse / attachments / terminals / computerUse / ssh / lsp。
 *
 * 均由宿主（host）注入；无对应能力的返回空操作（不崩）。
 */

interface C8Host {
  /** 调 MCP 工具 */
  mcpCall?: (server: string, tool: string, args?: any) => Promise<any>;
  /** 列 MCP server */
  mcpListServers?: () => Promise<any>;
  /** 列某 MCP server 的工具 */
  mcpGetTools?: (server: string) => Promise<any>;
  /** web 抓取 */
  webFetch?: (url: string) => Promise<string>;
  /** 打开浏览器窗口 → windowId */
  openBrowserWindow?: (url: string, opts?: any) => Promise<any>;
  /** 注入 JS */
  injectJS?: (windowId: string, code: string) => Promise<any>;
  /** 上传附件 */
  attachFile?: (filePath: string) => Promise<any>;
  /** 执行终端命令 */
  runTerminal?: (command: string, opts?: any) => Promise<{ stdout: string; exitCode: number }>;
}

function createC8Services(host: C8Host | undefined): {
  mcpResources: any; web: any; browserUse: any; attachments: any;
  terminals: any; computerUse: any; ssh: any; lsp: any;
} {
  const h = host || {};
  return {
    // MCP 资源
    mcpResources: {
      async call(server: string, tool: string, args?: any) { return h.mcpCall ? h.mcpCall(server, tool, args) : ''; },
      async listServers() { return h.mcpListServers ? h.mcpListServers() : ''; },
      async listTools(server: string) { return h.mcpGetTools ? h.mcpGetTools(server) : ''; },
    },
    // 网络
    web: {
      async fetch(url: string) { return h.webFetch ? h.webFetch(String(url)) : ''; },
    },
    // 浏览器
    browserUse: {
      async open(url: string, opts?: any) { return h.openBrowserWindow ? h.openBrowserWindow(String(url), opts) : null; },
      async inject(windowId: string, code: string) { return h.injectJS ? h.injectJS(String(windowId), String(code)) : null; },
    },
    // 附件
    attachments: {
      async attach(filePath: string) { return h.attachFile ? h.attachFile(String(filePath)) : null; },
    },
    // 终端
    terminals: {
      async exec(command: string, opts?: any) {
        if (!h.runTerminal) return { stdout: '', exitCode: 1 };
        return h.runTerminal(String(command), opts);
      },
    },
    // 无对应能力（返回空，不崩）
    computerUse: {},
    ssh: {},
    lsp: {},
  };
}

export { createC8Services };
export type { C8Host };

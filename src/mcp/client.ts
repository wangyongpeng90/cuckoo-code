/**
 * MCP Client 管理（连接池 + 引用计数，支持项目级/用户级隔离）
 *
 * 连接 key：
 *  - 用户级 server：`user::<name>`（全局唯一，跨项目共享）
 *  - 项目级 server：`project:<projectDir>::<name>`（每项目一份）
 *
 * 引用计数：每个连接记"哪些窗口在用"（Set<windowId>）。
 *  - 窗口关闭 / 切换项目 → 释放引用
 *  - 引用归零 → 启动空闲计时器（60 秒）；期间有人用则取消；超时无人用才断开
 *
 * 进程释放：
 *  - 正常退出 → disconnectAll()（由 entry.ts 的 before-quit 调用）
 *  - 强杀主进程 → 无法执行清理，依赖 stdin EOF（规范 server 自己退出）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as mcpConfig from './config.js';
import { resolveRuntimeBinDir } from '../infra/paths.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const require = createRequire(import.meta.url);
const { app } = require('electron');

// 空闲断开时长（毫秒）
const IDLE_DISCONNECT_MS = 60 * 1000;

/**
 * 连接池条目：
 * {
 *   key, client, transport, tools, connected,
 *   refs: Set<windowId>,   // 谁在用
 *   idleTimer: NodeJS.Timeout | null
 * }
 */
const connections = new Map<string, any>();
// 连接进行中的缓存：key -> Promise<entry>（避免并发重复连接）
const connecting = new Map<string, Promise<any>>();

// ========== 默认工作目录（同以前）==========
let defaultCwdCache: string | undefined;
let defaultCwdResolved = false;

function getDefaultMcpCwd(): string | undefined {
  if (defaultCwdResolved) return defaultCwdCache;
  defaultCwdResolved = true;

  const candidates: string[] = [];
  if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'mcp-cwd'));
  }
  if (app.isPackaged) {
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      candidates.push(path.join(exeDir, 'mcp-cwd'));
    } catch (_) {}
  }
  try {
    candidates.push(path.join(app.getPath('userData'), 'mcp-cwd'));
  } catch (_) {}

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      defaultCwdCache = dir;
      console.log('[MCP] 默认工作目录:', dir);
      return dir;
    } catch (_) {
      console.warn('[MCP] 工作目录不可写，尝试下一个:', dir);
    }
  }
  console.warn('[MCP] 未找到可写的默认工作目录，子进程将继承父进程 cwd');
  return undefined;
}

// ========== key 计算 ==========

function connKey(server: any): string {
  return server.source === 'project'
    ? 'project:' + (server.projectDir || '') + '::' + server.name
    : 'user::' + server.name;
}

// ========== 连接管理 ==========

async function connectServer(server: any, windowId: number | null): Promise<any> {
  const key = connKey(server);

  // 已有连接 → 复用，并加入引用
  const existing = connections.get(key);
  if (existing) {
    if (windowId !== null) {
      existing.refs.add(windowId);
      cancelIdleTimer(existing);
    }
    return existing;
  }

  // 连接进行中 → 复用 Promise
  if (connecting.has(key)) {
    const p = connecting.get(key);
    const entry = await p;
    if (windowId !== null && entry) {
      entry.refs.add(windowId);
      cancelIdleTimer(entry);
    }
    return entry;
  }

  const p = doConnectServer(server, key);
  connecting.set(key, p);
  try {
    const entry = await p;
    if (windowId !== null) entry.refs.add(windowId);
    return entry;
  } finally {
    connecting.delete(key);
  }
}

// ========== 自带运行时解析 ==========
// 我们打包了 uv/node（resources/runtime/<platform>/bin/）。spawn MCP 时：
//  - command 是 uvx/uv/npx/node/npm → 解析成自带绝对路径（优先自带，尊重"版本可控"）
//  - 并把自带 bin 目录加进子进程 PATH（npx.cmd 内部还要找 node）

const RUNTIME_COMMANDS = new Set(['uvx', 'uv', 'uvw', 'npx', 'node', 'npm']);

/** 命令名 → 自带可执行文件（带平台后缀） */
function bundledBinName(cmd: string): string {
  const isWin = process.platform === 'win32';
  if (cmd === 'uvx') return isWin ? 'uvx.exe' : 'uvx';
  if (cmd === 'uv') return isWin ? 'uv.exe' : 'uv';
  if (cmd === 'uvw') return isWin ? 'uvw.exe' : 'uvw';
  if (cmd === 'node') return isWin ? 'node.exe' : 'node';
  if (cmd === 'npx') return isWin ? 'npx.cmd' : 'npx';
  if (cmd === 'npm') return isWin ? 'npm.cmd' : 'npm';
  return cmd;
}

/**
 * 解析 spawn 的 command：
 *  - 若命令是 uvx/npx 等且自带运行时存在 → 返回自带绝对路径
 *  - 否则原样返回（交给系统 PATH）
 */
function resolveCommand(command: string): { command: string; bundled: boolean } {
  if (!RUNTIME_COMMANDS.has(command)) return { command, bundled: false };
  const binDir = resolveRuntimeBinDir();
  if (!binDir) return { command, bundled: false };
  const full = path.join(binDir, bundledBinName(command));
  if (fs.existsSync(full)) return { command: full, bundled: true };
  return { command, bundled: false };
}

/** 构造 MCP 子进程的 env：自带 bin 目录加到 PATH 最前（仅此进程，不碰系统） */
function buildSpawnEnv(userEnv: any): any {
  const base = Object.assign({}, process.env, userEnv || {});
  const binDir = resolveRuntimeBinDir();
  if (binDir) {
    const sep = process.platform === 'win32' ? ';' : ':';
    base.PATH = binDir + sep + (base.PATH || base.Path || '');
    // Windows 上大小写敏感：确保 Path 也在
    if (process.platform === 'win32') base.Path = base.PATH;
  }
  return base;
}

async function doConnectServer(server: any, key: string): Promise<any> {
  let transport: any;
  if (server.type === 'stdio') {
    const resolved = resolveCommand(server.command);
    if (resolved.bundled) {
      console.log('[MCP] 使用自带运行时: ' + server.command + ' → ' + resolved.command);
    } else if (RUNTIME_COMMANDS.has(server.command)) {
      console.warn('[MCP] 未找到自带运行时，回退系统 PATH: ' + server.command);
    }
    transport = new StdioClientTransport({
      command: resolved.command,
      args: server.args || [],
      env: buildSpawnEnv(server.env),
      cwd: server.cwd || getDefaultMcpCwd(),
      stderr: 'pipe',
    });
  } else if (server.type === 'http') {
    transport = new StreamableHTTPClientTransport(server.url, {
      requestInit: server.headers ? { headers: server.headers } : undefined,
    });
  } else {
    throw new Error('未知 MCP server 类型: ' + server.type);
  }

  const client = new Client({ name: 'cuckoo-code', version: '0.2.4' });
  await client.connect(transport);

  let tools: any[] = [];
  try {
    const result = await client.listTools({});
    tools = result.tools || [];
  } catch (err: any) {
    console.error('[MCP] 获取工具列表失败:', server.name, err.message);
  }

  const entry = { key, client, transport, tools, connected: true, refs: new Set<number>(), idleTimer: null };
  connections.set(key, entry);
  console.log('[MCP] 已连接:', key, '工具数=', tools.length);
  return entry;
}

function cancelIdleTimer(entry: any): void {
  if (entry && entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function scheduleIdleDisconnect(entry: any): void {
  cancelIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    if (entry.refs.size === 0) {
      disconnectByKey(entry.key).catch(() => {});
    }
  }, IDLE_DISCONNECT_MS);
  // 定时器不阻止进程退出
  if (entry.idleTimer && typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref();
}

async function disconnectByKey(key: string): Promise<void> {
  // 等正在进行的连接结束，避免断开后又被它重新登记
  if (connecting.has(key)) {
    try { await connecting.get(key); } catch (_) {}
  }
  const entry = connections.get(key);
  if (!entry) return;
  cancelIdleTimer(entry);
  try {
    await entry.client.close();
  } catch (_) {}
  connections.delete(key);
  console.log('[MCP] 已断开:', key);
}

/**
 * 释放某个窗口的全部引用（窗口关闭 / 退出时调用）。
 * 引用归零的连接 → 启动空闲计时。
 */
function releaseWindow(windowId: number): void {
  for (const entry of connections.values()) {
    if (entry.refs.has(windowId)) {
      entry.refs.delete(windowId);
      if (entry.refs.size === 0) scheduleIdleDisconnect(entry);
    }
  }
}

/**
 * 窗口切换项目目录：释放该窗口对"旧项目"连接的引用。
 * 旧项目 = 与 newProjectDir 不同的所有 project:* 连接。
 */
function releaseProject(windowId: number, newProjectDir: string | null): void {
  for (const entry of connections.values()) {
    if (!entry.key.startsWith('project:')) continue;
    // key 形如 project:<dir>::<name>，取出 dir
    const rest = entry.key.slice('project:'.length);
    const sep = rest.indexOf('::');
    const dir = sep >= 0 ? rest.slice(0, sep) : rest;
    if (dir !== (newProjectDir || '') && entry.refs.has(windowId)) {
      entry.refs.delete(windowId);
      if (entry.refs.size === 0) scheduleIdleDisconnect(entry);
    }
  }
}

/** 退出时强制断开全部 */
async function disconnectAll(): Promise<void> {
  const keys = Array.from(connections.keys());
  for (const key of keys) {
    await disconnectByKey(key);
  }
}

// ========== 对外 API（都带 projectDir）==========

/** 从配置里找 server 定义（项目级优先），带 source/projectDir */
function resolveServer(name: string, projectDir: string | null): any | null {
  const list = mcpConfig.getServers(projectDir);
  return list.find((s: any) => s.name === name) || null;
}

/** 连接指定 server，并登记窗口引用 */
async function connectServerByName(name: string, projectDir: string | null, windowId: number | null = null): Promise<any> {
  const server = resolveServer(name, projectDir);
  if (!server) throw new Error('MCP server 不存在或未启用: ' + name);
  if (!server.enabled) throw new Error('MCP server 已禁用: ' + name);
  server.projectDir = projectDir; // 供 connKey 用
  return connectServer(server, windowId);
}

/** 连接所有已启用 server（按需；连接后不登记引用——由调用方按需 acquire） */
async function connectEnabledServers(projectDir: string | null = null): Promise<string[]> {
  const servers = mcpConfig.getEnabledServers(projectDir);
  for (const server of servers) {
    server.projectDir = projectDir;
    try {
      await connectServer(server, null);
    } catch (err: any) {
      console.error('[MCP] 连接失败:', server.name, err.message);
    }
  }
  return Array.from(connections.keys());
}

/** 每个窗口"上次自动连的项目目录"，避免同一项目重复触发 */
const lastProjectByWindow = new Map<number, string | null>();

/**
 * 窗口的项目目录确定后，异步自动连接该项目下所有已启用 server，并登记窗口引用。
 * 同一窗口同一项目只触发一次。连接失败不影响其它。
 */
function autoConnectForWindow(windowId: number, projectDir: string | null): void {
  const prev = lastProjectByWindow.get(windowId);
  if (prev === projectDir) return; // 同一项目，已处理
  lastProjectByWindow.set(windowId, projectDir);
  // 项目变了：先释放旧项目引用
  if (prev !== undefined) releaseProject(windowId, projectDir);
  // 异步连（不阻塞调用方）
  const servers = mcpConfig.getEnabledServers(projectDir);
  for (const server of servers) {
    server.projectDir = projectDir;
    connectServer(server, windowId).catch((err: any) => {
      console.error('[MCP] 自动连接失败:', server.name, err.message);
    });
  }
}

/** 窗口关闭时清理其"上次项目"记录 */
function forgetWindow(windowId: number): void {
  lastProjectByWindow.delete(windowId);
  releaseWindow(windowId);
}

/** 调用工具（自动确保连接） */
async function callMcpTool(serverName: string, toolName: string, args: any, projectDir: string | null = null, windowId: number | null = null): Promise<any> {
  const entry = await connectServerByName(serverName, projectDir, windowId);
  const result = await entry.client.callTool({ name: toolName, arguments: args });
  return result;
}

/** 列出已配置 server（含启用/连接状态） */
function listConfiguredServers(projectDir: string | null): any[] {
  const servers = mcpConfig.getServers(projectDir);
  return servers.map((s: any) => {
    // 与连接侧共用 connKey：此前这里内联了一份同样的判断，
    // 新增 plugin 来源后两处极易分叉（分叉 = "已连接"永远显示为假）
    s.projectDir = projectDir;
    const entry = connections.get(connKey(s));
    return {
      name: s.name,
      source: s.source,
      type: s.type,
      enabled: s.enabled,
      connected: !!(entry && entry.connected),
      toolCount: entry ? entry.tools.length : 0,
    };
  });
}

/** 某 server 的工具列表（按需连接） */
async function getToolsByServer(name: string, projectDir: string | null, windowId: number | null = null): Promise<any[]> {
  const entry = await connectServerByName(name, projectDir, windowId);
  return entry.tools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || {},
  }));
}

export {
  connectServer,
  connectServerByName,
  connectEnabledServers,
  autoConnectForWindow,
  forgetWindow,
  disconnectAll,
  releaseWindow,
  releaseProject,
  callMcpTool,
  listConfiguredServers,
  getToolsByServer,
  getDefaultMcpCwd,
  IDLE_DISCONNECT_MS,
};

/**
 * [261127-w3pd8n-cuko-default-workspace] Cuko 默认工作区
 *
 * 会话没绑定工作区时使用：保证第一条消息带系统提示词，工具的相对路径也有根目录。
 * 候选顺序与 MCP 默认工作目录（src/mcp/client.ts getDefaultMcpCwd）一致：
 *   便携版目录 → 安装目录（exe 所在目录，仅打包版）→ userData
 * macOS 打包版跳过安装目录：exe 在 .app/Contents/MacOS 里，往里写会破坏签名。
 * 逐个创建并做写入探测，第一个可写的胜出。开发版（npm start）没有安装目录，直接用 userData。
 * 详细设计见 docs/requirements/261127-w3pd8n-cuko-default-workspace.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const DEFAULT_WORKSPACE_DIRNAME = 'cuko-default-workspace';
export const DEFAULT_WORKSPACE_NAME = '默认工作区';

export interface DefaultWorkspaceEnv {
  isPackaged: boolean;
  /** 可执行文件路径（app.getPath('exe')） */
  exePath?: string | null;
  /** 便携版所在目录（PORTABLE_EXECUTABLE_DIR） */
  portableDir?: string | null;
  userData?: string | null;
  /** process.platform；macOS 上不用安装目录 */
  platform?: string | null;
}

/** 候选目录（按优先级，去重） */
export function defaultWorkspaceCandidates(env: DefaultWorkspaceEnv): string[] {
  const out: string[] = [];
  const add = (base: string | null | undefined) => {
    if (!base) return;
    const dir = path.join(base, DEFAULT_WORKSPACE_DIRNAME);
    if (!out.includes(dir)) out.push(dir);
  };
  // [261127-w3pd8n] macOS：安装目录在 .app 包内，写入会破坏签名，直接用 userData
  if (env && env.isPackaged && env.platform !== 'darwin') {
    add(env.portableDir);
    if (env.exePath) add(path.dirname(env.exePath));
  }
  add(env && env.userData);
  return out;
}

/** 第一个能创建且能写入的目录；都不行返回 null */
export function pickWritableDir(candidates: string[]): string | null {
  for (const dir of Array.isArray(candidates) ? candidates : []) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test-' + process.pid);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      console.warn('[Cuko] 默认工作区不可写，尝试下一个:', dir);
    }
  }
  return null;
}

function currentEnv(): DefaultWorkspaceEnv {
  try {
    const { app } = require('electron');
    const get = (name: string): string | null => {
      try { return app.getPath(name); } catch { return null; }
    };
    return {
      isPackaged: !!app.isPackaged,
      exePath: get('exe'),
      portableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
      userData: get('userData'),
      platform: process.platform,
    };
  } catch {
    return { isPackaged: false };
  }
}

let cached: string | null = null;

/** 默认工作区的完整路径（会确保目录存在）；找不到可写目录返回 null */
export function resolveDefaultWorkspace(): string | null {
  if (cached) {
    try {
      fs.mkdirSync(cached, { recursive: true });
      return cached;
    } catch {
      cached = null;
    }
  }
  const dir = pickWritableDir(defaultWorkspaceCandidates(currentEnv()));
  if (dir) {
    cached = dir;
    console.log('[Cuko] 默认工作区:', dir);
  } else {
    console.warn('[Cuko] 找不到可写的默认工作区');
  }
  return dir;
}

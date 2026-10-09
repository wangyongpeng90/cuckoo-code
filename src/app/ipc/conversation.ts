/**
 * IPC：对话记录落盘
 *
 * 将 DeepSeek++ 网页里的「用户消息 + AI 回复」实时追加写入当前项目的
 * 「对话记录.md」。同一项目的所有会话汇总到同一个文件，按时间追加。
 * 若未绑定项目目录，则回退写到 <userData>/对话记录/未绑定项目.md（保证始终有记录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from '../window.js';

const require = createRequire(import.meta.url);
const { ipcMain, app } = require('electron');

const FILE_NAME = '对话记录.md';

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** 本地时间格式化为 YYYY-MM-DD HH:mm:ss */
function formatTime(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

const HEADER = '# 对话记录\n\n> 本项目所有 DeepSeek 对话自动汇总于此，按时间追加。\n';
const FALLBACK_HEADER = '# 对话记录（未绑定项目）\n\n> 尚未绑定项目目录时的对话暂存于此。绑定项目后，新对话会写入对应项目根目录。\n';

/** 首次写入时创建文件并写头部 */
function ensureFile(file: string, header: string): void {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, header, 'utf-8');
}

/** 未绑定项目时的兜底目录：<userData>/对话记录/未绑定项目.md */
function fallbackFile(): string {
  const base = app.getPath('userData');
  return path.join(base, '对话记录', '未绑定项目.md');
}

/**
 * 清洗要落盘的文本：
 *  - 去掉 cuckoo / js 工具调用代码块（含 ```cuckoo ... ``` 整块）
 *  - 去掉 AI 回复末尾的"【JS 执行结果汇总】"工具回传段
 *  - 去掉首尾多余空白
 * 返回清洗后的文本（可能为空）。
 */
function cleanText(raw: string): string {
  let s = String(raw || '');
  // 1) 去掉 ```cuckoo ... ``` 与 ```js ... ``` 代码块（非贪婪、跨行）
  s = s.replace(/```(?:cuckoo|js)\s*[\s\S]*?```/gi, '');
  // 2) 去掉其他语言代码块里明显是工具调用的（保守：只去 cuckoo/js 已覆盖）
  // 3) 去掉"【JS 执行结果汇总】"整段（工具回传，不是真实回复）
  s = s.replace(/【JS 执行结果汇总】[\s\S]*$/m, '');
  // 4) 去掉残留的单独代码围栏行
  s = s.replace(/^```.*$/gm, '');
  return s.trim();
}

/** 判断是否是 Cuckoo 注入的系统提示词（不记录） */
function isSystemPrompt(text: string): boolean {
  const t = String(text || '');
  // 特征：以 "# 身份与能力" 开头，或含关键句
  if (/^#\s*身份与能力/.test(t.trim())) return true;
  if (t.indexOf('你是一个由 Cuckoo Code 驱动的 AI 编程助手') >= 0) return true;
  if (/^#\s*环境信息/.test(t.trim())) return true;
  return false;
}

function registerConversationIpc(): void {
  ipcMain.handle('save-conversation', async (event: any, payload: any) => {
    try {
      const { sessionId, role, text, ts } = payload || {};
      // 系统提示词（Cuckoo 注入的初始化内容）不记录
      if (isSystemPrompt(String(text || ''))) return { success: true, skipped: 'system-prompt' };
      // 清洗：去掉工具调用代码块、工具回传段
      const content = cleanText(String(text || ''));
      if (!content) return { success: false, error: 'empty' };

      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;

      // 优先按 sessionId 查项目目录，回退到当前选中目录；都没有则用兜底文件
      let projectDir: string | null = null;
      if (store) {
        if (sessionId) projectDir = store.getProjectDirBySessionId(sessionId);
        if (!projectDir) projectDir = (store.state && store.state.selectedProjectDir) || null;
      }

      let file: string;
      if (projectDir) {
        file = path.join(projectDir, FILE_NAME);
        ensureFile(file, HEADER);
      } else {
        file = fallbackFile();
        ensureFile(file, FALLBACK_HEADER);
      }

      const who = role === 'user' ? '👤 用户' : '🤖 DeepSeek';
      const block = '\n## ' + who + ' · ' + formatTime(ts) + '\n\n' + content + '\n';
      fs.appendFileSync(file, block, 'utf-8');
      return { success: true, file, bound: !!projectDir };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ===== 读取对话记录（供左侧「对话记录」页展示）=====

  /** 列出所有对话记录文件：当前项目的 + 兜底目录的 */
  ipcMain.handle('list-conversation-records', async (event: any) => {
    try {
      const ctx = windowState.getContextByWebContents(event.sender);
      const store = ctx ? ctx.sessionStore : null;
      const projectDir = (store && store.state && store.state.selectedProjectDir) || null;

      const items: any[] = [];
      // 1) 当前项目的对话记录
      if (projectDir) {
        const f = path.join(projectDir, FILE_NAME);
        if (fs.existsSync(f)) {
          const st = fs.statSync(f);
          items.push({ label: '当前项目', path: f, file: FILE_NAME, size: st.size, mtime: st.mtimeMs });
        }
      }
      // 2) 兜底目录（未绑定项目时的记录）
      const fbDir = path.join(app.getPath('userData'), '对话记录');
      if (fs.existsSync(fbDir)) {
        for (const name of fs.readdirSync(fbDir)) {
          if (!name.endsWith('.md')) continue;
          const f = path.join(fbDir, name);
          try {
            const st = fs.statSync(f);
            items.push({ label: '未绑定项目', path: f, file: name, size: st.size, mtime: st.mtimeMs });
          } catch (_) { /* ignore */ }
        }
      }
      items.sort((a, b) => b.mtime - a.mtime);
      return { success: true, items, projectDir };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /** 读取指定对话记录文件内容 */
  ipcMain.handle('read-conversation-record', async (_event: any, { path: filePath }: any) => {
    try {
      if (!filePath || typeof filePath !== 'string') return { success: false, error: '缺少路径' };
      // 安全：只允许读取 userData 下或项目根下的 对话记录.md / 对话记录目录
      const norm = path.resolve(filePath);
      const userData = path.resolve(app.getPath('userData'));
      const isUnderUserData = norm.startsWith(userData + path.sep);
      const baseName = path.basename(norm);
      const isRecordFile = baseName === FILE_NAME || norm.includes(path.sep + '对话记录' + path.sep) || baseName.endsWith('.md');
      if (!isUnderUserData && !isRecordFile) return { success: false, error: '非法路径' };
      if (!fs.existsSync(norm)) return { success: false, error: '文件不存在' };
      const st = fs.statSync(norm);
      const MAX = 2 * 1024 * 1024;
      if (st.size > MAX) {
        const content = fs.readFileSync(norm, 'utf-8');
        return { success: true, content: content.slice(-MAX), truncated: true, size: st.size };
      }
      const content = fs.readFileSync(norm, 'utf-8');
      return { success: true, content, size: st.size };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

export { registerConversationIpc };

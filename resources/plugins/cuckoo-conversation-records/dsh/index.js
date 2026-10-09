/**
 * 对话记录插件（DSH 风格）
 *
 * 从 Cuckoo 核心移出，独立可装卸：
 *  - 监听 session/event（用户消息 + AI 回复）→ 清洗 → 追加写 <项目根>/对话记录.md
 *  - 未绑定项目 → 回退 <userData>/对话记录/未绑定项目.md
 *  - 「对话记录」页由 UI 扩展提供
 *
 * 数据文件：<项目根>/对话记录.md
 */

export const name = 'cuckoo-conversation-records';

const FILE_NAME = '对话记录.md';
const HEADER = '# 对话记录\n\n> 本项目所有 DeepSeek 对话自动汇总于此，按时间追加。\n';
const FALLBACK_HEADER = '# 对话记录（未绑定项目）\n\n> 尚未绑定项目目录时的对话暂存于此。绑定项目后，新对话会写入对应项目根目录。\n';

function pad(n) { return n < 10 ? '0' + n : String(n); }
function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function join(dir, name) {
  const sep = dir.indexOf('\\') >= 0 ? '\\' : '/';
  return dir + sep + name;
}

/** 清洗落盘文本：去工具代码块 + 工具回传段 */
function cleanText(raw) {
  let s = String(raw || '');
  s = s.replace(/```(?:cuckoo|js)\s*[\s\S]*?```/gi, '');
  s = s.replace(/【JS 执行结果汇总】[\s\S]*$/m, '');
  s = s.replace(/^```.*$/gm, '');
  return s.trim();
}

/** 系统提示词不记录 */
function isSystemPrompt(text) {
  const t = String(text || '');
  if (/^#\s*身份与能力/.test(t.trim())) return true;
  if (t.indexOf('你是一个由 Cuckoo Code 驱动的 AI 编程助手') >= 0) return true;
  if (/^#\s*环境信息/.test(t.trim())) return true;
  return false;
}

export function apply(ctx) {
  ctx.log('对话记录插件已加载');

  const write = async (role, text, ts) => {
    try {
      if (!text) return;
      if (isSystemPrompt(text)) return;
      const content = cleanText(text);
      if (!content) return;
      const session = ctx.sessions.current();
      const projectDir = await ctx.sessions.projectDir(session.id || '');
      let file;
      if (projectDir) {
        file = join(projectDir, FILE_NAME);
        if (!(await ctx.fs.exists(file))) await ctx.fs.write(file, HEADER);
      } else {
        const ud = await ctx.fs.userDataDir();
        if (!ud) return;
        const dir = join(ud, '对话记录');
        file = join(dir, '未绑定项目.md');
        if (!(await ctx.fs.exists(file))) await ctx.fs.write(file, FALLBACK_HEADER);
      }
      const who = role === 'user' ? '👤 用户' : '🤖 DeepSeek';
      const block = '\n## ' + who + ' · ' + formatTime(ts) + '\n\n' + content + '\n';
      await ctx.fs.append(file, block);
    } catch (err) {
      ctx.log('写对话记录失败: ' + (err && err.message ? err.message : err));
    }
  };

  // 用户消息事件（由 hook 派发的 cuckoo-user-message 桥接）
  ctx.on('session/event', (ev) => {
    try {
      if (!ev) return;
      if (ev.type === 'user/message') write('user', ev.text, ev.ts);
      else if (ev.type === 'assistant/message') write('assistant', ev.text, ev.ts);
    } catch (_) { /* ignore */ }
  });

  ctx.log('已订阅 session/event');
}

/**
 * 长期记忆插件（DSH 风格）
 *
 * 从 Cuckoo 核心移出，独立可装卸：
 *  - memorySave 工具（AI 调用保存记忆）
 *  - memories.json 存储（用 ctx.fs 读写 userData）
 *  - 整理记忆（发指令给 AI 提炼要点）
 *  - 「长期记忆」页（ctx.shell.addSidebarPanel 注入）
 *
 * 数据文件：<userData>/memories.json（与核心共用同一文件，便于注入到提示词）
 */

export const name = 'cuckoo-memory';

const TYPES = ['user', 'feedback', 'topic', 'reference'];

/** 记忆文件路径（惰性获取 userData） */
async function memoryFile(ctx) {
  const dir = await ctx.fs.userDataDir();
  if (!dir) return null;
  const sep = dir.indexOf('\\') >= 0 ? '\\' : '/';
  return dir + sep + 'memories.json';
}

async function readMemories(ctx) {
  const file = await memoryFile(ctx);
  if (!file) return { version: 1, memories: [] };
  const raw = await ctx.fs.read(file);
  if (!raw) return { version: 1, memories: [] };
  try {
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.memories)) return data;
  } catch (_) { /* ignore */ }
  return { version: 1, memories: [] };
}

async function writeMemories(ctx, data) {
  const file = await memoryFile(ctx);
  if (!file) return false;
  return ctx.fs.write(file, JSON.stringify(data, null, 2));
}

function nextId(memories) {
  let max = 0;
  for (const m of memories) if (m.id > max) max = m.id;
  return max + 1;
}

export function apply(ctx) {
  ctx.log('长期记忆插件已加载');

  // ===== 工具：memorySave =====
  ctx.tools.register({
    name: 'memorySave',
    description: '保存一条长期记忆。当用户透露身份/偏好、纠正你的行为、或出现重要决策时调用。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: "记忆类型：user(画像)/feedback(反馈)/topic(话题)/reference(资料)" },
        name: { type: 'string', description: '简短标题' },
        content: { type: 'string', description: '记忆正文' },
        description: { type: 'string', description: '补充描述' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
      },
      required: ['type', 'name', 'content'],
    },
    jsApi: 'memorySave(type, name, content, description?, tags?)',
    execute: async (args) => {
      if (!args || !args.name || !args.content) throw new Error('name/content 必填');
      const type = TYPES.includes(args.type) ? args.type : 'topic';
      const data = await readMemories(ctx);
      const now = Date.now();
      const mem = {
        id: nextId(data.memories),
        scope: 'global',
        type,
        name: String(args.name).trim(),
        content: String(args.content).trim(),
        description: String(args.description || '').trim(),
        tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      };
      data.memories.push(mem);
      const ok = await writeMemories(ctx, data);
      if (!ok) throw new Error('写入记忆失败');
      return '已保存记忆 #' + mem.id + '：[' + type + '] ' + mem.name;
    },
  });

  // ===== 命令：整理长期记忆 / 整理当天记忆 =====
  ctx.command?.register({
    id: 'organize-memory',
    title: '整理长期记忆',
    run: () => organize(ctx, false),
  });
  ctx.command?.register({
    id: 'organize-today-memory',
    title: '整理当天记忆',
    run: () => organize(ctx, true),
  });

  ctx.log('已注册 memorySave 工具 + 整理命令');
}

/** 整理记忆：发指令给 AI 提炼要点 */
async function organize(ctx, todayOnly) {
  const instruction = todayOnly
    ? '请重点分析以上对话中【今天】发生的内容，提炼出值得【长期记住】的信息：今天的任务/进展、做出的决策、新的偏好或纠正、项目状态变化等。对每一条调用 memorySave 工具保存（type/name/content 必填）。如果没有值得长期记住的，直接回复"无需记录"。只调用工具，不要输出多余解释。'
    : '请分析以上整段对话，提炼出值得【长期记住】的信息：我的身份/职业/角色、偏好习惯、纠正过的回答方式、重要技术决策、项目背景等。对每一条调用 memorySave 工具保存（type/name/content 必填）。如果没有值得长期记住的，直接回复"无需记录"。只调用工具，不要输出多余解释。';
  const agent = ctx.agents.current();
  if (!agent) return { success: false, error: '无当前会话' };
  await agent.followup({ role: 'user', content: instruction });
  return { success: true };
}

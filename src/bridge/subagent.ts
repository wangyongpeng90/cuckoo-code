/**
 * 子代理窗口的 bridge 逻辑（仅在子代理窗口中激活）
 *
 * 激活条件：主进程经 --cuckoo-subagent=<encoded JSON> 传入配置。
 * 流程：页面就绪 → 发任务提示词 → 监听回复 → 无工具调用（纯文本）= 完成
 *      → IPC 通知主进程（subagent-response）→ 主进程关闭窗口并取文本。
 */
import { createRequire } from 'node:module';
import { extractJsToolBlocks } from './parser/js-detector.js';
import { onInterceptedResponse, onStream } from './intercept/observer.js';

const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

export interface SubagentConfig {
  agentName: string;
  task: string;
  systemPrompt: string;
  tools: string[] | null;
  maxTurns: number | null;
  projectDir: string | null;
  /** 网关模式：task 是纯用户消息（不加"任务"框架），让 AI 自由用工具 */
  isGateway?: boolean;
}

/** 从 process.argv 解析子代理配置（无则 null） */
export function readSubagentConfig(): SubagentConfig | null {
  try {
    const argv = (process as any).argv || [];
    const arg = argv.find((a: string) => a.startsWith('--cuckoo-subagent='));
    if (!arg) return null;
    const json = decodeURIComponent(arg.slice('--cuckoo-subagent='.length));
    const cfg = JSON.parse(json);
    if (!cfg || !cfg.agentName || !cfg.task) return null;
    return cfg;
  } catch (_) {
    return null;
  }
}

/** 拼子代理的"代理提示 + 任务"（作为 extraPrompt 追加到完整系统提示词末尾） */
function buildSubagentPrompt(cfg: SubagentConfig): string {
  // 网关模式：纯用户消息（像正常对话），不加"任务"框架，让 AI 自由用工具
  if (cfg.isGateway) return cfg.task || '';
  const parts: string[] = [];
  if (cfg.systemPrompt) parts.push(cfg.systemPrompt);
  parts.push('');
  parts.push('---');
  parts.push('任务：' + cfg.task);
  parts.push('');
  parts.push('完成后直接给出最终结果（不要再调用工具）。');
  return parts.join('\n');
}

/**
 * 若当前是子代理窗口，则初始化子代理流程。
 * @returns 子代理配置（非子代理窗口返回 null）
 */
export function initSubagentIfNeeded(): SubagentConfig | null {
  const cfg = readSubagentConfig();
  if (!cfg) return null;

  console.log('[Cuckoo Code][子代理] 激活：' + cfg.agentName);

  // ===== 进度上报（节流）：逐字增量 → 主进程 → 父窗口 UI =====
  let lastPushAt = 0;
  let lastPreview = '';
  function pushProgress(patch: any): void {
    try { ipcRenderer.send('subagent-progress', patch); } catch (_) { /* ignore */ }
  }
  onStream((ev: any) => {
    try {
      const t = (ev && ev.text) || '';
      const th = (ev && ev.think) || '';
      if (!t && !th) return;
      const now = Date.now();
      // 节流：最多每 400ms 推一次，且正文有变化
      if (now - lastPushAt < 400) return;
      const preview = t.slice(-200);
      if (preview === lastPreview && !th) return;
      lastPushAt = now;
      lastPreview = preview;
      // text 带完整正文 + think 带完整思考（供网关流式）；preview 截断（供父窗口 UI）
      pushProgress({ status: 'running', preview: preview, text: t, think: th });
    } catch (_) { /* ignore */ }
  });

  // 监听回复：无工具调用 = 完成；含工具 = 一轮（受 maxTurns 限制）
  let turnCount = 0;
  onInterceptedResponse((text: string) => {
    const raw = (text || '').trim();
    if (!raw) return;
    const blocks = extractJsToolBlocks(raw);
    if (blocks.length === 0) {
      console.log('[Cuckoo Code][子代理] 收到最终回复，长度=' + raw.length + '，上报主进程');
      // 推一次 done（网关用它收尾）
      pushProgress({ status: 'done', text: raw, done: true });
      ipcRenderer.invoke('subagent-response', { text: raw, done: true }).catch(() => {});
      return;
    }
    // 含工具调用 = 一轮
    turnCount++;
    pushProgress({ turn: turnCount, status: 'running', preview: raw.slice(-200) });
    if (cfg.maxTurns && turnCount >= cfg.maxTurns) {
      console.log('[Cuckoo Code][子代理] 达到 maxTurns=' + cfg.maxTurns + '，停止并上报部分结果');
      ipcRenderer.invoke('subagent-response', { text: raw, partial: true, turns: turnCount }).catch(() => {});
    } else {
      console.log('[Cuckoo Code][子代理] 第 ' + turnCount + ' 轮，含 ' + blocks.length + ' 个工具块，继续');
    }
  });

  // 复用"初始化项目"流程：调一次 initProject（含工具提示 + 代理提示 + 任务）。
  // 它内部会发 initial-prompt 事件；若输入框未就绪，chat-input 的处理器会等待重试。
  // 这样 UI（project-dir-updated）、提示词（initial-prompt）、工具上下文全走标准流程。
  const extraPrompt = buildSubagentPrompt(cfg);
  setTimeout(async () => {
    try {
      await (window as any).electronAPI.initProject(cfg.projectDir || null, false, extraPrompt, true);
      console.log('[Cuckoo Code][子代理] 已调 initProject（复用初始化流程）');
    } catch (e: any) {
      console.error('[Cuckoo Code][子代理] initProject 失败: ' + (e && e.message));
    }
  }, 800);

  return cfg;
}

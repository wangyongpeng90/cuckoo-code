/**
 * 子代理窗口的 bridge 逻辑（仅在子代理窗口中激活）
 *
 * 激活条件：主进程经 --cuckoo-subagent=<encoded JSON> 传入配置。
 * 流程：页面就绪 → 发任务提示词 → 监听回复 → 无工具调用（纯文本）= 完成
 *      → IPC 通知主进程（subagent-response）→ 主进程关闭窗口并取文本。
 */
import { createRequire } from 'node:module';
import { extractJsToolBlocks } from './parser/js-detector.js';
import { onInterceptedResponse } from './intercept/observer.js';

const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

export interface SubagentConfig {
  agentName: string;
  task: string;
  systemPrompt: string;
  tools: string[] | null;
  maxTurns: number | null;
  projectDir: string | null;
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

  // 监听回复：无工具调用 = 完成；含工具 = 一轮（受 maxTurns 限制）
  let turnCount = 0;
  onInterceptedResponse((text: string) => {
    const raw = (text || '').trim();
    if (!raw) return;
    const blocks = extractJsToolBlocks(raw);
    if (blocks.length === 0) {
      console.log('[Cuckoo Code][子代理] 收到最终回复，长度=' + raw.length + '，上报主进程');
      ipcRenderer.invoke('subagent-response', { text: raw, done: true }).catch(() => {});
      return;
    }
    // 含工具调用 = 一轮
    turnCount++;
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
      await window.electronAPI.initProject(cfg.projectDir || null, false, extraPrompt, true);
      console.log('[Cuckoo Code][子代理] 已调 initProject（复用初始化流程）');
    } catch (e: any) {
      console.error('[Cuckoo Code][子代理] initProject 失败: ' + (e && e.message));
    }
  }, 800);

  return cfg;
}

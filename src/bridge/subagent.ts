/**
 * 子代理窗口的 bridge 逻辑（仅在子代理窗口中激活）
 *
 * 激活条件：主进程经 --cuckoo-subagent=<encoded JSON> 传入配置。
 * 流程：页面就绪 → 发任务提示词 → 监听回复 → 无工具调用（纯文本）= 完成
 *      → IPC 通知主进程（subagent-response）→ 主进程关闭窗口并取文本。
 */
import { createRequire } from 'node:module';
import { extractJsToolBlocks } from './parser/js-detector.js';
import { sendToChat } from '../overlay/chat-input.js';
import { onInterceptedResponse } from './intercept/observer.js';

const require = createRequire(import.meta.url);
const { ipcRenderer } = require('electron');

export interface SubagentConfig {
  agentName: string;
  task: string;
  systemPrompt: string;
  tools: string[] | null;
  maxTurns: number | null;
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

/** 拼子代理的首轮提示词：代理系统提示 + 工具系统提示 + 任务 */
function buildSubagentPrompt(cfg: SubagentConfig, toolPrompt: string): string {
  const parts: string[] = [];
  if (cfg.systemPrompt) parts.push(cfg.systemPrompt);
  if (toolPrompt) {
    parts.push('');
    parts.push(toolPrompt);
  }
  parts.push('');
  parts.push('---');
  parts.push('任务：' + cfg.task);
  parts.push('');
  parts.push('完成后直接给出最终结果（不要再调用工具）。');
  return parts.join('\n');
}

/**
 * 若当前是子代理窗口，则初始化子代理流程。
 * @returns 是否为子代理窗口（true 表示已接管）
 */
export function initSubagentIfNeeded(): boolean {
  const cfg = readSubagentConfig();
  if (!cfg) return false;

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

  // 拉取工具系统提示，再等页面就绪后发送首轮任务
  (async () => {
    let toolPrompt = '';
    try {
      const res = await ipcRenderer.invoke('get-subagent-prompt');
      if (res && res.success) toolPrompt = res.prompt || '';
    } catch (_) { /* ignore */ }
    const prompt = buildSubagentPrompt(cfg, toolPrompt);

    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      if (attempts > 60) { clearInterval(timer); console.error('[Cuckoo Code][子代理] 等待输入框超时'); return; }
      const ok = await sendToChat(prompt, '子代理任务', 800);
      if (ok) {
        clearInterval(timer);
        console.log('[Cuckoo Code][子代理] 任务已发送');
      }
    }, 1000);
  })();

  return true;
}

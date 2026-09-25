/**
 * 工具循环看门狗（改为 SSE 流静默检测）
 *
 * 目的：AI 生成过程中若 SSE 流长时间无任何数据（含心跳），说明卡住/中断，
 * 超时后发提示词催 AI 继续，避免任务无声中断。
 *
 * 检测方式：hook（主世界）在流静默超过阈值时派发 'cuckoo-stream-idle' 事件，
 * 本模块（隔离世界）订阅后按次数发提示词。
 *
 * 配置（localStorage，每窗口独立）：
 *  - cuckoo-xhr-idle-timeout   静默阈值（毫秒，默认 300000，<=0 禁用；hook 侧读取）
 *  - cuckoo-watchdog-prompt    超时提示词（默认"请继续"）
 *  - cuckoo-watchdog-count     最大催次数（默认 3，负数=无限）
 */
import { showToast } from '../../overlay/panel.js';
import { getProviderByUrl } from '../../providers/registry.js';
import { sendToChat } from '../../overlay/chat-input.js';

const DEFAULT_PROMPT = '请继续';
const DEFAULT_COUNT = 3;

let idleCount = 0;
// 暂停开关：压缩等流程进行中时置 true，完全停摆
let suspended = false;

/** 取当前页面 URL 对应的会话 ID（无则返回 null） */
function getCurrentSessionId(): string | null {
  try {
    const provider = getProviderByUrl(window.location.href);
    if (provider && typeof provider.extractSessionId === 'function') {
      return provider.extractSessionId(window.location.href) || null;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function readConfig(): { prompt: string; count: number } {
  let prompt = DEFAULT_PROMPT;
  let count = DEFAULT_COUNT;
  try {
    const p = localStorage.getItem('cuckoo-watchdog-prompt');
    if (p) prompt = p;
    const c = parseInt(localStorage.getItem('cuckoo-watchdog-count') as string, 10);
    if (Number.isFinite(c)) count = c;
  } catch (_) {}
  return { prompt, count };
}

/** 测试用：当前静默催继续计数 */
function getIdleCount(): number { return idleCount; }

/** 收到流静默事件 */
function onStreamIdle(detail: any): void {
  if (suspended) return;
  // 会话校验：静默发生的会话与当前不一致 → 忽略
  if (detail && detail.sessionId !== undefined) {
    const cur = getCurrentSessionId();
    if (detail.sessionId !== cur) {
      console.log('[Cuckoo Code][看门狗] 会话已切换（' + detail.sessionId + ' -> ' + cur + '），忽略');
      return;
    }
  }
  const cfg = readConfig();
  if (cfg.count >= 0 && idleCount >= cfg.count) {
    showToast('等待 AI 回复超时已达上限（' + cfg.count + ' 次），停止催继续', 4000);
    return;
  }
  idleCount++;
  showToast('等待 AI 回复超时，发送「' + cfg.prompt + '」催继续（第 ' + idleCount + ' 次）', 3000);
  try {
    sendToChat(cfg.prompt, '看门狗', 300);
  } catch (e: any) {
    console.error('[Cuckoo Code][看门狗] 发送提示词失败: ' + e.message);
  }
}

/** 收到任意终态回复：成功则重置计数 */
function onResponseReceived(status: string): void {
  if (status === 'finished') idleCount = 0;
}

/** 手动重置（压缩等流程可调用） */
function reset(): void {
  idleCount = 0;
}

/** 暂停/恢复看门狗：暂停时忽略所有静默事件 */
function setSuspended(v: any): void {
  suspended = !!v;
  if (suspended) {
    idleCount = 0;
  }
}

// ===== 会话切换检测（由 bridge/entry 的 URL 变化事件驱动，不再高频轮询）=====
let lastSeenSessionId: string | null = null;

/** URL 变化时调用：检测到会话切换则重置计数（避免误打扰新会话） */
function checkSessionChange(): void {
  const sid = getCurrentSessionId();
  if (sid !== lastSeenSessionId) {
    console.log('[Cuckoo Code][看门狗] 检测到会话切换（' + lastSeenSessionId + ' -> ' + sid + '），重置');
    lastSeenSessionId = sid;
    reset();
  }
}

/** 初始化会话监视（记录初始 sessionId，供 checkSessionChange 比对） */
function startSessionWatcher(): void {
  lastSeenSessionId = getCurrentSessionId();
}

/** 启动：订阅流静默事件 */
let started = false;
function startWatchdog(): void {
  if (started) return;
  started = true;
  window.addEventListener('cuckoo-stream-idle', function (ev: any) {
    try { onStreamIdle(ev && ev.detail); } catch (e) { /* ignore */ }
  });
  console.log('[Cuckoo Code][看门狗] 已启动（SSE 流静默检测）');
}

export {
  startWatchdog,
  onResponseReceived,
  reset,
  setSuspended,
  startSessionWatcher,
  checkSessionChange,
  readConfig as _readConfig,
  getIdleCount as _getIdleCount,
};

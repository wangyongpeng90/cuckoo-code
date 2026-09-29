/**
 * 失败自动重试引擎
 * 订阅 intercept-observer 的 cuckoo-ai-error 事件，按配置退避后发送提示词，
 * 触发 AI 重新回答。成功回复会重置计数。
 *
 * 配置来源：主进程设置（settings.json），经 overlay/settings.ts 的内存缓存同步读取
 *（init 时拉取一次，saveSettings 后刷新缓存；timer 回调不触达 IPC）。
 * 字段含义（默认值见 app/settings-store.ts 的 DEFAULT_SETTINGS）：
 *  - retryEnabled / retryDelayMin / retryDelayMax / retryCount（负数=无限）
 *  - retry429Delay / retry429Count（负数=无限）/ retryPrompt
 */
import { sendToChat } from '../../overlay/chat-input.js';
import { onAiError, onInterceptedResponse } from '../intercept/observer.js';
import { showToast } from '../../overlay/panel.js';
import { showRetryCountdown, hideRetryCountdown } from '../../overlay/retry-countdown.js';
import { withLog } from '../../infra/with-log.js';
import { getProviderByUrl } from '../../providers/registry.js';
import { getCachedSettings } from '../../overlay/settings.js';

const DEFAULT_PROMPT = '刚才的回复似乎中断了，请重新完整回答上一个问题。';

let readConfig = function readConfig(): any {
  const s = getCachedSettings();
  return {
    enabled: s.retryEnabled,
    delayMin: s.retryDelayMin,
    delayMax: s.retryDelayMax,
    count: s.retryCount,
    delay429: s.retry429Delay,
    count429: s.retry429Count,
    prompt: s.retryPrompt,
  };
};

let pickDelay = function pickDelay(min: any, max: any): number {
  if (!Number.isFinite(min) || min < 0) min = 0;
  if (!Number.isFinite(max) || max < min) max = min;
  if (min === max) return min;
  return Math.floor(Math.random() * (max - min)) + min;
};

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

let normalCount = 0;
let count429 = 0;
let pending: any = null;
let compacting = false;

let setCompacting = function setCompacting(v: any): void {
  compacting = !!v;
};

let clearPending = function clearPending(): void {
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.countdownTimer) clearInterval(pending.countdownTimer);
  pending = null;
  hideRetryCountdown();
};

let onSuccess = function onSuccess(): void {
  normalCount = 0;
  count429 = 0;
  clearPending();
};

let cancelPending = function cancelPending(): void {
  clearPending();
  showToast('已取消自动重试', 2000);
};

let showCountdown = function showCountdown(totalMs: number): any {
  let remain = Math.ceil(totalMs / 1000);
  showRetryCountdown(remain, cancelPending);
  const cd = setInterval(() => {
    remain -= 1;
    if (remain <= 0) { clearInterval(cd); return; }
    showRetryCountdown(remain, cancelPending);
  }, 1000);
  return cd;
};

let handleError = function handleError(detail: any): void {
  const cfg = readConfig();
  if (!cfg.enabled) return;
  if (compacting) return;
  // 会话校验：错误发生时的会话与当前会话不一致 → 忽略（旧会话的延迟失败）
  if (detail && detail.sessionId !== undefined) {
    const cur = getCurrentSessionId();
    if (detail.sessionId !== cur) {
      console.log('[Cuckoo Code][重试] 会话已切换（' + detail.sessionId + ' -> ' + cur + '），忽略旧会话的错误');
      return;
    }
  }

  // 操作频繁：HTTP 429，或 hook 标记的 reason='rate_limit'（如 biz_code=40029）
  const is429 = detail && (detail.httpStatus === 429 || detail.reason === 'rate_limit');
  if (is429) {
    if (cfg.count429 >= 0 && count429 >= cfg.count429) {
      showToast('操作频繁重试已达上限（' + cfg.count429 + ' 次），停止自动重试', 4000);
      clearPending();
      return;
    }
    count429++;
  } else {
    if (cfg.count >= 0 && normalCount >= cfg.count) {
      showToast('自动重试已达上限（' + cfg.count + ' 次），停止自动重试', 4000);
      clearPending();
      return;
    }
    normalCount++;
  }

  clearPending();
  const delay = is429
    ? (Number.isFinite(cfg.delay429) ? cfg.delay429 : 60000)
    : pickDelay(cfg.delayMin, cfg.delayMax);

  const cdTimer = showCountdown(delay);
  const timer = setTimeout(() => {
    hideRetryCountdown();
    if (pending && pending.countdownTimer) clearInterval(pending.countdownTimer);
    pending = null;
    try {
      sendToChat(cfg.prompt, is429 ? '重试(操作频繁)' : '重试', 300);
    } catch (e: any) {
      console.error('[Cuckoo Code][重试] 发送提示词失败: ' + e.message);
    }
  }, delay);

  pending = { kind: is429 ? '429' : 'normal', timer: timer, countdownTimer: cdTimer, remainMs: delay };
};

let started = false;
let startRetryEngine = function startRetryEngine(): void {
  if (started) return;
  started = true;
  onAiError(handleError);
  onInterceptedResponse(() => onSuccess());
  console.log('[Cuckoo Code][重试] 自动重试引擎已启动');
};

// ===== 类 AOP：为所有方法自动加调用日志（含内部互调）=====
// 原理：用 let 声明的函数表达式绑定可重新赋值，模块内部调用在运行时按标识符查找，
// 因此重赋值后内部互调也会走到带日志的版本。
readConfig = withLog(readConfig, 'retry.readConfig');
pickDelay = withLog(pickDelay, 'retry.pickDelay');
setCompacting = withLog(setCompacting, 'retry.setCompacting');
clearPending = withLog(clearPending, 'retry.clearPending');
onSuccess = withLog(onSuccess, 'retry.onSuccess');
cancelPending = withLog(cancelPending, 'retry.cancelPending');
showCountdown = withLog(showCountdown, 'retry.showCountdown');
handleError = withLog(handleError, 'retry.handleError');
startRetryEngine = withLog(startRetryEngine, 'retry.startRetryEngine');

export { startRetryEngine, setCompacting, readConfig, DEFAULT_PROMPT };

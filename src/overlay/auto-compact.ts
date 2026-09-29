/**
 * 自动压缩上下文（运行态）
 * 设置 UI 已迁往 shell 侧栏（Task 6/8），本模块只管运行态：
 * 配置来自 overlay/settings.ts 缓存（主进程 settings.json），
 * 收到回复后按阈值触发压缩；设置变更（本窗口保存 / 主进程广播）经
 * onSettingsChanged 同步运行态。
 * deps 显式注入（响应订阅、压缩触发、UI 提示），便于测试。
 */
import { getCachedSettings, onSettingsChanged } from './settings.js';

// 配置：是否启用 + 阈值（单位：万 token）
let autoCompactEnabled = false;
let autoCompactThresholdWan = 80;
// 防止压缩过程中重复触发
let autoCompactTriggering = false;

interface AutoCompactDeps {
  /** 订阅"AI 回复完成"事件（bridge 注入的 onInterceptedResponse） */
  onResponse?: (cb: (text: string, meta: any) => void) => void;
  /** 触发一次压缩流程 */
  triggerCompaction(): Promise<unknown> | void;
  /** UI 提示（showToast） */
  notify(message: string, durationMs?: number): void;
}

/** 从设置缓存读取自动压缩配置到运行态 */
function loadAutoCompactConfig(): void {
  const s = getCachedSettings();
  autoCompactEnabled = s.autoCompactEnabled;
  if (Number.isFinite(s.autoCompactThreshold) && s.autoCompactThreshold > 0) {
    autoCompactThresholdWan = s.autoCompactThreshold;
  }
}

/** 检查是否触发自动压缩（数据源：服务端 tokenUsage.accumulatedTokens） */
function checkAutoCompact(deps: AutoCompactDeps, server: any): void {
  if (!autoCompactEnabled || autoCompactTriggering) return;
  if (!server || typeof server.accumulatedTokens !== 'number') return;
  const thresholdTokens = autoCompactThresholdWan * 10000;
  if (server.accumulatedTokens < thresholdTokens) return;
  // 触发
  autoCompactTriggering = true;
  console.log('[Cuckoo Compact] 自动触发：当前 ' + server.accumulatedTokens + ' >= 阈值 ' + thresholdTokens);
  deps.notify('Token 超阈值（' + autoCompactThresholdWan + '万），自动压缩中...', 4000);
  Promise.resolve(deps.triggerCompaction()).finally(() => {
    // 压缩会跳转页面；若未跳转（失败），重置标志允许下次重试
    autoCompactTriggering = false;
  });
}

/**
 * 初始化自动压缩：加载配置、订阅回复事件做阈值检查。
 * 仅在收到成功回复事件时检查，避免失败/停止时因旧 token 值反复触发压缩。
 * 订阅设置变更（本窗口保存 / 主进程广播）：保持运行态与 shell 设置不分裂。
 */
function initAutoCompact(deps: AutoCompactDeps): void {
  loadAutoCompactConfig();
  onSettingsChanged(() => loadAutoCompactConfig());
  deps.onResponse?.((_text: string, meta: any) => {
    checkAutoCompact(deps, (meta && meta.tokenUsage) || null);
  });
}

export { initAutoCompact };
export type { AutoCompactDeps };

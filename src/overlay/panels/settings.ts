/**
 * 设置弹窗：加载/保存/恢复默认，以及自动压缩与 token 显示
 * 由 events.ts 拆分而来（P4.5），逻辑保持不变。
 */
import { showToast } from '../panel.js';
import { state } from '../state.js';

/** 打开设置弹窗：从 localStorage 加载配置到输入框 */
function openSettings() {
  function setVal(id: string, v: any) {
    const el = document.getElementById(id);
    if (el) (el as any).value = v;
  }
  // localStorage 存毫秒，UI 显示秒（毫秒/1000）
  const msToSec = (ms: any, dft: any) => {
    const n = parseInt(ms, 10);
    return String(Number.isFinite(n) ? n / 1000 : dft);
  };
  try {
    const en = localStorage.getItem('cuckoo-retry-enabled');
    const enEl = document.getElementById('cuckoo-retry-enabled');
    if (enEl) (enEl as any).checked = en === null ? true : en === '1';
    setVal('cuckoo-retry-delay-min', msToSec(localStorage.getItem('cuckoo-retry-delay-min') || '4000', 4));
    setVal('cuckoo-retry-delay-max', msToSec(localStorage.getItem('cuckoo-retry-delay-max') || '10000', 10));
    setVal('cuckoo-retry-count', localStorage.getItem('cuckoo-retry-count') || '10');
    setVal('cuckoo-retry-429-delay', msToSec(localStorage.getItem('cuckoo-retry-429-delay') || '60000', 60));
    setVal('cuckoo-retry-429-count', localStorage.getItem('cuckoo-retry-429-count') || '20');
    setVal('cuckoo-retry-prompt', localStorage.getItem('cuckoo-retry-prompt') || '刚才的回复似乎中断了，请重新完整回答上一个问题。');
    setVal('cuckoo-xhr-idle-timeout', msToSec(localStorage.getItem('cuckoo-xhr-idle-timeout') || '300000', 300));
    setVal('cuckoo-watchdog-prompt', localStorage.getItem('cuckoo-watchdog-prompt') || '请继续');
    setVal('cuckoo-watchdog-count', localStorage.getItem('cuckoo-watchdog-count') || '3');
    setVal('cuckoo-attach-delay-min', msToSec(localStorage.getItem('cuckoo-attach-delay-min') || '500', 0.5));
    setVal('cuckoo-attach-delay-max', msToSec(localStorage.getItem('cuckoo-attach-delay-max') || '1000', 1));
  } catch (_) {}
  setVal('cuckoo-delay-min', state.sendDelayMin / 1000);
  setVal('cuckoo-delay-max', state.sendDelayMax / 1000);
  const panel = document.getElementById('cuckoo-settings');
  if (panel) panel.classList.remove('cuckoo-hidden');
}

/** 关闭设置弹窗 */
function closeSettings() {
  const panel = document.getElementById('cuckoo-settings');
  if (panel) panel.classList.add('cuckoo-hidden');
}

/** 恢复默认：删除所有相关 localStorage 键，重置内存 state，刷新弹窗 */
function resetSettings() {
  const KEYS = [
    'cuckoo-retry-enabled', 'cuckoo-retry-delay-min', 'cuckoo-retry-delay-max',
    'cuckoo-retry-count', 'cuckoo-retry-429-delay', 'cuckoo-retry-429-count',
    'cuckoo-retry-prompt', 'cuckoo-xhr-idle-timeout', 'cuckoo-watchdog-prompt',
    'cuckoo-watchdog-count', 'cuckoo-send-delay-min', 'cuckoo-send-delay-max',
    'cuckoo-attach-delay-min', 'cuckoo-attach-delay-max',
  ];
  try {
    for (const k of KEYS) localStorage.removeItem(k);
  } catch (_) {}
  state.sendDelayMin = 2000;
  state.sendDelayMax = 4000;
  showToast('已恢复默认设置', 2500);
  openSettings(); // 重新加载默认值到输入框
}

/** 保存设置弹窗的所有配置 */
function saveSettings() {
  const val = (id: string) => { const el = document.getElementById(id); return el ? (el as any).value : ''; };
  // UI 输入为秒，存储转毫秒
  const secToMs = (s: any) => Math.round(parseFloat(s) * 1000);
  const dmin = secToMs(val('cuckoo-retry-delay-min'));
  const dmax = secToMs(val('cuckoo-retry-delay-max'));
  if (Number.isNaN(dmin) || dmin < 0) { showToast('普通失败最小间隔必须是非负数字（秒）', 3000); return; }
  if (Number.isNaN(dmax) || dmax < dmin) { showToast('普通失败最大间隔不能小于最小间隔', 3000); return; }
  const cnt = parseInt(val('cuckoo-retry-count'), 10);
  if (Number.isNaN(cnt)) { showToast('普通失败重试次数必须是整数', 3000); return; }
  const d429 = secToMs(val('cuckoo-retry-429-delay'));
  if (Number.isNaN(d429) || d429 < 0) { showToast('操作频繁重试间隔必须是非负数字（秒）', 3000); return; }
  const c429 = parseInt(val('cuckoo-retry-429-count'), 10);
  if (Number.isNaN(c429)) { showToast('操作频繁重试次数必须是整数', 3000); return; }
  const prompt = val('cuckoo-retry-prompt').trim();
  if (!prompt) { showToast('重试提示词不能为空', 3000); return; }
  const idleTimeout = secToMs(val('cuckoo-xhr-idle-timeout'));
  if (Number.isNaN(idleTimeout) || idleTimeout < 0) { showToast('挂起超时必须是非负数字（秒）', 3000); return; }
  const watchdogPrompt = val('cuckoo-watchdog-prompt').trim();
  if (!watchdogPrompt) { showToast('工具循环超时提示词不能为空', 3000); return; }
  const watchdogCount = parseInt(val('cuckoo-watchdog-count'), 10);
  if (Number.isNaN(watchdogCount)) { showToast('工具循环催继续次数必须是整数', 3000); return; }
  const smin = secToMs(val('cuckoo-delay-min'));
  const smax = secToMs(val('cuckoo-delay-max'));
  if (Number.isNaN(smin) || smin < 0) { showToast('发送延迟最小值必须是非负数字（秒）', 3000); return; }
  if (Number.isNaN(smax) || smax < smin) { showToast('发送延迟最大值不能小于最小值', 3000); return; }
  const amin = secToMs(val('cuckoo-attach-delay-min'));
  const amax = secToMs(val('cuckoo-attach-delay-max'));
  if (Number.isNaN(amin) || amin < 0) { showToast('附件上传间隔最小值必须是非负数字（秒）', 3000); return; }
  if (Number.isNaN(amax) || amax < amin) { showToast('附件上传间隔最大值不能小于最小值', 3000); return; }
  if (amax > 60000) { showToast('附件上传间隔最大值不能超过 60 秒', 3000); return; }

  const enEl = document.getElementById('cuckoo-retry-enabled');
  try {
    localStorage.setItem('cuckoo-retry-enabled', (enEl && (enEl as any).checked) ? '1' : '0');
    localStorage.setItem('cuckoo-retry-delay-min', String(dmin));
    localStorage.setItem('cuckoo-retry-delay-max', String(dmax));
    localStorage.setItem('cuckoo-retry-count', String(cnt));
    localStorage.setItem('cuckoo-retry-429-delay', String(d429));
    localStorage.setItem('cuckoo-retry-429-count', String(c429));
    localStorage.setItem('cuckoo-retry-prompt', prompt);
    localStorage.setItem('cuckoo-xhr-idle-timeout', String(idleTimeout));
    localStorage.setItem('cuckoo-watchdog-prompt', watchdogPrompt);
    localStorage.setItem('cuckoo-watchdog-count', String(watchdogCount));
    localStorage.setItem('cuckoo-send-delay-min', String(smin));
    localStorage.setItem('cuckoo-send-delay-max', String(smax));
    localStorage.setItem('cuckoo-attach-delay-min', String(amin));
    localStorage.setItem('cuckoo-attach-delay-max', String(amax));
  } catch (_) {}
  state.sendDelayMin = smin;
  state.sendDelayMax = smax;
  showToast('设置已保存', 2500);
  closeSettings();
}

// ========== 纯数据读写（供 IPC：壳页面设置页调用） ==========
// 设置仍以 localStorage 为唯一数据源（AI 页面 loop / hook 需同步读，不能搬走）。
// 本组函数只负责"读 → 返回 UI 单位值" / "校验 → 写回 localStorage + 更新 state"。

/** 安全读 localStorage */
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

/** 设置数据（UI 单位：时间类为"秒"；count 为整数；prompt 为文本） */
interface SettingsData {
  retryEnabled: boolean;
  retryDelayMin: number;
  retryDelayMax: number;
  retryCount: number;
  retry429Delay: number;
  retry429Count: number;
  retryPrompt: string;
  xhrIdleTimeout: number;
  watchdogPrompt: string;
  watchdogCount: number;
  sendDelayMin: number;
  sendDelayMax: number;
  attachDelayMin: number;
  attachDelayMax: number;
  goalMaxIterations: number;
}

/** 读取当前设置（UI 单位：秒） */
function getSettingsData(): SettingsData {
  const sec = (raw: string | null, dft: number) => {
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) ? n / 1000 : dft;
  };
  const int = (raw: string | null, dft: number) => {
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) ? n : dft;
  };
  const enRaw = lsGet('cuckoo-retry-enabled');
  return {
    retryEnabled: enRaw === null ? true : enRaw === '1',
    retryDelayMin: sec(lsGet('cuckoo-retry-delay-min'), 4),
    retryDelayMax: sec(lsGet('cuckoo-retry-delay-max'), 10),
    retryCount: int(lsGet('cuckoo-retry-count'), 10),
    retry429Delay: sec(lsGet('cuckoo-retry-429-delay'), 60),
    retry429Count: int(lsGet('cuckoo-retry-429-count'), 20),
    retryPrompt: lsGet('cuckoo-retry-prompt') || '刚才的回复似乎中断了，请重新完整回答上一个问题。',
    xhrIdleTimeout: sec(lsGet('cuckoo-xhr-idle-timeout'), 300),
    watchdogPrompt: lsGet('cuckoo-watchdog-prompt') || '请继续',
    watchdogCount: int(lsGet('cuckoo-watchdog-count'), 3),
    sendDelayMin: sec(lsGet('cuckoo-send-delay-min'), 2),
    sendDelayMax: sec(lsGet('cuckoo-send-delay-max'), 4),
    attachDelayMin: sec(lsGet('cuckoo-attach-delay-min'), 0.5),
    attachDelayMax: sec(lsGet('cuckoo-attach-delay-max'), 1),
    goalMaxIterations: int(lsGet('cuckoo-goal-max-iterations'), 50),
  };
}

/**
 * 校验并写回设置（UI 单位 → 存储毫秒）。
 * @returns { success, error? }
 */
function applySettingsData(data: any): { success: boolean; error?: string } {
  const secToMs = (s: any) => Math.round(parseFloat(s) * 1000);
  const dmin = secToMs(data && data.retryDelayMin);
  const dmax = secToMs(data && data.retryDelayMax);
  if (!Number.isFinite(dmin) || dmin < 0) return { success: false, error: '普通失败最小间隔必须是非负数字' };
  if (!Number.isFinite(dmax) || dmax < dmin) return { success: false, error: '普通失败最大间隔不能小于最小间隔' };
  const cnt = parseInt(data && data.retryCount, 10);
  if (Number.isNaN(cnt)) return { success: false, error: '普通失败重试次数必须是整数' };
  const d429 = secToMs(data && data.retry429Delay);
  if (!Number.isFinite(d429) || d429 < 0) return { success: false, error: '操作频繁重试间隔必须是非负数字' };
  const c429 = parseInt(data && data.retry429Count, 10);
  if (Number.isNaN(c429)) return { success: false, error: '操作频繁重试次数必须是整数' };
  const prompt = String((data && data.retryPrompt) || '').trim();
  if (!prompt) return { success: false, error: '重试提示词不能为空' };
  const idleTimeout = secToMs(data && data.xhrIdleTimeout);
  if (!Number.isFinite(idleTimeout) || idleTimeout < 0) return { success: false, error: 'AI 回复超时必须是非负数字' };
  const watchdogPrompt = String((data && data.watchdogPrompt) || '').trim();
  if (!watchdogPrompt) return { success: false, error: '超时重试提示词不能为空' };
  const watchdogCount = parseInt(data && data.watchdogCount, 10);
  if (Number.isNaN(watchdogCount)) return { success: false, error: '超时重试次数必须是整数' };
  const smin = secToMs(data && data.sendDelayMin);
  const smax = secToMs(data && data.sendDelayMax);
  if (!Number.isFinite(smin) || smin < 0) return { success: false, error: '发送延迟最小值必须是非负数字' };
  if (!Number.isFinite(smax) || smax < smin) return { success: false, error: '发送延迟最大值不能小于最小值' };
  const amin = secToMs(data && data.attachDelayMin);
  const amax = secToMs(data && data.attachDelayMax);
  if (!Number.isFinite(amin) || amin < 0) return { success: false, error: '附件上传间隔最小值必须是非负数字' };
  if (!Number.isFinite(amax) || amax < amin) return { success: false, error: '附件上传间隔最大值不能小于最小值' };
  if (amax > 60000) return { success: false, error: '附件上传间隔最大值不能超过 60 秒' };
  const goalMax = parseInt(data && data.goalMaxIterations, 10);
  if (Number.isNaN(goalMax) || goalMax <= 0) return { success: false, error: '目标最大迭代次数必须是正整数' };

  try {
    localStorage.setItem('cuckoo-retry-enabled', (data && data.retryEnabled) ? '1' : '0');
    localStorage.setItem('cuckoo-retry-delay-min', String(dmin));
    localStorage.setItem('cuckoo-retry-delay-max', String(dmax));
    localStorage.setItem('cuckoo-retry-count', String(cnt));
    localStorage.setItem('cuckoo-retry-429-delay', String(d429));
    localStorage.setItem('cuckoo-retry-429-count', String(c429));
    localStorage.setItem('cuckoo-retry-prompt', prompt);
    localStorage.setItem('cuckoo-xhr-idle-timeout', String(idleTimeout));
    localStorage.setItem('cuckoo-watchdog-prompt', watchdogPrompt);
    localStorage.setItem('cuckoo-watchdog-count', String(watchdogCount));
    localStorage.setItem('cuckoo-send-delay-min', String(smin));
    localStorage.setItem('cuckoo-send-delay-max', String(smax));
    localStorage.setItem('cuckoo-attach-delay-min', String(amin));
    localStorage.setItem('cuckoo-attach-delay-max', String(amax));
    localStorage.setItem('cuckoo-goal-max-iterations', String(goalMax));
  } catch (err: any) {
    return { success: false, error: '写入失败: ' + err.message };
  }
  state.sendDelayMin = smin;
  state.sendDelayMax = smax;
  return { success: true };
}

/** 恢复默认：清 key + 重置 state，返回默认值 */
function resetSettingsData(): SettingsData {
  const KEYS = [
    'cuckoo-retry-enabled', 'cuckoo-retry-delay-min', 'cuckoo-retry-delay-max',
    'cuckoo-retry-count', 'cuckoo-retry-429-delay', 'cuckoo-retry-429-count',
    'cuckoo-retry-prompt', 'cuckoo-xhr-idle-timeout', 'cuckoo-watchdog-prompt',
    'cuckoo-watchdog-count', 'cuckoo-send-delay-min', 'cuckoo-send-delay-max',
    'cuckoo-attach-delay-min', 'cuckoo-attach-delay-max',
    'cuckoo-goal-max-iterations',
  ];
  try { for (const k of KEYS) localStorage.removeItem(k); } catch (_) {}
  state.sendDelayMin = 2000;
  state.sendDelayMax = 4000;
  return getSettingsData();
}

export { openSettings, closeSettings, resetSettings, saveSettings, getSettingsData, applySettingsData, resetSettingsData };
export type { SettingsData };

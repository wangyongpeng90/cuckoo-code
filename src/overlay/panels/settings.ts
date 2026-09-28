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
    const pcbEl = document.getElementById('cuckoo-retry-prefer-continue-btn');
    if (pcbEl) (pcbEl as any).checked = localStorage.getItem('cuckoo-retry-prefer-continue-btn') !== '0';
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
    'cuckoo-retry-prompt', 'cuckoo-retry-prefer-continue-btn',
    'cuckoo-xhr-idle-timeout', 'cuckoo-watchdog-prompt',
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
    const pcbEl = document.getElementById('cuckoo-retry-prefer-continue-btn');
    localStorage.setItem('cuckoo-retry-prefer-continue-btn', (pcbEl && (pcbEl as any).checked) ? '1' : '0');
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

export { openSettings, closeSettings, resetSettings, saveSettings };

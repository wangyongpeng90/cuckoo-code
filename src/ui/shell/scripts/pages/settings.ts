/**
 * 设置页：失败重试 / 发送延迟 / 附件间隔。
 */
import { api, ckAlert, ckConfirm } from '../shared.js';

const SET_FIELDS: [string, string][] = [
  ['retry-delay-min', 'retryDelayMin'],
  ['retry-delay-max', 'retryDelayMax'],
  ['retry-count', 'retryCount'],
  ['retry-429-delay', 'retry429Delay'],
  ['retry-429-count', 'retry429Count'],
  ['retry-prompt', 'retryPrompt'],
  ['xhr-idle-timeout', 'xhrIdleTimeout'],
  ['watchdog-prompt', 'watchdogPrompt'],
  ['watchdog-count', 'watchdogCount'],
  ['send-delay-min', 'sendDelayMin'],
  ['send-delay-max', 'sendDelayMax'],
  ['attach-delay-min', 'attachDelayMin'],
  ['attach-delay-max', 'attachDelayMax'],
];

function setVal(id: string, v: any): void {
  const el = document.getElementById('st-' + id) as any;
  if (el) el.value = (v === null || v === undefined) ? '' : v;
}
function getVal(id: string): string {
  const el = document.getElementById('st-' + id) as any;
  return el ? el.value : '';
}
function renderSettings(data: any): void {
  if (!data) return;
  const enEl = document.getElementById('st-retry-enabled') as any;
  if (enEl) enEl.checked = data.retryEnabled !== false;
  const ssrfEl = document.getElementById('st-ssrf-guard') as any;
  if (ssrfEl) ssrfEl.checked = data.ssrfGuard === true;
  for (const [id, key] of SET_FIELDS) setVal(id, data[key]);
}

export async function loadSettings(): Promise<void> {
  if (!api.getSettings) return;
  try {
    const r = await api.getSettings();
    if (r && r.success && r.data) renderSettings(r.data);
  } catch (_) { /* ignore */ }
}

function collectSettings(): any {
  const num = (id: string) => { const n = parseFloat(getVal(id)); return Number.isFinite(n) ? n : 0; };
  const enEl = document.getElementById('st-retry-enabled') as any;
  const ssrfEl = document.getElementById('st-ssrf-guard') as any;
  return {
    retryEnabled: !!(enEl && enEl.checked),
    ssrfGuard: !!(ssrfEl && ssrfEl.checked),
    retryDelayMin: num('retry-delay-min'),
    retryDelayMax: num('retry-delay-max'),
    retryCount: parseInt(getVal('retry-count'), 10) || 0,
    retry429Delay: num('retry-429-delay'),
    retry429Count: parseInt(getVal('retry-429-count'), 10) || 0,
    retryPrompt: getVal('retry-prompt'),
    xhrIdleTimeout: num('xhr-idle-timeout'),
    watchdogPrompt: getVal('watchdog-prompt'),
    watchdogCount: parseInt(getVal('watchdog-count'), 10) || 0,
    sendDelayMin: num('send-delay-min'),
    sendDelayMax: num('send-delay-max'),
    attachDelayMin: num('attach-delay-min'),
    attachDelayMax: num('attach-delay-max'),
  };
}

const stSaveBtn = document.getElementById('st-save') as any;
if (stSaveBtn) stSaveBtn.addEventListener('click', async () => {
  if (!api.saveSettings) return;
  stSaveBtn.disabled = true;
  try {
    const r = await api.saveSettings(collectSettings());
    if (r && r.success) {
      if (r.data) renderSettings(r.data);
      stSaveBtn.textContent = '已保存';
      setTimeout(() => { stSaveBtn.textContent = '保存设置'; }, 1200);
    } else {
      await ckAlert((r && r.error) || '保存失败');
    }
  } catch (e: any) { await ckAlert('保存失败: ' + (e.message || e)); }
  stSaveBtn.disabled = false;
});
document.getElementById('st-refresh')?.addEventListener('click', loadSettings);
document.getElementById('st-reset')?.addEventListener('click', async () => {
  if (!api.resetSettings) return;
  if (!(await ckConfirm('确定恢复默认设置？'))) return;
  try {
    const r = await api.resetSettings();
    if (r && r.success && r.data) renderSettings(r.data);
  } catch (_) { /* ignore */ }
});

// ===== 外观：主题下拉（走主进程 theme API，不归 settings 存取）=====
const themeSelect = document.getElementById('st-theme-select') as any;
const THEME_BUILTINS: [string, string][] = [
  ['system', '跟随系统'],
  ['light', '浅色'],
  ['dark', '深色'],
];
function fillThemeOptions(registered: any[]): void {
  if (!themeSelect) return;
  const opts: [string, string][] = THEME_BUILTINS.slice();
  for (const t of (registered || [])) {
    // 内置 light/dark 已在上面，跳过
    if (t && t.id && t.id !== 'light' && t.id !== 'dark') opts.push([t.id, t.id]);
  }
  const cur = themeSelect.value;
  themeSelect.innerHTML = opts.map(([v, label]) =>
    '<option value="' + v + '">' + label + '</option>').join('');
  if (cur) themeSelect.value = cur;
}
function renderThemeSelect(): void {
  const anyApi = api as any;
  if (!themeSelect || typeof anyApi.themeGet !== 'function') return;
  anyApi.themeGet().then((r: any) => {
    if (r && r.success && r.snapshot) {
      fillThemeOptions(r.snapshot.themes);
      themeSelect.value = r.snapshot.preference || 'system';
    }
  }).catch(() => {});
  if (typeof anyApi.onThemeChanged === 'function') {
    anyApi.onThemeChanged((snap: any) => {
      if (!snap) return;
      fillThemeOptions(snap.themes);
      if (themeSelect) themeSelect.value = snap.preference || 'system';
    });
  }
}
if (themeSelect) {
  themeSelect.addEventListener('change', () => {
    const anyApi = api as any;
    if (typeof anyApi.themeSet === 'function') {
      anyApi.themeSet(themeSelect.value).catch(() => {});
    }
  });
  renderThemeSelect();
}

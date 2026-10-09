/**
 * Token 显示（状态条 + Token 页）+ 近 10 日柱状图 + 自动压缩。
 */
import { api, ckAlert, ckConfirm, formatTokenCount, formatTokenCountHTML, formatShort } from '../shared.js';

const contextEl = document.getElementById('sb-context');
const cumulativeEl = document.getElementById('sb-cumulative');
const windowEl = document.getElementById('sb-window');
const todayEl = document.getElementById('sb-today');
const systemEl = document.getElementById('sb-system');

function renderChart(daily: any[]): void {
  const chart = document.getElementById('tk-chart');
  if (!chart) return;
  if (!Array.isArray(daily) || daily.length === 0) {
    chart.innerHTML = '<div class="ck-list-empty" style="width:100%;">暂无数据</div>';
    return;
  }
  const sorted = daily.slice().sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));
  let max = Math.max.apply(null, sorted.map((d: any) => d.value || 0));
  if (max <= 0) max = 1;
  chart.innerHTML = sorted.map((d: any) => {
    const v = d.value || 0;
    const pct = Math.max(1, Math.round((v / max) * 100));
    const day = (d.date || '').slice(5).replace('-', '/');
    return '<div class="ck-bar-row" title="' + d.date + '：' + formatShort(v) + ' tokens">' +
      '<span class="ck-bar-label">' + day + '</span>' +
      '<div class="ck-bar-track"><div class="ck-bar" style="width:' + pct + '%;"></div></div>' +
    '</div>';
  }).join('');
}

const tkContext = document.getElementById('tk-context');
const tkCumulative = document.getElementById('tk-cumulative');
const tkToday = document.getElementById('tk-today');
const tkWindow = document.getElementById('tk-window');
const tkSystem = document.getElementById('tk-system');

if ((api as any).onTokenUpdated) {
  (api as any).onTokenUpdated((data: any) => {
    if (!data) return;
    if (contextEl) contextEl.textContent = formatTokenCount(data.context);
    if (cumulativeEl) cumulativeEl.textContent = formatTokenCount(data.cumulative);
    if (windowEl) windowEl.textContent = formatTokenCount(data.windowCumulative);
    if (todayEl) todayEl.textContent = formatTokenCount(data.todayCumulative);
    if (tkContext) tkContext.innerHTML = formatTokenCountHTML(data.context);
    if (tkCumulative) tkCumulative.textContent = formatTokenCount(data.cumulative);
    if (tkToday) tkToday.textContent = formatTokenCount(data.todayCumulative);
    if (tkWindow) tkWindow.textContent = formatTokenCount(data.windowCumulative);
    if (data.daily) renderChart(data.daily);
  });
}
const tpsEl = document.getElementById('sb-tps');
// 常驻显示：生成中实时更新，生成结束后保留本轮最终值；无数据时显示 "--"
if ((api as any).onTpsUpdated) {
  (api as any).onTpsUpdated((data: any) => {
    const t = data && data.tps ? String(data.tps) : '';
    if (tpsEl) tpsEl.textContent = t || '--';
  });
}
if ((api as any).onTotalUpdated) {
  (api as any).onTotalUpdated((data: any) => {
    if (data && systemEl) systemEl.textContent = formatTokenCount(data.systemTotal);
    if (data && tkSystem) tkSystem.textContent = formatTokenCount(data.systemTotal);
  });
}
if ((api as any).getSystemTotal) {
  (api as any).getSystemTotal().then((r: any) => {
    if (r && r.success && systemEl) systemEl.textContent = formatTokenCount(r.systemTotal);
    if (r && r.success && tkSystem) tkSystem.textContent = formatTokenCount(r.systemTotal);
  }).catch(() => {});
}

export async function loadAutoCompact(): Promise<void> {
  if (!api.getAutoCompact) return;
  try {
    const r = await api.getAutoCompact();
    if (r && r.success && r.data) {
      const enEl = document.getElementById('tk-auto-enabled') as any;
      const thEl = document.getElementById('tk-auto-threshold') as any;
      if (enEl) enEl.checked = r.data.enabled === true;
      if (thEl) thEl.value = r.data.threshold;
    }
  } catch (_) { /* ignore */ }
}
const tkCompactBtn = document.getElementById('tk-compact');
if (tkCompactBtn) tkCompactBtn.addEventListener('click', async () => {
  if (!api.triggerCompact) return;
  if (!(await ckConfirm('确定压缩上下文？\n\n会先整理长期记忆，再生成摘要并在新会话继续。', '压缩上下文'))) return;
  try { await api.triggerCompact(); } catch (_) { /* ignore */ }
});
const tkOrganizeBtn = document.getElementById('tk-organize-memory');
if (tkOrganizeBtn) tkOrganizeBtn.addEventListener('click', async () => {
  if (!api.triggerOrganizeMemory) return;
  if (!(await ckConfirm('确定整理长期记忆？\n\nAI 会分析当前对话，提炼要点保存为长期记忆（不压缩对话）。', '整理长期记忆'))) return;
  try { await api.triggerOrganizeMemory(); } catch (_) { /* ignore */ }
});
const tkAutoSaveBtn = document.getElementById('tk-auto-save') as any;
if (tkAutoSaveBtn) tkAutoSaveBtn.addEventListener('click', async () => {
  if (!api.saveAutoCompact) return;
  const enEl = document.getElementById('tk-auto-enabled') as any;
  const thEl = document.getElementById('tk-auto-threshold') as any;
  const enabled = !!(enEl && enEl.checked);
  const threshold = parseFloat(thEl ? thEl.value : '80');
  if (!Number.isFinite(threshold) || threshold <= 0) { await ckAlert('阈值需为正数（万）'); return; }
  tkAutoSaveBtn.disabled = true;
  try {
    const r = await api.saveAutoCompact({ enabled, threshold });
    if (r && r.success) {
      tkAutoSaveBtn.textContent = '已保存';
      setTimeout(() => { tkAutoSaveBtn.textContent = '保存设置'; }, 1200);
    } else {
      await ckAlert((r && r.error) || '保存失败');
    }
  } catch (e: any) { await ckAlert('保存失败: ' + (e.message || e)); }
  tkAutoSaveBtn.disabled = false;
});

/**
 * Token 页（React 版）
 *
 * 迁移自 pages/token.ts 的"Token 页"部分（tk-*）：
 * - 当前上下文 / 累计 / 今日 / 窗口 / 系统
 * - 压缩上下文
 * - 自动压缩配置
 * - 近 10 日柱状图
 *
 * 注意：状态栏（sb-*）的联动不在本页（属"状态栏"，后续处理）。
 */
import { createElement, useState, useEffect, useCallback, useRef } from 'react';
import { api, ckAlert, ckConfirm, formatTokenCount, formatShort } from '../shared.js';
import { DonationBlock } from './donation-block.js';

interface DailyItem { date: string; value: number; }
interface TokenData { context?: number; cumulative?: number; windowCumulative?: number; todayCumulative?: number; daily?: DailyItem[]; }

/** 压缩图标 */
function CompactIcon() {
  return createElement('svg', { className: 'ck-btn-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    createElement('path', { d: 'M8 3v4M8 7H4M8 7l-4-4' }), createElement('path', { d: 'M16 21v-4M16 17h4M16 17l4 4' }), createElement('path', { d: 'M4 14h16' }));
}
/** 保存图标 */
function SaveIcon() {
  return createElement('svg', { className: 'ck-btn-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    createElement('path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' }), createElement('path', { d: 'M17 21v-8H7v8' }), createElement('path', { d: 'M7 3v5h8' }));
}

/** 柱状图 */
function Chart({ daily }: { daily: DailyItem[] }) {
  if (!Array.isArray(daily) || daily.length === 0) {
    return createElement('div', { className: 'ck-chart' }, createElement('div', { className: 'ck-list-empty', style: { width: '100%' } }, '暂无数据'));
  }
  const sorted = daily.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  let max = Math.max.apply(null, sorted.map((d) => d.value || 0));
  if (max <= 0) max = 1;
  return createElement('div', { className: 'ck-chart' },
    sorted.map((d) => {
      const v = d.value || 0;
      const pct = Math.max(1, Math.round((v / max) * 100));
      const day = (d.date || '').slice(5).replace('-', '/');
      return createElement('div', { key: d.date, className: 'ck-bar-row', title: d.date + '：' + formatShort(v) + ' tokens' },
        createElement('span', { className: 'ck-bar-label' }, day),
        createElement('div', { className: 'ck-bar-track' }, createElement('div', { className: 'ck-bar', style: { width: pct + '%' } })),
      );
    }),
  );
}

/** Token 页 */
export function TokenPage() {
  const [data, setData] = useState<TokenData>({});
  const [systemTotal, setSystemTotal] = useState(0);
  const [auto, setAuto] = useState<{ enabled: boolean; threshold: number }>({ enabled: false, threshold: 80 });
  const [saving, setSaving] = useState(false);

  // 订阅 token 更新 + 挂载时拉取最近一次（避免错过切页前的推送）
  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.onTokenUpdated) {
      anyApi.onTokenUpdated((d: TokenData) => { if (d) setData(d); });
    }
    if (anyApi.getTokenUsage) {
      anyApi.getTokenUsage().then((r: any) => {
        if (r && r.success && r.data) setData(r.data);
      }).catch(() => {});
    }
    if (anyApi.onTotalUpdated) {
      anyApi.onTotalUpdated((d: any) => { if (d && typeof d.systemTotal === 'number') setSystemTotal(d.systemTotal); });
    }
    if (anyApi.getSystemTotal) {
      anyApi.getSystemTotal().then((r: any) => { if (r && r.success) setSystemTotal(r.systemTotal); }).catch(() => {});
    }
  }, []);

  // 加载自动压缩配置
  const loadAuto = useCallback(async () => {
    if (!api.getAutoCompact) return;
    try {
      const r = await api.getAutoCompact();
      if (r && r.success && r.data) setAuto({ enabled: r.data.enabled === true, threshold: r.data.threshold });
    } catch (_) { /* ignore */ }
  }, []);
  useEffect(() => { loadAuto(); }, [loadAuto]);

  const onCompact = useCallback(async () => {
    if (!api.triggerCompact) return;
    if (!(await ckConfirm('确定压缩上下文？将生成摘要并在新会话继续。', '压缩上下文'))) return;
    try { await api.triggerCompact(); } catch (_) { /* ignore */ }
  }, []);

  const onSaveAuto = useCallback(async () => {
    if (!api.saveAutoCompact) return;
    if (!Number.isFinite(auto.threshold) || auto.threshold <= 0) { await ckAlert('阈值需为正数（万）'); return; }
    setSaving(true);
    try {
      const r = await api.saveAutoCompact({ enabled: auto.enabled, threshold: auto.threshold } as any);
      if (r && r.success) { await ckAlert('已保存'); }
      else { await ckAlert((r && r.error) || '保存失败'); }
    } catch (e: any) { await ckAlert('保存失败: ' + (e.message || e)); }
    setSaving(false);
  }, [auto]);

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-token-hero' },
      createElement('span', { className: 'ck-token-hero-label' }, '当前上下文'),
      createElement('div', { className: 'ck-token-hero-value' },
        createElement('span', null, formatTokenCount(data.context || 0)),
        createElement('span', { className: 'ck-token-hero-unit' }, 'tokens'),
      ),
    ),
    createElement('button', { className: 'ck-btn ck-btn-anim', onClick: onCompact },
      createElement(CompactIcon), createElement('span', null, '压缩上下文')),
    createElement('div', { className: 'ck-stat-list' },
      createElement('div', { className: 'ck-stat-item' }, createElement('span', { className: 'ck-stat-key' }, '对话累计'), createElement('span', { className: 'ck-stat-val' }, formatTokenCount(data.cumulative || 0))),
      createElement('div', { className: 'ck-stat-item' }, createElement('span', { className: 'ck-stat-key' }, '今日窗口'), createElement('span', { className: 'ck-stat-val' }, formatTokenCount(data.todayCumulative || 0))),
      createElement('div', { className: 'ck-stat-item' }, createElement('span', { className: 'ck-stat-key' }, '窗口累计'), createElement('span', { className: 'ck-stat-val' }, formatTokenCount(data.windowCumulative || 0))),
      createElement('div', { className: 'ck-stat-item' }, createElement('span', { className: 'ck-stat-key' }, '系统总累计'), createElement('span', { className: 'ck-stat-val' }, formatTokenCount(systemTotal))),
    ),
    createElement('div', { className: 'ck-auto-block' },
      createElement('div', { className: 'ck-auto-head' },
        createElement('span', { className: 'ck-stat-key' }, '自动压缩'),
        createElement('label', { className: 'ck-switch' },
          createElement('input', { type: 'checkbox', checked: auto.enabled, onChange: (e: any) => setAuto({ ...auto, enabled: e.target.checked }) }),
          createElement('span', { className: 'ck-switch-track' }),
        ),
      ),
      createElement('div', { className: 'ck-auto-body' },
        createElement('span', null, '超过'),
        createElement('input', { type: 'number', min: 1, value: auto.threshold, onChange: (e: any) => setAuto({ ...auto, threshold: parseFloat(e.target.value) }) }),
        createElement('span', null, '万 tokens 时触发'),
      ),
      createElement('button', { className: 'ck-btn ck-btn-anim', disabled: saving, onClick: onSaveAuto },
        createElement(SaveIcon), createElement('span', null, saving ? '保存中…' : '保存设置')),
    ),
    createElement(DonationBlock, null),
    createElement('div', { className: 'ck-chart-block' }, createElement(Chart, { daily: data.daily || [] })),
  );
}

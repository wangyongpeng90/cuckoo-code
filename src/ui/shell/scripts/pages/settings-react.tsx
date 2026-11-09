/**
 * 设置（居中模态，feat/022-dsh-compat-c7）
 *
 * 点击活动栏"设置"→ 居中模态打开（遮罩 + 880x640 对话框）。
 * - 左导航：内置分类 + 插件分类（settings.section）
 * - 右内容：当前选中分类
 * - 底部：恢复默认（保存改为自动：改动后 500ms 防抖保存）
 * - 关闭：右上 ✕ / ESC / 点遮罩
 */
import { createElement, useState, useEffect, useCallback, useRef } from 'react';
import { api, ckAlert, ckConfirm } from '../shared.js';
import { useSlot, specLabel, renderPluginElement } from '../use-slot.js';
import { SlotErrorBoundary } from '../components/slot-error-boundary.js';
import { useHideAiView } from '../use-hide-ai-view.js';
import { Select } from '../components/select.js';
import { SettingRow } from '../components/setting-row.js';
import { DEFAULT_JS_RESULT_PHRASES, DEFAULT_JS_RESULT_ITEM_TEMPLATES } from '../../../../overlay/js-result-phrases.js';
import { DEFAULT_CONTINUE_PROMPTS } from '../../../../infra/continue-prompt-pool.js';
import {
  DEFAULT_READ_HEADER_FULL, DEFAULT_READ_HEADER_PARTIAL,
  DEFAULT_READ_FOOTER_FULL, DEFAULT_READ_FOOTER_PARTIAL, DEFAULT_READ_FOOTER_CAPPED,
  DEFAULT_GLOB_FOOTER_FULL, DEFAULT_GLOB_FOOTER_TRUNCATED,
  DEFAULT_WRITE_FOOTER_CREATE, DEFAULT_WRITE_FOOTER_UPDATE,
} from '../../../../infra/read-header-templates.js';
import * as echarts from 'echarts';

const SETTINGS_SLOT = 'settings.section';

const THEME_BUILTINS: [string, string][] = [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];

function RefreshIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }), createElement('path', { d: 'M21 3v6h-6' }));
}

/** 开关卡（WorkBuddy 风格：标题 + 描述 + 大开关，整块可点） */
function ToggleRow({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return createElement('div', { className: 'ck-switch-card', onClick: () => onChange(!checked) },
    createElement('div', { className: 'ck-switch-text' },
      createElement('div', { className: 'ck-switch-label' }, label),
      desc ? createElement('div', { className: 'ck-switch-desc' }, desc) : null,
    ),
    createElement('label', { className: 'ck-switch ck-switch-lg', onClick: (e: any) => e.stopPropagation() },
      createElement('input', { type: 'checkbox', checked, onChange: (e: any) => onChange(e.target.checked) }),
      createElement('span', { className: 'ck-switch-track' }),
    ),
  );
}


/** [261031-x7k9p2] 用量统计图表组件 */
function UsageStats() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<any>(null);
  const reqIdRef = useRef(0);
  const [granularity, setGranularity] = useState<'day'|'hour'|'minute'>('day');
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  const getDefaultStart = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const pad = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const getDefaultEnd = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  const [startTime, setStartTime] = useState<string>(getDefaultStart());
  const [endTime, setEndTime] = useState<string>(getDefaultEnd());

  useEffect(() => {
    if (api.listProfiles) {
      api.listProfiles().then((res: any) => {
        if (res && res.success && res.profiles) {
          setProfiles(res.profiles);
        }
      }).catch(() => {});
    }
  }, []);

  const loadData = useCallback(async (g: 'day'|'hour'|'minute', pId: string, sTime: string, eTime: string) => {
    if (!api.getUsageStats) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const startStr = sTime.replace('T', ' ') + ':00';
      const endStr = eTime.replace('T', ' ') + ':59';

      const res = await api.getUsageStats({ granularity: g, startTime: startStr, endTime: endStr, profileId: pId || null });
      // 竞态保护：只认最后一次请求的响应，过期响应直接丢弃
      if (reqId !== reqIdRef.current) return;
      if (!chartInst.current) return;
      if (!res || !res.success) {
        chartInst.current.clear(); // 查询失败也清空，避免残留旧数据
        return;
      }
      if (res.success) {
        const data = res.data || [];
        if (data.length === 0) {
          chartInst.current.clear(); // 显式清空，防 ECharts 保留旧 series
          return;
        }
        const xData = data.map((d: any) => {
          if (g === 'day') return d.time_label.slice(5); // MM-DD
          if (g === 'hour') return d.time_label.slice(11) + ':00'; // HH:00
          return d.time_label.slice(11, 16); // HH:mm
        });
        const sendData = data.map((d: any) => d.send_count);
        const replyData = data.map((d: any) => d.reply_count);
        const tokenData = data.map((d: any) => d.diff_token);

        const cs = getComputedStyle(document.documentElement);
        const textColor = cs.getPropertyValue('--ck-text').trim() || '#333';
        const dimColor = cs.getPropertyValue('--ck-text-dim').trim() || '#666';
        const borderColor = cs.getPropertyValue('--ck-border').trim() || '#eee';
        const bgColor = cs.getPropertyValue('--ck-bg').trim() || '#fff';

        chartInst.current.setOption({
          tooltip: { 
            trigger: 'axis',
            backgroundColor: bgColor,
            borderColor: borderColor,
            textStyle: { color: textColor }
          },
          legend: { 
            data: ['发送数', '回复数', '消耗 Token'], 
            textStyle: { color: textColor },
            top: 0,
            right: 10
          },
          grid: { left: '3%', right: '4%', bottom: '3%', top: '40px', containLabel: true },
          xAxis: { type: 'category', data: xData, axisLabel: { color: dimColor } },
          yAxis: [
            { type: 'value', axisLabel: { color: dimColor }, splitLine: { lineStyle: { color: borderColor } } },
            { type: 'value', axisLabel: { color: dimColor }, splitLine: { show: false } }
          ],
          series: [
            { name: '发送数', type: 'line', smooth: true, data: sendData, itemStyle: { color: '#3b82f6' } },
            { name: '回复数', type: 'line', smooth: true, data: replyData, itemStyle: { color: '#10b981' } },
            { name: '消耗 Token', type: 'line', smooth: true, yAxisIndex: 1, data: tokenData, itemStyle: { color: '#f59e0b' } }
          ]
        });
      }
    } catch (_) {
      if (reqId === reqIdRef.current) chartInst.current?.clear();
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  // 图表生命周期：只在挂载/卸载时初始化与销毁（不在筛选变化时重建）
  useEffect(() => {
    if (!chartRef.current) return;
    chartInst.current = echarts.init(chartRef.current);
    const handleResize = () => chartInst.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartInst.current?.dispose();
      chartInst.current = null;
    };
  }, []);

  // 数据加载：筛选条件变化时重新查询
  useEffect(() => {
    loadData(granularity, selectedProfile, startTime, endTime);
  }, [granularity, selectedProfile, startTime, endTime, loadData]);

  return createElement('div', { className: 'ck-card', style: { height: '500px', display: 'flex', flexDirection: 'column' } },
    createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '15px' } },
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        createElement('span', { style: { fontSize: '13px', color: 'var(--ck-text)' } }, '时间范围：'),
        createElement('input', { type: 'datetime-local', className: 'ck-set-input ck-set-input-sm', style: { width: 'auto' }, value: startTime, onChange: (e: any) => setStartTime(e.target.value) }),
        createElement('span', { style: { color: 'var(--ck-text-dim)' } }, '至'),
        createElement('input', { type: 'datetime-local', className: 'ck-set-input ck-set-input-sm', style: { width: 'auto' }, value: endTime, onChange: (e: any) => setEndTime(e.target.value) }),
        createElement('div', { style: { flex: 1 } }),
        createElement(Select, {
          value: selectedProfile,
          options: [
            { value: '', label: '所有窗口' },
            ...profiles.map((p: any) => ({ value: p.id, label: p.name || '未命名窗口' }))
          ],
          onChange: (v: string) => setSelectedProfile(v)
        })
      ),
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        createElement('div', { style: { display: 'flex', gap: '8px' } },
          createElement('button', { className: 'ck-btn ' + (granularity === 'day' ? 'ck-btn-primary' : ''), onClick: () => setGranularity('day'), disabled: loading }, '按天'),
          createElement('button', { className: 'ck-btn ' + (granularity === 'hour' ? 'ck-btn-primary' : ''), onClick: () => setGranularity('hour'), disabled: loading }, '按时'),
          createElement('button', { className: 'ck-btn ' + (granularity === 'minute' ? 'ck-btn-primary' : ''), onClick: () => setGranularity('minute'), disabled: loading }, '按分')
        ),
        createElement('span', { style: { fontSize: '12px', color: 'var(--ck-text-dim)' } }, '（左轴：消息数量，右轴：Token 消耗）')
      )
    ),
    createElement('div', { ref: chartRef, style: { flex: 1, minHeight: 0 } })
  );
}

/** 设置全屏模态 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  useHideAiView();

  const [data, setData] = useState<any>(null);
  const [themes, setThemes] = useState<[string, string][]>(THEME_BUILTINS);
  const [theme, setTheme] = useState('system');
  const [active, setActive] = useState('appearance');

  const pluginSections = useSlot(SETTINGS_SLOT);

  // 自动保存：数据变化后防抖保存（500ms）
  const saveTimer = useRef<any>(null);
  const dirtyRef = useRef(false);   // 是否"用户改动过"（初始加载不触发保存）
  const [savedTip, setSavedTip] = useState('');
  // 日志（仅打包版有意义；开发版提示"由 start.js 写日志"）
  const [logInfo, setLogInfo] = useState<{ enabled: boolean; dir: string; file: string; size: number } | null>(null);

  const load = useCallback(async () => {
    if (!api.getSettings) return;
    try {
      const r = await api.getSettings();
      if (r && r.success && r.data) { dirtyRef.current = false; setData(r.data); }
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 日志信息加载（每次切到 logs 分类时刷新）
  const loadLogInfo = useCallback(async () => {
    if (!api.getLogInfo) return;
    try {
      const r = await api.getLogInfo();
      if (r && r.success) setLogInfo({ enabled: r.enabled, dir: r.dir, file: r.file, size: r.size });
    } catch (_) { /* ignore */ }
  }, []);
  useEffect(() => { if (active === 'logs') loadLogInfo(); }, [active, loadLogInfo]);

  // 自动保存：data 变化 + 用户改过 → 防抖保存
  useEffect(() => {
    const saveFn = api.saveSettings;
    if (!data || !dirtyRef.current || !saveFn) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await saveFn(data);
        if (r && r.success) { setSavedTip('已保存'); setTimeout(() => setSavedTip(''), 1500); }
        else { setSavedTip('保存失败'); }
      } catch (_) { setSavedTip('保存失败'); }
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data]);

  // 主题
  useEffect(() => {
    const anyApi = api as any;
    if (typeof anyApi.themeGet === 'function') {
      anyApi.themeGet().then((r: any) => {
        if (r && r.success && r.snapshot) {
          const opts: [string, string][] = THEME_BUILTINS.slice();
          for (const t of (r.snapshot.themes || [])) { if (t && t.id && t.id !== 'light' && t.id !== 'dark') opts.push([t.id, t.id]); }
          setThemes(opts);
          setTheme(r.snapshot.preference || 'system');
        }
      }).catch(() => {});
    }
  }, []);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onThemeChange = useCallback((v: string) => {
    setTheme(v);
    const anyApi = api as any;
    if (typeof anyApi.themeSet === 'function') anyApi.themeSet(v).catch(() => {});
  }, []);

  const setField = useCallback((key: string, v: any) => {
    dirtyRef.current = true;
    setData((d: any) => ({ ...d, [key]: v }));
  }, []);

  const reset = useCallback(async () => {
    const anyApi = api as any;
    if (!anyApi.resetSettings) return;
    if (!(await ckConfirm('确定恢复默认设置？'))) return;
    try {
      const r = await anyApi.resetSettings();
      if (r && r.success && r.data) { dirtyRef.current = false; setData(r.data); }
    } catch (_) { /* ignore */ }
  }, []);

  // [022] 对齐 DSH 契约：settings.section slot 的 close() = 关闭整个设置面板
  // 原实现误做成"切回外观 tab"，导致插件（dsh-tasks 等）点「打开对话」后 Modal 还在
  // 详见 docs/dsh-compat-decisions.md 9.1 + 真机验证发现
  const closePluginSection = useCallback(() => { onClose(); }, [onClose]);

  const numVal = (key: string) => (data && (data[key] === null || data[key] === undefined)) ? '' : (data ? data[key] : '');

  // 数据未就绪时，只显示"加载中"（保持全屏壳）
  const loading = data === null;

  // 关键：data 为 null 时提前返回，避免下面的 builder 访问 data.xxx 崩溃
  if (loading) {
    return createElement('div', { className: 'ck-settings-mask', onClick: (e: any) => { if (e.target === e.currentTarget) onClose(); } },
      createElement('div', { className: 'ck-settings-dialog', onClick: (e: any) => e.stopPropagation() },
        createElement('div', { className: 'ck-settings-head' },
          createElement('div', { style: { flex: 1 } }),
          createElement('button', { className: 'ck-settings-close', title: '关闭（ESC）', onClick: onClose }, '✕'),
        ),
        createElement('div', { className: 'ck-set-layout' },
          createElement('div', { className: 'ck-set-nav' }),
          createElement('div', { className: 'ck-set-content' }, createElement('div', { className: 'ck-list-empty' }, '加载中…')),
        ),
      ),
    );
  }

  // ===== 内置分类内容 =====
  const appearance = createElement('div', { className: 'ck-card' },
    createElement(SettingRow, { label: '主题', desc: '选择界面主题（跟随系统 / 浅色 / 深色）' },
      createElement(Select, {
        value: theme,
        options: themes.map(([v, label]) => ({ value: v, label })),
        onChange: onThemeChange,
      }),
    ),
  );

  const retry = createElement('div', { className: 'ck-card' },
    createElement(ToggleRow, { label: '启用自动重试', desc: 'AI 回复失败时自动重试（按下方次数与间隔）', checked: data.retryEnabled !== false, onChange: (v) => setField('retryEnabled', v) }),
    createElement(SettingRow, { label: '普通失败间隔（秒）', desc: '两次重试之间的等待时间（随机区间）' },
      createElement('div', { className: 'ck-set-inline' },
        createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 1, value: numVal('retryDelayMin'), onChange: (e: any) => setField('retryDelayMin', parseFloat(e.target.value) || 0) }),
        createElement('span', { className: 'ck-set-sep' }, '至'),
        createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 1, value: numVal('retryDelayMax'), onChange: (e: any) => setField('retryDelayMax', parseFloat(e.target.value) || 0) }),
      ),
    ),
    createElement(SettingRow, { label: '普通失败重试次数', desc: '负数 = 无限重试' },
      createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', step: 1, value: numVal('retryCount'), onChange: (e: any) => setField('retryCount', parseInt(e.target.value, 10) || 0) })),
    createElement(SettingRow, { label: '操作频繁重试间隔（秒）', desc: '遇到"操作频繁"时的等待时间' },
      createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 1, value: numVal('retry429Delay'), onChange: (e: any) => setField('retry429Delay', parseFloat(e.target.value) || 0) })),
    createElement(SettingRow, { label: '操作频繁重试次数', desc: '负数 = 无限重试' },
      createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', step: 1, value: numVal('retry429Count'), onChange: (e: any) => setField('retry429Count', parseInt(e.target.value, 10) || 0) })),
    createElement(SettingRow, { label: 'AI 回复超时后重试（秒）', desc: 'AI 回复静默超过该时长则重试' },
      createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 1, value: numVal('xhrIdleTimeout'), onChange: (e: any) => setField('xhrIdleTimeout', parseFloat(e.target.value) || 0) })),
    createElement(SettingRow, { label: '超时重试次数', desc: '负数 = 无限重试' },
      createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', step: 1, value: numVal('watchdogCount'), onChange: (e: any) => setField('watchdogCount', parseInt(e.target.value, 10) || 0) })),
  );

  const sendDelay = createElement('div', { className: 'ck-card' },
    createElement(SettingRow, { label: '发送延迟区间（秒）', desc: '发送消息前的随机延迟（模拟人类操作）' },
      createElement('div', { className: 'ck-set-inline' },
        createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 0.1, value: numVal('sendDelayMin'), onChange: (e: any) => setField('sendDelayMin', parseFloat(e.target.value) || 0) }),
        createElement('span', { className: 'ck-set-sep' }, '至'),
        createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 0.1, value: numVal('sendDelayMax'), onChange: (e: any) => setField('sendDelayMax', parseFloat(e.target.value) || 0) }),
      ),
    ),
  );

  const attachDelay = createElement('div', { className: 'ck-card' },
    createElement(SettingRow, { label: '上传后检测等待（秒）', desc: '附件上传后等待检测的时长（区间）' },
      createElement('div', { className: 'ck-set-inline' },
        createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 0.1, value: numVal('attachDelayMin'), onChange: (e: any) => setField('attachDelayMin', parseFloat(e.target.value) || 0) }),
        createElement('span', { className: 'ck-set-sep' }, '至'),
        createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 0.1, value: numVal('attachDelayMax'), onChange: (e: any) => setField('attachDelayMax', parseFloat(e.target.value) || 0) }),
      ),
    ),
  );

  const security = createElement('div', { className: 'ck-card' },
    createElement(ToggleRow, { label: '拒绝 webFetch 访问内网/本地地址', desc: '开启后 webFetch 拒绝内网、回环、保留地址（防 SSRF）。默认关闭（可访问本地项目）。', checked: data.ssrfGuard === true, onChange: (v) => setField('ssrfGuard', v) }),
  );

  const aiIntercept = createElement('div', { className: 'ck-card' },
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, '拦截正则（每行一条）'),
      createElement('div', { className: 'ck-set-row-desc' }, '任意一条命中即视为 XML 工具调用，会提示 AI 改用 cuckoo 代码块。支持正则表达式，不区分大小写。'),
      createElement('textarea', { className: 'ck-set-textarea', rows: 8, value: data.aiInterceptPatterns || '', onChange: (e: any) => setField('aiInterceptPatterns', e.target.value) }),
    ),
  );

  // [261101-ym9l98] 工具结果回传文案两个池（头部文案 + 脚本标题模板），同分类上下排列
  const jsResultPhrases = createElement('div', { className: 'ck-card' },
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, '工具结果回复语池（每行一条）'),
      createElement('div', { className: 'ck-set-row-desc' },
        '执行完 AI 的工具调用后，回传结果时随机取一条作为消息开头。{n} 会替换为本次脚本数；池为空时使用内置文案。'),
      createElement('textarea', {
        className: 'ck-set-textarea', rows: 10,
        value: data.jsResultPhrases || '',
        onChange: (e: any) => setField('jsResultPhrases', e.target.value),
      }),
      createElement('div', { className: 'ck-set-inline', style: { marginTop: '8px', justifyContent: 'flex-end' } },
        createElement('button', { className: 'ck-btn', onClick: () => setField('jsResultPhrases', DEFAULT_JS_RESULT_PHRASES.join('\n')) }, '填入内置默认'),
        createElement('button', { className: 'ck-btn', onClick: () => setField('jsResultPhrases', '') }, '清空'),
      ),
    ),
    createElement('div', { className: 'ck-set-row-col', style: { marginTop: '16px' } },
      createElement('div', { className: 'ck-set-row-label' }, '脚本标题模板池（每行一条）'),
      createElement('div', { className: 'ck-set-row-desc' },
        '回传结果里每段脚本的标题行，整行即最终输出，同一批脚本共用一个模板。{i} 替换为序号（从 1 开始）。写法有两种：① 用 | 分隔成功和失败，如「第 {i} 块代码跑完了，成功，你看下|第 {i} 块代码没跑通，失败，得改改」；② 单句用 {r} 表示成功/失败。池为空时使用内置模板。'),
      createElement('textarea', {
        className: 'ck-set-textarea', rows: 10,
        value: data.jsResultItemTemplates || '',
        onChange: (e: any) => setField('jsResultItemTemplates', e.target.value),
      }),
      createElement('div', { className: 'ck-set-inline', style: { marginTop: '8px', justifyContent: 'flex-end' } },
        createElement('button', { className: 'ck-btn', onClick: () => setField('jsResultItemTemplates', DEFAULT_JS_RESULT_ITEM_TEMPLATES.join('\n')) }, '填入内置默认'),
        createElement('button', { className: 'ck-btn', onClick: () => setField('jsResultItemTemplates', '') }, '清空'),
      ),
    ),
  );

  /**
   * 生成一个「每行一条」的模板池编辑块（label + 说明 + textarea + 填入/清空）。
   * [261101-ym9l98] 多个 footer 池共用，避免重复 8 行 JSX。
   */
  const makeFooterBlock = (field: string, label: string, placeholders: string, defaults: string[]) =>
    createElement('div', { className: 'ck-set-row-col', style: { marginTop: '16px' } },
      createElement('div', { className: 'ck-set-row-label' }, label + '（每行一条）'),
      createElement('div', { className: 'ck-set-row-desc' },
        '占位符：' + placeholders + '；池为空时使用内置模板。'),
      createElement('textarea', {
        className: 'ck-set-textarea', rows: 6,
        value: data[field] || '',
        onChange: (e: any) => setField(field, e.target.value),
      }),
      createElement('div', { className: 'ck-set-inline', style: { marginTop: '8px', justifyContent: 'flex-end' } },
        createElement('button', { className: 'ck-btn', onClick: () => setField(field, defaults.join('\n')) }, '填入内置默认'),
        createElement('button', { className: 'ck-btn', onClick: () => setField(field, '') }, '清空'),
      ),
    );

  // [261101-ym9l98] 「让 AI 继续」统一池（重试/看门狗/手动催/格式纠正 共用）
  const continuePrompt = createElement('div', { className: 'ck-card' },
    makeFooterBlock('continuePrompt', '「让 AI 继续」提示词池', '无占位符', DEFAULT_CONTINUE_PROMPTS),
    createElement('div', { className: 'ck-set-row-desc', style: { marginTop: '8px', opacity: 0.75 } },
      '用于：请求失败自动重试、回复超时催继续、手动「卡住了」按钮、AI 输出 XML/JSON 格式工具调用。每次从池里随机取一条发送。'),
  );

  // [261101-ym9l98] read 工具输出格式（首行两套池 + 结尾三套池）
  const readHeader = createElement('div', { className: 'ck-card' },
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, '完整文件时的首行（每行一条）'),
      createElement('div', { className: 'ck-set-row-desc' },
        'read 读到文件末尾时用的首行。{path} 替换为文件路径，{total} 替换为总行数；池为空时使用内置模板。'),
      createElement('textarea', {
        className: 'ck-set-textarea', rows: 8,
        value: data.readHeaderFull || '',
        onChange: (e: any) => setField('readHeaderFull', e.target.value),
      }),
      createElement('div', { className: 'ck-set-inline', style: { marginTop: '8px', justifyContent: 'flex-end' } },
        createElement('button', { className: 'ck-btn', onClick: () => setField('readHeaderFull', DEFAULT_READ_HEADER_FULL.join('\n')) }, '填入内置默认'),
        createElement('button', { className: 'ck-btn', onClick: () => setField('readHeaderFull', '') }, '清空'),
      ),
    ),
    createElement('div', { className: 'ck-set-row-col', style: { marginTop: '16px' } },
      createElement('div', { className: 'ck-set-row-label' }, '部分读取时的首行（每行一条）'),
      createElement('div', { className: 'ck-set-row-desc' },
        '文件没读完时用的首行。{path} 路径、{start} 起始行、{end} 结束行、{total} 总行数、{rest} 剩余行数；池为空时使用内置模板。'),
      createElement('textarea', {
        className: 'ck-set-textarea', rows: 8,
        value: data.readHeaderPartial || '',
        onChange: (e: any) => setField('readHeaderPartial', e.target.value),
      }),
      createElement('div', { className: 'ck-set-inline', style: { marginTop: '8px', justifyContent: 'flex-end' } },
        createElement('button', { className: 'ck-btn', onClick: () => setField('readHeaderPartial', DEFAULT_READ_HEADER_PARTIAL.join('\n')) }, '填入内置默认'),
        createElement('button', { className: 'ck-btn', onClick: () => setField('readHeaderPartial', '') }, '清空'),
      ),
    ),
    makeFooterBlock('readFooterFull', '读完整个文件时的结尾', '{total} 总行数', DEFAULT_READ_FOOTER_FULL),
    makeFooterBlock('readFooterPartial', '文件没读完时的结尾', '{start} 起始行、{end} 结束行、{total} 总行数、{next} 下一段起始行号（请包在 offset= 里）', DEFAULT_READ_FOOTER_PARTIAL),
    makeFooterBlock('readFooterCapped', '输出字节超限被截断时的结尾', '{start} 起始行、{end} 结束行、{next} 下一段起始行号（请包在 offset= 里）', DEFAULT_READ_FOOTER_CAPPED),
  );

  // [261101-ym9l98] glob 结尾模板
  const globFooter = createElement('div', { className: 'ck-card' },
    makeFooterBlock('globFooterFull', '未截断时的结尾', '{count} 匹配文件数', DEFAULT_GLOB_FOOTER_FULL),
    makeFooterBlock('globFooterTruncated', '结果被截断时的结尾', '{shown} 已显示数、{total} 总数', DEFAULT_GLOB_FOOTER_TRUNCATED),
  );

  // [261101-ym9l98] write 结尾模板（新建 / 覆盖更新两套池）
  const writeFooter = createElement('div', { className: 'ck-card' },
    makeFooterBlock('writeFooterCreate', '新建文件时的确认', '{path} 文件路径', DEFAULT_WRITE_FOOTER_CREATE),
    makeFooterBlock('writeFooterUpdate', '覆盖已有文件时的确认', '{path} 文件路径', DEFAULT_WRITE_FOOTER_UPDATE),
  );

  // ===== 日志分类（仅打包版有用）=====
  const formatSize = (n: number) => n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(2) + ' MB';
  const toggleLog = async (v: boolean) => {
    if (!api.setLogEnabled) return;
    try {
      const r = await api.setLogEnabled(v);
      if (r && r.success) { await loadLogInfo(); }
    } catch (_) { /* ignore */ }
  };
  const onDeleteLogs = async () => {
    if (!api.deleteLogs) return;
    const ok = await ckConfirm('确定清空所有日志吗？');
    if (!ok) return;
    try {
      const r = await api.deleteLogs();
      if (r && r.success) { await loadLogInfo(); setSavedTip('日志已清空'); setTimeout(() => setSavedTip(''), 1500); }
    } catch (_) { /* ignore */ }
  };
  const onOpenLogDir = async () => {
    if (!api.openLogDir) return;
    try { await api.openLogDir(); } catch (_) { /* ignore */ }
  };

  const logs = createElement('div', { className: 'ck-card' },
    createElement('div', { className: 'ck-set-row-desc', style: { marginBottom: '10px', opacity: 0.75 } },
      '开启后，程序会把主进程 + 渲染进程的日志写入本地文件，便于排查问题。仅打包版生效（开发版日志由 start.js 自动写入）。'),
    createElement(ToggleRow, {
      label: '开启日志记录',
      desc: '开启后立即生效，无需重启',
      checked: !!(logInfo && logInfo.enabled),
      onChange: (v) => toggleLog(v),
    }),
    createElement(SettingRow, { label: '日志文件', desc: logInfo ? '大小 ' + formatSize(logInfo.size) : '加载中…' },
      createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        createElement('input', { type: 'text', className: 'ck-set-input', readOnly: true, value: logInfo ? logInfo.file : '' }),
        createElement('button', { className: 'ck-btn', onClick: onOpenLogDir, style: { whiteSpace: 'nowrap' } }, '打开目录'),
      ),
    ),
    createElement(SettingRow, { label: '清空日志', desc: '删除当前所有日志文件（不影响开关状态）' },
      createElement('button', { className: 'ck-btn ck-btn-danger', onClick: onDeleteLogs }, '清空'),
    ),
  );

  const NAV: [string, string][] = [
    ['appearance', '外观'],
    ['retry', '失败自动重试'],
    ['send', '发送延迟'],
    ['attach', '附件上传间隔'],
    ['security', '网络安全'],
    ['ai-intercept', 'AI 回复拦截'],
    ['js-result-phrases', '工具结果回复语'],   // [261101-ym9l98]
    ['read-header', '文件读取格式'],          // [261101-ym9l98]
    ['glob-footer', '文件搜索格式'],          // [261101-ym9l98]
    ['write-footer', '文件写入格式'],         // [261101-ym9l98]
    ['logs', '日志'],
    ['usage', '用量统计'],
  ];

  // 当前分类标题（右侧内容区顶部显示）
  let pageTitle = '';
  const navHit = NAV.find(([id]) => id === active);
  if (navHit) pageTitle = navHit[1];
  else if (active.startsWith('plugin:')) {
    const key = active.slice('plugin:'.length);
    const item = pluginSections.find((s: any) => (s.pluginId + ':' + s.id) === key);
    if (item) pageTitle = specLabel(item.spec, item.id);
  }

  let content: any = null;
  if (loading) content = createElement('div', { className: 'ck-list-empty' }, '加载中…');
  else if (active === 'appearance') content = appearance;
  else if (active === 'retry') content = createElement('div', null, retry, continuePrompt);
  else if (active === 'send') content = sendDelay;
  else if (active === 'attach') content = attachDelay;
  else if (active === 'security') content = security;
  else if (active === 'ai-intercept') content = aiIntercept;
  else if (active === 'js-result-phrases') content = jsResultPhrases;
  else if (active === 'read-header') content = readHeader;
  else if (active === 'glob-footer') content = globFooter;
  else if (active === 'write-footer') content = writeFooter;
  else if (active === 'logs') content = logs;
  else if (active === 'usage') content = createElement(UsageStats);
  else if (active.startsWith('plugin:')) {
    const key = active.slice('plugin:'.length);
    const item = pluginSections.find((s: any) => (s.pluginId + ':' + s.id) === key);
    if (item && item.Component) {
      // 合并：插件注入的 props（spec.inject）+ 壳提供的（close/t/wide）+ renderSlot
      const el = renderPluginElement(item, { close: closePluginSection, wide: true });
      // key：按分类 id，切换时强制重建错误边界（否则残留 err 状态 → 切回不显示）
      content = createElement('div', { className: 'ck-set-plugin-content', key: 'plugin:' + key },
        createElement(SlotErrorBoundary, { key: 'eb:' + key, label: '插件设置' }, el));
    } else {
      content = createElement('div', { className: 'ck-list-empty' }, '插件设置不可用');
    }
  }

  // 外层遮罩（点遮罩关闭）+ 内层居中对话框
  return createElement('div', { className: 'ck-settings-mask', onClick: (e: any) => { if (e.target === e.currentTarget) onClose(); } },
    createElement('div', { className: 'ck-settings-dialog', onClick: (e: any) => e.stopPropagation() },
      // 顶栏（只有关闭按钮）
      createElement('div', { className: 'ck-settings-head' },
        createElement('div', { style: { flex: 1 } }),
        createElement('button', { className: 'ck-settings-close', title: '关闭（ESC）', onClick: onClose }, '✕'),
      ),
      // 主体：左导航 + 右内容
      createElement('div', { className: 'ck-set-layout' },
        createElement('div', { className: 'ck-set-nav' },
          ...NAV.map(([id, label]) => createElement('button', {
            key: id, className: 'ck-set-nav-item' + (active === id ? ' active' : ''), onClick: () => setActive(id),
          }, label)),
          pluginSections.length > 0 ? createElement('div', { className: 'ck-set-nav-sep' }) : null,
          pluginSections.length > 0 ? createElement('div', { className: 'ck-set-nav-title' }, '插件') : null,
          ...pluginSections.map((s: any) => {
            const id = 'plugin:' + s.pluginId + ':' + s.id;
            const label = specLabel(s.spec, s.id);
            return createElement('button', {
              key: id, className: 'ck-set-nav-item' + (active === id ? ' active' : ''), title: label,
              onClick: () => setActive(id),
            }, label);
          }),
          // 底部浮动：恢复默认（margin-top:auto 推到最下）
          createElement('div', { className: 'ck-set-nav-foot' },
            createElement('button', { className: 'ck-set-nav-reset', disabled: loading, onClick: reset }, '恢复默认'),
          ),
        ),
        createElement('div', { className: 'ck-set-content' },
          pageTitle ? createElement('div', { className: 'ck-set-page-title' }, pageTitle) : null,
          content,
        ),
      ),
      // 顶栏下方显示"已保存"提示（自动保存状态）
      savedTip ? createElement('div', { className: 'ck-settings-saved ck-settings-saved-top' }, savedTip) : null,
    ),
  );
}

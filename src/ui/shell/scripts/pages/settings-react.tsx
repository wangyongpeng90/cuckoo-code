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

  const load = useCallback(async () => {
    if (!api.getSettings) return;
    try {
      const r = await api.getSettings();
      if (r && r.success && r.data) { dirtyRef.current = false; setData(r.data); }
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, '重试提示词'),
      createElement('textarea', { className: 'ck-set-textarea', rows: 3, value: data.retryPrompt || '', onChange: (e: any) => setField('retryPrompt', e.target.value) }),
    ),
    createElement(SettingRow, { label: 'AI 回复超时后重试（秒）', desc: 'AI 回复静默超过该时长则重试' },
      createElement('input', { type: 'number', className: 'ck-set-input ck-set-input-sm', min: 0, step: 1, value: numVal('xhrIdleTimeout'), onChange: (e: any) => setField('xhrIdleTimeout', parseFloat(e.target.value) || 0) })),
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, '超时重试提示词'),
      createElement('textarea', { className: 'ck-set-textarea', rows: 3, value: data.watchdogPrompt || '', onChange: (e: any) => setField('watchdogPrompt', e.target.value) }),
    ),
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
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, '拦截提示语'),
      createElement('div', { className: 'ck-set-row-desc' }, '拦截命中后发送给 AI 的提示文本'),
      createElement('textarea', { className: 'ck-set-textarea', rows: 3, value: data.aiInterceptPrompt || '', onChange: (e: any) => setField('aiInterceptPrompt', e.target.value) }),
    ),
  );

  const NAV: [string, string][] = [
    ['appearance', '外观'],
    ['retry', '失败自动重试'],
    ['send', '发送延迟'],
    ['attach', '附件上传间隔'],
    ['security', '网络安全'],
    ['ai-intercept', 'AI 回复拦截'],
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
  else if (active === 'retry') content = retry;
  else if (active === 'send') content = sendDelay;
  else if (active === 'attach') content = attachDelay;
  else if (active === 'security') content = security;
  else if (active === 'ai-intercept') content = aiIntercept;
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

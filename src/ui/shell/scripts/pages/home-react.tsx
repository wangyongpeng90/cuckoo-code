/**
 * 主页（feat/022-dsh-compat-c7）
 *
 * 常用操作聚合：
 * - 新建会话 / 纯净切换
 * - 插件面板（sidebar.panellist）
 * - 底部动作（sidebar.footer.action）—— 固定底部，滚动不影响
 *
 * [261125-p3vk8w-cuko-plugin-slots] 插槽订阅与条目渲染已抽到 components/sidebar-slots.tsx，
 * 与 Cuko 窗口共用；本页行为不变。
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api } from '../shared.js';
import { UiButton } from '../components/ui-button.js';
import { PANEL_SLOT, FOOTER_SLOT, useSidebarSlot, renderSidebarSlotItem } from '../components/sidebar-slots.js';

export function HomePage() {
  const [harness, setHarness] = useState(false);
  const [version, setVersion] = useState('');
  const panels = useSidebarSlot(PANEL_SLOT);
  const footers = useSidebarSlot(FOOTER_SLOT);

  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.onHarnessMode) anyApi.onHarnessMode((d: any) => setHarness(!!(d && d.harness)));
    if (anyApi.getAppInfo) anyApi.getAppInfo().then((r: any) => { if (r && r.success) setVersion(r.version || ''); }).catch(() => {});
  }, []);

  const newSession = useCallback(async () => {
    const anyApi = api as any;
    try {
      if (anyApi.newWebConversation) await anyApi.newWebConversation();
      else if (api.home) api.home();
    } catch (_) { /* ignore */ }
  }, []);

  const toggleHarness = useCallback(async () => {
    const anyApi = api as any;
    if (anyApi.toggleHarness) { try { await anyApi.toggleHarness(); } catch (_) {} }
  }, []);

  const openCukoWindow = useCallback(async () => {
    const anyApi = api as any;
    if (anyApi.openCukoWindow) { try { await anyApi.openCukoWindow(); } catch (_) {} }
  }, []);

  const invokeCommand = useCallback((spec: any) => {
    const anyApi = api as any;
    if (spec && spec.command && typeof anyApi.commandInvoke === 'function') anyApi.commandInvoke(spec.command).catch(() => {});
  }, []);

  // P3：DSH sidebar.panellist 项点击 → 切到 main 面板（按 id 匹配）
  const selectPanel = useCallback((id: string) => {
    try {
      const fn = (window as any).__cuckooSelectPanel;
      if (typeof fn === 'function') fn(id);
    } catch (_) {}
  }, []);

  const renderItem = (m: any) => renderSidebarSlotItem(m, { onSelectPanel: selectPanel, onInvokeCommand: invokeCommand });

  return createElement('div', { className: 'ck-tab ck-tab-active ck-home' },
    // 滚动区：品牌 + 按钮 + 插件面板
    createElement('div', { className: 'ck-home-scroll' },
      createElement('div', { style: { padding: '6px 2px 8px', display: 'flex', alignItems: 'baseline', gap: 6 } },
        createElement('span', { style: { fontSize: 20, fontWeight: 700, color: 'var(--ck-text-2)', letterSpacing: '.2px', lineHeight: 1.2 } }, 'Cuckoo Code'),
        version ? createElement('span', { style: { fontSize: 12, color: 'var(--ck-text-dim)' } }, 'v' + version) : null,
      ),
      createElement('div', { className: 'ck-actions', style: { flexDirection: 'column', gap: 10, alignItems: 'stretch' } },
        createElement(UiButton, { icon: 'M12 5v14M5 12h14', onClick: newSession }, '新建会话'),
        createElement('button', {
          className: 'ck-btn ck-btn-anim',
          onClick: openCukoWindow,
          title: '打开 Cuko API 工作窗口',
        }, createElement('span', null, 'Cuko 模式')),
        createElement('button', {
          className: 'ck-btn ck-btn-anim',
          onClick: toggleHarness,
          title: harness ? '切回原版网页' : '切换到纯净对话模式',
        }, createElement('span', null, harness ? '原页面' : '纯净页面')),
      ),
      createElement('div', { style: { height: 1, background: 'var(--ck-border)', margin: '14px 0' } }),
      createElement('div', { className: 'ck-list', id: 'ck-home-panels' },
        panels.length === 0
          ? createElement('div', { className: 'ck-list-empty' }, '暂无插件面板')
          : panels.map(renderItem),
      ),
    ),
    // 底部动作（固定，滚动不影响）
    footers.length > 0
      ? createElement('div', { className: 'ck-home-footer', id: 'ck-home-footer' }, footers.map(renderItem))
      : null,
  );
}

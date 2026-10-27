/**
 * 设置行（左标题+描述，右控件）—— 对齐 WorkBuddy 的"提示音设置"
 */
import { createElement } from 'react';

export function SettingRow({ label, desc, children }: { label: string; desc?: string; children?: any }) {
  return createElement('div', { className: 'ck-set-row' },
    createElement('div', { className: 'ck-set-row-text' },
      createElement('div', { className: 'ck-set-row-label' }, label),
      desc ? createElement('div', { className: 'ck-set-row-desc' }, desc) : null,
    ),
    children ? createElement('div', { className: 'ck-set-row-control' }, children) : null,
  );
}

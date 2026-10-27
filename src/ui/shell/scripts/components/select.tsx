/**
 * 自定义下拉选择（替代原生 select）
 *
 * 对齐 WorkBuddy 风格：触发器（圆角 + 当前值 + 箭头）+ 弹层（白底圆角 + 选项 + 当前项打勾）。
 * 零依赖，用 React + 现有 CSS 变量。
 */
import { createElement, useState, useEffect, useRef } from 'react';

export interface SelectOption { value: string; label: string; }

/** 下拉箭头 */
function Chevron({ open }: { open: boolean }) {
  return createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 },
  }, createElement('path', { d: 'M6 9l6 6 6-6' }));
}

/** 打勾图标 */
function Check() {
  return createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round',
  }, createElement('path', { d: 'M20 6L9 17l-5-5' }));
}

export function Select({ value, options, onChange, placeholder }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // ESC 关闭（不冒泡给设置模态，避免连带关掉）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return createElement('div', { className: 'ck-select' + (open ? ' open' : ''), ref: rootRef },
    createElement('div', {
      className: 'ck-select-trigger',
      onClick: () => setOpen(!open),
      tabIndex: 0,
      onKeyDown: (e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } },
    },
      createElement('span', { className: 'ck-select-value' + (current ? '' : ' ck-select-placeholder') },
        current ? current.label : (placeholder || '请选择')),
      createElement(Chevron, { open }),
    ),
    open ? createElement('div', { className: 'ck-select-menu' },
      ...options.map((o) => createElement('div', {
        key: o.value,
        className: 'ck-select-option' + (o.value === value ? ' active' : ''),
        onClick: () => { onChange(o.value); setOpen(false); },
      },
        createElement('span', null, o.label),
        o.value === value ? createElement('span', { className: 'ck-select-check' }, createElement(Check)) : null,
      )),
    ) : null,
  );
}

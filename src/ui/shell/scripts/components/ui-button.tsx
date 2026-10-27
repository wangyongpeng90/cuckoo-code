/**
 * 通用 UI 组件（feat/022-dsh-compat-c7）
 *
 * UiButton —— 参考"快捷提示词"页按钮样式（ck-btn + ck-btn-anim + 图标 + 文字），
 * 供各页复用。
 */
import { createElement } from 'react';

/** 图标 */
export function Svg({ d, cls }: { d: string; cls?: string }) {
  return createElement('svg', { className: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d }));
}

/** 通用按钮（ck-btn 风格，带图标） */
export function UiButton({ icon, children, onClick, className, style, title }: {
  icon?: string;
  children?: any;
  onClick?: () => void;
  className?: string;
  style?: any;
  title?: string;
}) {
  return createElement('button', {
    className: 'ck-btn ck-btn-anim' + (className ? ' ' + className : ''),
    onClick, style, title,
  },
    icon ? createElement(Svg, { d: icon, cls: 'ck-btn-icon' }) : null,
    children !== undefined && children !== null ? createElement('span', null, children) : null,
  );
}

/**
 * DSH UI Primitives——第一批组件（dsh-market 必需 13 个）
 *
 * 原则：**不抄 DSH 代码**——按 API 契约（props）+ 行为（交互），用 Cuckoo 的 CSS 自己实现。
 * 参考：C:\\d\\SourceCode\\2026\\deepseek-harness2\\packages\\client\\ui-primitives\\src\\
 *
 * 状态见 docs/dsh-primitives-compat.md。
 */
import { createElement, forwardRef, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ===== 内部工具 =====
function cx(...a: (string | undefined | null | false)[]): string { return a.filter(Boolean).join(' '); }

/** Button：variant=primary/ghost/outline/toolbar；size=md/sm；icon；其他 button 属性透传 */
export const Button = forwardRef<HTMLButtonElement, any>(function Button(props: any, ref) {
  const { variant = 'ghost', size = 'md', icon, className, children, ...rest } = props || {};
  return createElement('button', {
    ref, type: 'button',
    className: cx('ck-dp-btn', 'ck-dp-btn-' + variant, 'ck-dp-btn-' + size, className),
    ...rest,
  },
    icon != null ? createElement('span', { className: 'ck-dp-btn-icon' }, icon) : null,
    children);
});

/** Pill：active 高亮；button 语义 */
export const Pill = forwardRef<HTMLButtonElement, any>(function Pill(props: any, ref) {
  const { active, className, children, ...rest } = props || {};
  return createElement('button', {
    ref, type: 'button',
    className: cx('ck-dp-pill', active && 'active', className),
    ...rest,
  }, children);
});

/** Input：icon 前缀；原生 input 属性透传 */
export const Input = forwardRef<HTMLInputElement, any>(function Input(props: any, ref) {
  const { icon, className, ...rest } = props || {};
  if (icon == null) return createElement('input', { ref, className: cx('ck-dp-input', className), ...rest });
  return createElement('span', { className: 'ck-dp-input-wrap' },
    createElement('span', { className: 'ck-dp-input-icon' }, icon),
    createElement('input', { ref, className: cx('ck-dp-input', 'has-icon', className), ...rest }));
});

/** StateDot：state 决定颜色（idle/running/success/error/warn） */
export function StateDot(props: any) {
  const { state, className, ...rest } = props || {};
  return createElement('span', { className: cx('ck-dp-dot', 'ck-dp-dot-' + (state || 'idle'), className), ...rest });
}

/** Tag：只读标签；tone 决定配色 */
export function Tag(props: any) {
  const { tone = 'neutral', className, children, ...rest } = props || {};
  return createElement('span', { className: cx('ck-dp-tag', 'ck-dp-tag-' + tone, className), ...rest }, children);
}

/** DisclosureRow：可展开行（open 受控；onOpenChange） */
export function DisclosureRow(props: any) {
  const { open, onOpenChange, title, subtitle, children, className, ...rest } = props || {};
  return createElement('div', { className: cx('ck-dp-disc', open && 'open', className), ...rest },
    createElement('div', {
      className: 'ck-dp-disc-head',
      onClick: () => { if (typeof onOpenChange === 'function') onOpenChange(!open); },
    },
      createElement('span', { className: 'ck-dp-disc-arrow' }, open ? '▾' : '▸'),
      createElement('span', { className: 'ck-dp-disc-title' }, title),
      subtitle ? createElement('span', { className: 'ck-dp-disc-sub' }, subtitle) : null),
    open ? createElement('div', { className: 'ck-dp-disc-body' }, children) : null);
}

/** Switch：开关（checked 受控；onChange / onCheckedChange 都支持） */
export function Switch(props: any) {
  const { checked, onCheckedChange, onChange, className, disabled, label, title, ...rest } = props || {};
  // DSH 用 onChange，我们兼容两者
  const handler = typeof onChange === 'function' ? onChange : onCheckedChange;
  return createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': !!checked, disabled,
    'aria-label': label, title,
    className: cx('ck-dp-switch', checked && 'on', disabled && 'disabled', className),
    onClick: () => { if (!disabled && typeof handler === 'function') handler(!checked); },
    ...rest,
  }, createElement('span', { className: 'ck-dp-switch-thumb' }));
}

/** Checkbox：复选框（onChange / onCheckedChange 都支持） */
export function Checkbox(props: any) {
  const { checked, onCheckedChange, onChange, className, disabled, ...rest } = props || {};
  const handler = typeof onChange === 'function' ? onChange : onCheckedChange;
  return createElement('button', {
    type: 'button', role: 'checkbox', 'aria-checked': !!checked, disabled,
    className: cx('ck-dp-checkbox', checked && 'on', disabled && 'disabled', className),
    onClick: () => { if (!disabled && typeof handler === 'function') handler(!checked); },
    ...rest,
  }, checked ? createElement('span', { className: 'ck-dp-checkbox-mark' }, '✓') : null);
}

/** SegmentedControl：分段控件（value + onChange；options） */
export function SegmentedControl(props: any) {
  const { value, onChange, options, className, ...rest } = props || {};
  const opts = Array.isArray(options) ? options : [];
  return createElement('div', { className: cx('ck-dp-seg', className), ...rest },
    ...opts.map((o: any) => {
      const v = o && (o.value !== undefined ? o.value : o.id);
      const label = o && (o.label !== undefined ? o.label : o.text);
      return createElement('button', {
        key: String(v), type: 'button',
        className: cx('ck-dp-seg-item', v === value && 'active'),
        onClick: () => { if (typeof onChange === 'function') onChange(v); },
      }, label);
    }));
}

/** SegmentedTabs：分段 Tab（同 SegmentedControl，名字不同） */
export const SegmentedTabs = SegmentedControl;

/** Toast：轻提示（text + onDone；holdMs 可调） */
export function Toast(props: any) {
  const { text, icon, onDone, holdMs, className, style, ...rest } = props || {};
  useEffect(() => {
    if (typeof onDone !== 'function') return;
    const t = setTimeout(() => { try { onDone(); } catch (_) {} }, typeof holdMs === 'number' ? holdMs : 2400);
    return () => clearTimeout(t);
  }, [onDone, holdMs]);
  // 内联样式：防外部规则把 inline-flex/width 覆盖（DSH 的 CSS 有 display:flex 规则）
  const inlineStyle = Object.assign({
    display: 'inline-flex',
    width: 'fit-content',
    maxWidth: 'min(560px, 80vw)',
    position: 'fixed',
    left: '50%',
    bottom: '44px',
    transform: 'translateX(-50%)',
  }, style || {});
  return createElement('div', { className: cx('ck-dp-toast', className), style: inlineStyle, ...rest },
    icon != null ? createElement('span', { className: 'ck-dp-toast-icon' }, icon) : null,
    createElement('span', null, text));
}

/** Tooltip：悬浮提示（title；side） */
export function Tooltip(props: any) {
  const { title, children, className, ...rest } = props || {};
  return createElement('span', { className: cx('ck-dp-tip-wrap', className), title: typeof title === 'string' ? title : undefined, ...rest }, children);
}

/** Modal：模态框（open / onClose / title / children / footer） */
export function Modal(props: any) {
  const { open, onClose, title, description, children, footer, className, closeLabel, ...rest } = props || {};
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && typeof onClose === 'function') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const node = createElement('div', {
    className: 'ck-dp-modal-mask',
    onClick: (e: any) => { if (e.target === e.currentTarget && typeof onClose === 'function') onClose(); },
    ...rest,
  },
    // className 加在对话框本体（对齐 DSH：.dialog 接 className，mask 是独立层）
    createElement('div', { className: cx('ck-dp-modal', className), onClick: (e: any) => e.stopPropagation() },
      createElement('div', { className: 'ck-dp-modal-head' },
        createElement('span', { className: 'ck-dp-modal-title' }, title),
        createElement('button', { className: 'ck-dp-modal-close', title: closeLabel || '关闭', onClick: onClose }, '✕')),
      description ? createElement('div', { className: 'ck-dp-modal-desc' }, description) : null,
      createElement('div', { className: 'ck-dp-modal-body' }, children),
      footer ? createElement('div', { className: 'ck-dp-modal-foot' }, footer) : null));
  // 用 Portal 挂到 body——避免被祖先的 transform/overflow 约束（否则 position:fixed 会相对祖先定位）
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

/** Menu / MenuSurface / MenuGroup / MenuItemButton（下拉菜单族） */
export function Menu(props: any) {
  const { open, anchor, items, footer, selectedId, selectedIds, onSelect, onClose, align, side, className, ...rest } = props || {};
  if (!open) return null;
  const all = [...(Array.isArray(items) ? items : []), ...(Array.isArray(footer) ? footer : [])];
  const sel = selectedIds || (selectedId !== undefined ? [selectedId] : []);
  const node = createElement('div', { className: cx('ck-dp-menu-mask', className), onClick: (e: any) => { if (e.target === e.currentTarget && typeof onClose === 'function') onClose(); }, ...rest },
    createElement('div', { className: cx('ck-dp-menu', 'ck-dp-menu-' + (align || 'start'), 'ck-dp-menu-' + (side || 'bottom')) },
      anchor != null ? createElement('div', { className: 'ck-dp-menu-anchor' }, anchor) : null,
      ...all.map((it: any, i: number) => {
        const id = it && it.id;
        const type = it && it.type;
        if (type === 'separator') return createElement('div', { key: 'sep-' + i, className: 'ck-dp-menu-sep' });
        if (type === 'label') return createElement('div', { key: 'lab-' + i, className: 'ck-dp-menu-label' }, it.text);
        return createElement('button', {
          key: String(id), type: 'button',
          className: cx('ck-dp-menu-item', sel.includes(id) && 'active', it && it.danger && 'danger'),
          disabled: it && it.disabled,
          onClick: () => { if (typeof onSelect === 'function') onSelect(id); },
        },
          it && it.icon != null ? createElement('span', { className: 'ck-dp-menu-icon' }, it.icon) : null,
          createElement('span', { className: 'ck-dp-menu-text' }, it && it.label));
      })));
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}
export function MenuSurface(props: any) { return Menu(props); }
export function MenuGroup(props: any) { return Menu(props); }
export function MenuItemButton(props: any) {
  const { onClick, className, children, icon, danger, disabled, ...rest } = props || {};
  return createElement('button', {
    type: 'button', disabled,
    className: cx('ck-dp-menu-item', danger && 'danger', className),
    onClick, ...rest,
  }, icon != null ? createElement('span', { className: 'ck-dp-menu-icon' }, icon) : null, children);
}

/** HoverCard：悬浮卡片（title/content） */
export function HoverCard(props: any) {
  const { children, content, className, ...rest } = props || {};
  const [show, setShow] = useState(false);
  return createElement('span', { className: cx('ck-dp-hover-wrap', className),
    onMouseEnter: () => setShow(true), onMouseLeave: () => setShow(false), ...rest },
    children,
    show && content ? createElement('span', { className: 'ck-dp-hover-card' }, content) : null);
}

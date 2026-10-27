/**
 * DSH UI Primitives 兼容层（`@deepseek-ai/dsh-client-ui-primitives` 的替身）
 *
 * 实现策略见 docs/dsh-primitives-compat.md。
 * 本文件汇总导出——DSH 插件 require 本模块时，拿到的就是这些。
 */
export * from './icons.js';
export * from './components.js';

// ===== 常量 =====
export const DEFAULT_DIFF_MAX_LINES = 400;
export const DEFAULT_READ_MAX_LINES = 400;
export const DEFAULT_SEARCH_MAX_LINES = 200;
export const DEFAULT_TERMINAL_MAX_LINES = 200;
export const CODE_HIGHLIGHT_EXTENSIONS: string[] = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md'];
export const FISH_LOGO_PATH = '';
export const FISH_LOGO_VIEWBOX = '0 0 24 24';

// ===== 工具函数（最小实现） =====
export function fileSizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')) + ' ' + u[i];
}
export function relativeTime(_ts: any): any { return { text: '' }; }
export function rankByName(a: any, b: any): number { return String(a || '').localeCompare(String(b || '')); }
export function isDarwinDesktop(): boolean { try { return navigator.platform.toLowerCase().includes('mac'); } catch (_) { return false; } }
export function pointerModality(): string { return 'mouse'; }
export function fileExtension(p: string): string { const m = String(p || '').match(/\.([^.\/\\]+)$/); return m ? m[1].toLowerCase() : ''; }
export function classifyFileType(_p: string): string { return 'file'; }
export function classifyLinkPath(_p: string): string { return 'external'; }
export function languageForPath(_p: string): string { return 'text'; }
export function extractMarkdownPlainText(s: string): string { return String(s || ''); }
export function diffTotals(_d: any): any { return { added: 0, removed: 0 }; }
export function projectUserText(s: string): string { return String(s || ''); }
export function writeClipboard(text: string): any { try { return navigator.clipboard.writeText(String(text || '')); } catch (_) { return Promise.resolve(); } }
export function focusWithoutRing(el: any): void { try { if (el && el.focus) el.focus({ preventScroll: true }); } catch (_) {} }
export function closeTopModal(): void { /* noop */ }
export function isBehindModal(): boolean { return false; }
export function modalSelector(): string { return '[data-dsh-modal]'; }
export function observeComposition(): () => void { return () => {}; }
export function observeStickyMenuGroups(): () => void { return () => {}; }
export function settingsNumberField(spec?: any): any { return { type: 'number', ...(spec || {}) }; }
export function settingsTextField(spec?: any): any { return { type: 'text', ...(spec || {}) }; }
export class SettingsFormModel { constructor(_?: any) {} }
export function SettingsForm(props: any): any { return props && props.children != null ? props.children : null; }
export function SettingsSecretField(props: any): any { return props && props.children != null ? props.children : null; }
export function SettingsValueField(props: any): any { return props && props.children != null ? props.children : null; }

// ===== Hooks =====
export function useAnchoredPosition(): any { return { top: 0, left: 0 }; }
export function useAnchoredMaxHeight(): any { return undefined; }
export function useDismissOnOutsidePointer(_ref: any, onDismiss: any): void {
  try {
    if (typeof onDismiss !== 'function') return;
    // 简化：点击 document 即关闭（调用方自己判断 target）
    void _ref;
  } catch (_) {}
}
export function useModalLayer(): any { return {}; }
export function useCodeHighlighter(): any { return { highlight: (s: string) => s }; }

// ===== 其他组件（占位，未实现真功能） =====
export function BrandWordmark(props: any): any { return props && props.children != null ? props.children : null; }
export function ConnectionIndicator(props: any): any { return props && props.children != null ? props.children : null; }
export function FishLogo(props: any): any { return props && props.children != null ? props.children : null; }
export function InlineEditor(props: any): any { return props && props.children != null ? props.children : null; }
export function PathLabel(props: any): any { return props && props.children != null ? props.children : null; }
export function ShortcutKeys(props: any): any { return props && props.children != null ? props.children : null; }
export function TextShimmer(props: any): any { return props && props.children != null ? props.children : null; }
export function PermissionIconFullAccessMedium(props: any): any { return props && props.children != null ? props.children : null; }
export function PermissionIconFullAccessRegular(props: any): any { return props && props.children != null ? props.children : null; }
export function PermissionIconReadOnlyMedium(props: any): any { return props && props.children != null ? props.children : null; }
export function PermissionIconReadOnlyRegular(props: any): any { return props && props.children != null ? props.children : null; }
export function PermissionIconWorkspaceWriteMedium(props: any): any { return props && props.children != null ? props.children : null; }
export function PermissionIconWorkspaceWriteRegular(props: any): any { return props && props.children != null ? props.children : null; }
export function ReferenceIconMedium(props: any): any { return props && props.children != null ? props.children : null; }
export function ReferenceIconRegular(props: any): any { return props && props.children != null ? props.children : null; }
export function LinkIconMedium(props: any): any { return props && props.children != null ? props.children : null; }
export function LinkIconRegular(props: any): any { return props && props.children != null ? props.children : null; }
export function FileTypeIcon(props: any): any { return props && props.children != null ? props.children : null; }

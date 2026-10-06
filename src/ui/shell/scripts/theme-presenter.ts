/**
 * 壳页面主题呈现层（对标 DSH ThemePresenter）
 *
 * 消费主进程推来的 ThemeSnapshot，投影到 DOM：
 *   - html[color-scheme]        供原生控件（滚动条/表单）跟随
 *   - body[data-ck-dark]        供 CSS 选深色调色板
 *   - body.style 的 --ck-* 变量 激活主题的 token 覆盖
 * 只撤自己写的（记录 appliedTokens），不碰别人的属性/样式。
 */
import { api } from './shared.js';

interface ThemeDefinition {
  id: string;
  colorScheme: 'light' | 'dark';
  tokens: Record<string, string>;
}
interface ThemeSnapshot {
  preference: string;
  active: ThemeDefinition;
  themes: readonly ThemeDefinition[];
  revision: number;
}

export const DARK_ATTRIBUTE = 'data-ck-dark';
export const THEME_SOURCE_ATTRIBUTE = 'data-ck-theme-source';

let appliedTokens: string[] = [];

/** 把快照投影到 DOM */
export function applyTheme(snapshot: ThemeSnapshot): void {
  if (!snapshot || !snapshot.active) return;
  const scheme = snapshot.active.colorScheme;
  document.documentElement.style.colorScheme = scheme;
  document.documentElement.setAttribute(
    THEME_SOURCE_ATTRIBUTE,
    snapshot.preference === 'system' ? 'system' : scheme,
  );
  const body = document.body;
  if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '');
  else body.removeAttribute(DARK_ATTRIBUTE);

  // 撤销上一轮本 presenter 写的 token，再写新的
  for (const name of appliedTokens) body.style.removeProperty(name);
  appliedTokens = [];
  for (const [name, value] of Object.entries(snapshot.active.tokens || {})) {
    body.style.setProperty(name, value);
    appliedTokens.push(name);
  }
}

/** 撤掉本 presenter 写的所有东西 */
export function disposeTheme(): void {
  document.documentElement.style.removeProperty('color-scheme');
  document.documentElement.removeAttribute(THEME_SOURCE_ATTRIBUTE);
  const body = document.body;
  body.removeAttribute(DARK_ATTRIBUTE);
  for (const name of appliedTokens) body.style.removeProperty(name);
  appliedTokens = [];
}

/** 初始化：拉一次当前快照 + 订阅变化 */
export function initThemePresenter(): void {
  const anyApi = api as any;
  if (typeof anyApi.onThemeChanged === 'function') {
    anyApi.onThemeChanged((snap: ThemeSnapshot) => {
      try { applyTheme(snap); } catch (_) { /* ignore */ }
    });
  }
  if (typeof anyApi.themeGet === 'function') {
    anyApi.themeGet().then((r: any) => {
      if (r && r.success && r.snapshot) applyTheme(r.snapshot);
    }).catch(() => {});
  }
  if (typeof anyApi.themeSubscribe === 'function') {
    anyApi.themeSubscribe().catch(() => {});
  }
}

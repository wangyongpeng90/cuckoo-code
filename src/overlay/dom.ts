/**
 * 安全 DOM 构建助手：替代 innerHTML 拼接。
 * 核心安全属性：字符串子节点一律走 textNode（天然转义），杜绝 HTML 注入。
 * 只支持显式列出的 props；未知 props 直接抛错，防止 onclick 之类拼写静默失效。
 */

export type DomChild = Node | string | null | undefined;

export interface DomProps {
  class?: string;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  [key: `on${string}`]: ((e: Event) => void) | undefined;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: DomProps | null,
  ...children: DomChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null) continue;
      if (key === 'class') {
        el.className = String(value);
      } else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value as Record<string, string>)) el.dataset[k] = v;
      } else if (key === 'style') {
        Object.assign(el.style, value);
      } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else {
        throw new Error(`h(): unsupported prop "${key}"`);
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function clearChildren(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildrenOf(el: Node, ...nodes: DomChild[]): void {
  clearChildren(el);
  appendChildren(el, nodes);
}

function appendChildren(el: Node, children: DomChild[]): void {
  for (const child of children) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

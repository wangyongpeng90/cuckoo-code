/**
 * 消息折叠：把软件发给 DeepSeek 的内容在页面上折叠起来，避免占据对话流。
 *
 * 折叠两类：
 *  1. 用户消息「【JS 执行结果汇总】…」→ 折叠成一行 + 展开按钮
 *  2. AI 回复里的 cuckoo 代码块 → 折叠成一行 + 展开按钮
 *
 * 实现（保守，纯 CSS 为主）：
 *  - 只给目标元素加 class，不搬移/删除原 DOM
 *  - 用 CSS max-height 裁剪 + 独立的展开按钮（插在目标内部末尾）
 *  - 不破坏 DeepSeek 的 React 结构
 */

/** 折叠 class */
const FOLD_CLASS = 'cuckoo-msg-folded';
/** 展开按钮 class */
const TOGGLE_CLASS = 'cuckoo-fold-toggle';
/** 用户消息特征 */
const MSG_PREFIX = '【JS 执行结果汇总】';
/** 标记：已处理（避免重复） */
const DONE_ATTR = 'data-cuckoo-fold-done';

/** 注入折叠样式（幂等） */
function injectFoldStyle(): void {
  if (document.getElementById('cuckoo-fold-style')) return;
  const style = document.createElement('style');
  style.id = 'cuckoo-fold-style';
  style.textContent =
    // 折叠块：淡色边框 + 圆角，框离文字间距 1px
    '.' + FOLD_CLASS + ' { border: 1px solid rgba(139,147,255,0.28); border-radius: 10px; padding: 1px; }' +
    // 去掉内部气泡的灰底/边框（DeepSeek 用户消息自带），只保留 FOLD_CLASS 自身边框
    '.' + FOLD_CLASS + ' *:not(.' + FOLD_CLASS + ') { background: transparent !important; border-color: transparent !important; box-shadow: none !important; outline: none !important; }' +
    // 折叠块内文字缩小 4px（DeepSeek 默认约 15px → 11px）
    '.' + FOLD_CLASS + ' *:not(.' + TOGGLE_CLASS + ') { font-size: 11px !important; }' +
    // 边框与文字间距 1px
    '.' + FOLD_CLASS + ' { padding: 1px !important; }' +
    // 压缩行高，去掉文字上下多余空白，让框贴合文字（上下各 1px）
    '.' + FOLD_CLASS + ' *:not(.' + TOGGLE_CLASS + ') { line-height: 1.1 !important; margin-top: 0 !important; margin-bottom: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; }' +
    // 复制/下载等图标按钮缩小 3px（svg 尺寸）
    '.' + FOLD_CLASS + ' svg { width: 13px !important; height: 13px !important; }' +
    // 图标按钮内文字/按钮整体缩小 3px
    '.' + FOLD_CLASS + ' [class*="ds-button"] { font-size: 9px !important; }' +
    // 折叠态：裁剪高度
    '.' + FOLD_CLASS + '[data-collapsed="true"] { max-height: 18px !important; overflow: hidden !important; position: relative; }' +
    // 底部渐变遮罩提示还有内容
    '.' + FOLD_CLASS + '[data-collapsed="true"]::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 28px; background: linear-gradient(transparent, rgba(255,255,255,0.9)); pointer-events: none; }' +
    // 展开按钮（字号 9px，比原来小 3px）
    '.' + TOGGLE_CLASS + ' { display: inline-flex; align-items: center; gap: 4px; margin: 4px 0; padding: 3px 10px; border-radius: 8px; cursor: pointer; background: rgba(139,147,255,0.12); border: 1px solid rgba(139,147,255,0.3); color: #6d76ff; font-size: 9px; user-select: none; }' +
    '.' + TOGGLE_CLASS + ':hover { background: rgba(139,147,255,0.22); }';
  document.head.appendChild(style);
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 已处理元素 */
const processed = new WeakSet<Element>();

/** 给目标元素加折叠 + 展开按钮 */
function applyFold(el: HTMLElement, label: string): void {
  if (processed.has(el)) return;
  if (el.getAttribute(DONE_ATTR)) return;
  processed.add(el);
  el.setAttribute(DONE_ATTR, '1');
  el.classList.add(FOLD_CLASS);
  el.setAttribute('data-collapsed', 'true');

  // 展开按钮：插在目标元素末尾（内部，最小影响）
  const btn = document.createElement('div');
  btn.className = TOGGLE_CLASS;
  btn.textContent = '▶ ' + label + '（点击展开）';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = el.getAttribute('data-collapsed') === 'true';
    el.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    btn.textContent = collapsed ? '▼ ' + label + '（点击收起）' : '▶ ' + label + '（点击展开）';
  });
  el.appendChild(btn);
}

/** 扫描并折叠 */
function foldAll(): void {
  if (_running) return;
  _running = true;
  try {
    // 1. 折叠「【JS 执行结果汇总】」用户消息（消息项 = 虚拟列表的直接子元素）
    const listRoot = document.querySelector('.ds-virtual-list-visible-items') ||
      document.querySelector('[class*="visible-items"]');
    if (listRoot) {
      for (const item of Array.from(listRoot.children)) {
        const it = item as HTMLElement;
        if (it.getAttribute(DONE_ATTR)) continue;
        const t = it.textContent || '';
        if (!t.includes(MSG_PREFIX)) continue;
        // 从文本解析工具数
        const m = t.match(/\(共\s*(\d+)\s*个脚本\)/);
        const n = m ? m[1] : '?';
        applyFold(it, '工具调用 (' + n + ')');
      }
    }

    // 2. 折叠 AI 回复里的 cuckoo 代码块
    const codeBlocks = document.querySelectorAll('.md-code-block');
    for (const cb of Array.from(codeBlocks)) {
      const el = cb as HTMLElement;
      if (el.getAttribute(DONE_ATTR)) continue;
      const text = el.textContent || '';
      const isCuckoo = /\bawait\s+(read|readLines|write|edit|glob|grep|bash|pwsh|todoWrite|deleteFile|webFetch|mysql|mcpCall|mcpListServers|mcpGetTools|openBrowserWindow|injectJS|attachFile|runAgent)\s*\(/.test(text)
        || /cuckoo/i.test(text);
      if (!isCuckoo) continue;
      applyFold(el, '工具调用代码');
    }
  } finally {
    _running = false;
  }
}

let _observer: MutationObserver | null = null;
let _initDone = false;
let _running = false;

/**
 * 启动消息折叠（幂等）。
 */
function initMessageFold(): void {
  if (_initDone) return;
  _initDone = true;
  try {
    injectFoldStyle();
    foldAll();
    let timer: any = null;
    _observer = new MutationObserver(() => {
      if (_running) return;
      if (timer) return;
      timer = setTimeout(() => { timer = null; foldAll(); }, 800);
    });
    const root = document.documentElement || document.body;
    if (root) _observer.observe(root, { childList: true, subtree: true });
    // 定时兜底：每 3 秒扫一次
    setInterval(() => { try { foldAll(); } catch (_) {} }, 3000);
    console.log('[Cuckoo Code] 消息折叠已启动（CSS 折叠）');
  } catch (err) {
    console.error('[Cuckoo Code] 启动消息折叠失败:', err);
  }
}

/** 兼容旧导出 */
function makeMarker(): string { return ''; }

export { initMessageFold, makeMarker };

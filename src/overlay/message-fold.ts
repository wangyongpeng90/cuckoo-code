/**
 * 消息折叠：把软件发给 DeepSeek 的内容在 DeepSeek 原生页面上渲染成"工具调用卡片"
 * （仿纯净对话模式 harness 的卡片样式），避免长文本占据对话流。
 *
 * 折叠对象：
 *  1. 用户消息「【JS 执行结果汇总】…」→ 工具卡片（含各工具状态）
 *  2. AI 回复里的 cuckoo 代码块 → 工具卡片
 *
 * 实现：给目标元素加 class + 插入卡片头部，用 CSS 控制展开/收起。
 */

const FOLD_CLASS = 'ck-tool';
const DONE_ATTR = 'data-ck-tool';
const MSG_PREFIX = '【JS 执行结果汇总】';

/** 注入样式（仿 harness 工具卡片） */
function injectStyle(): void {
  if (document.getElementById('ck-tool-style')) return;
  const style = document.createElement('style');
  style.id = 'ck-tool-style';
  style.textContent =
    '.' + FOLD_CLASS + ' { margin: 8px 0; }' +
    '.' + FOLD_CLASS + '-card { border: 1px solid rgba(128,128,128,0.25); border-radius: 8px; overflow: hidden; background: rgba(128,128,128,0.04); }' +
    '.' + FOLD_CLASS + '-head { display: flex; align-items: center; gap: 9px; padding: 8px 12px; cursor: pointer; user-select: none; }' +
    '.' + FOLD_CLASS + '-head:hover { background: rgba(128,128,128,0.08); }' +
    '.' + FOLD_CLASS + '-icon { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.65; }' +
    '.' + FOLD_CLASS + '-name { font-size: 12px; font-weight: 600; font-family: ui-monospace,Consolas,monospace; flex-shrink: 0; }' +
    '.' + FOLD_CLASS + '-arg { flex: 1; font-size: 12px; opacity: 0.6; font-family: ui-monospace,Consolas,monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
    '.' + FOLD_CLASS + '-badge { font-size: 10px; padding: 1.5px 6px; border-radius: 4px; font-weight: 600; flex-shrink: 0; }' +
    '.' + FOLD_CLASS + '-badge.ok { background: rgba(127,176,105,0.18); color: #6aa84f; }' +
    '.' + FOLD_CLASS + '-badge.err { background: rgba(224,108,117,0.18); color: #e06c75; }' +
    '.' + FOLD_CLASS + '-caret { flex-shrink: 0; transition: transform 0.15s; font-size: 10px; opacity: 0.6; }' +
    '.' + FOLD_CLASS + '[data-open="true"] .' + FOLD_CLASS + '-caret { transform: rotate(90deg); }' +
    // 折叠态：隐藏原消息内容，只留卡片头
    '[' + DONE_ATTR + '] > *:not(.' + FOLD_CLASS + ') { display: none !important; }' +
    '[' + DONE_ATTR + '][data-open="true"] > *:not(.' + FOLD_CLASS + ') { display: revert !important; }' +
    // 组内非首元素：收起时整条隐藏（避免空行），展开时显示
    '[' + DONE_ATTR + '][data-ck-sub="true"][data-open="false"] { display: none !important; }';
  document.head.appendChild(style);
}

/** HTML 转义 */
function esc(s: string): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 解析「【JS 执行结果汇总】」里的工具明细 */
function parseTools(text: string): Array<{ t: string; ok: boolean }> {
  const tools: Array<{ t: string; ok: boolean }> = [];
  const parts = text.split(/——\s*脚本\s*\d+\s*——/);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const ok = seg.includes('✅');
    const m = seg.match(/await\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    tools.push({ t: m ? m[1] : 'tool', ok });
  }
  if (tools.length === 0) {
    const totalMatch = text.match(/\(共\s*(\d+)\s*个脚本\)/);
    const n = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    for (let i = 0; i < n; i++) tools.push({ t: 'tool', ok: true });
  }
  return tools;
}

const processed = new WeakSet<Element>();

/** 把"一组连续元素"合并成一个工具卡片（标题显示总数，点击展开整组） */
function applyGroupCard(els: HTMLElement[], tools: Array<{ t: string; ok: boolean }>): void {
  const firstEl = els[0];
  if (!firstEl) return;
  // 抗重建：若首元素已有卡片头，说明已折叠过，跳过
  if (firstEl.querySelector(':scope > .' + FOLD_CLASS)) return;

  // 标记所有元素；非首元素标记为"子项"（收起时整条隐藏）
  els.forEach((el, i) => {
    el.setAttribute(DONE_ATTR, '');
    el.setAttribute('data-open', 'false');
    if (i > 0) el.setAttribute('data-ck-sub', 'true');
  });

  const okCount = tools.filter((x) => x.ok).length;
  const allOk = okCount === tools.length;
  const toolCount = tools.length;

  const head = document.createElement('div');
  head.className = FOLD_CLASS + '-head';
  head.innerHTML =
    '<span class="' + FOLD_CLASS + '-icon">🔧</span>' +
    '<span class="' + FOLD_CLASS + '-name">tool</span>' +
    '<span class="' + FOLD_CLASS + '-arg">' + toolCount + ' 个工具</span>' +
    '<span class="' + FOLD_CLASS + '-badge ' + (allOk ? 'ok' : 'err') + '">' + (allOk ? '完成' : (okCount + '/' + toolCount)) + '</span>' +
    '<span class="' + FOLD_CLASS + '-caret">▶</span>';

  const wrap = document.createElement('div');
  wrap.className = FOLD_CLASS;
  wrap.appendChild(head);
  firstEl.insertBefore(wrap, firstEl.firstChild);

  head.addEventListener('click', (e) => {
    e.stopPropagation();
    // 整组一起展开/收起
    const open = firstEl.getAttribute('data-open') === 'true';
    for (const el of els) el.setAttribute('data-open', open ? 'false' : 'true');
  });
}

/** 扫描并折叠 */
/** 折叠单个元素（代码块）为卡片 */
function applySingleCard(el: HTMLElement): void {
  if (!el || el.querySelector(':scope > .' + FOLD_CLASS)) return;
  el.setAttribute(DONE_ATTR, '');
  el.setAttribute('data-open', 'false');

  const head = document.createElement('div');
  head.className = FOLD_CLASS + '-head';
  head.innerHTML =
    '<span class="' + FOLD_CLASS + '-icon">🔧</span>' +
    '<span class="' + FOLD_CLASS + '-name">tool</span>' +
    '<span class="' + FOLD_CLASS + '-arg">工具调用代码</span>' +
    '<span class="' + FOLD_CLASS + '-badge ok">完成</span>' +
    '<span class="' + FOLD_CLASS + '-caret">▶</span>';

  const wrap = document.createElement('div');
  wrap.className = FOLD_CLASS;
  wrap.appendChild(head);
  el.insertBefore(wrap, el.firstChild);

  head.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = el.getAttribute('data-open') === 'true';
    el.setAttribute('data-open', open ? 'false' : 'true');
  });
}

/** 扫描并折叠：把"连续"的「JS 执行结果汇总」消息合并成一个卡片 */
function foldAll(): void {
  if (_running) return;
  _running = true;
  try {
    const listRoot = document.querySelector('.ds-virtual-list-visible-items') ||
      document.querySelector('[class*="visible-items"]');
    if (listRoot) {
      const items = Array.from(listRoot.children) as HTMLElement[];
      let group: HTMLElement[] = [];
      let groupTools: Array<{ t: string; ok: boolean }> = [];
      const flush = () => {
        if (group.length > 0) {
          applyGroupCard(group, groupTools);
          group = [];
          groupTools = [];
        }
      };
      for (const it of items) {
        const t = it.textContent || '';
        const isResult = t.includes(MSG_PREFIX);
        if (isResult) {
          group.push(it);
          // 仅对"未折叠"的元素解析工具（已折叠的只作为组延续，不重复累加）
          if (!it.querySelector(':scope > .' + FOLD_CLASS)) {
            groupTools = groupTools.concat(parseTools(t));
          }
        } else {
          flush();
        }
      }
      flush();
    }
    // 折叠 AI 回复里的 cuckoo / 工具调用代码块 → 卡片
    document.querySelectorAll('.md-code-block').forEach((cb) => {
      const el = cb as HTMLElement;
      if (el.querySelector(':scope > .' + FOLD_CLASS)) return; // 已折叠
      const text = el.textContent || '';
      const isCuckoo = /\bawait\s+(read|readLines|write|edit|glob|grep|bash|pwsh|todoWrite|deleteFile|webFetch|mysql|mcpCall|mcpListServers|mcpGetTools|openBrowserWindow|injectJS|attachFile|runAgent)\s*\(/.test(text)
        || /log\s*\(/.test(text)
        || /cuckoo/i.test(text);
      if (!isCuckoo) return;
      applySingleCard(el);
    });
  } finally {
    _running = false;
  }
  dumpState('foldAll');
}

let _observer: MutationObserver | null = null;
let _initDone = false;
let _running = false;

/** 临时探测（用完删除）：写状态到文件 */
function dumpState(phase: string, extra?: any): void {
  try {
    const api = (window as any).electronAPI;
    if (api && api.dumpDom) {
      const root = document.querySelector('.ds-virtual-list-visible-items');
      const all = root ? Array.from(root.children) : [];
      const items = all.filter((el) => (el.textContent || '').includes(MSG_PREFIX)).length;
      // 每条消息项：文本前 30 字 + 是否有卡片头
      const previews = all.map((el) => ({
        txt: (el.textContent || '').slice(0, 30),
        hasCard: !!(el.querySelector && el.querySelector(':scope > .' + FOLD_CLASS)),
        hasAttr: el.getAttribute ? !!el.getAttribute(DONE_ATTR) : false,
        childCount: el.children ? el.children.length : 0,
      })).slice(0, 8);
      api.dumpDom({ phase, url: location.href, rootFound: !!root, itemCount: all.length, resultItems: items, cards: document.querySelectorAll('.' + FOLD_CLASS + '-head').length, previews }).catch(() => {});
    }
  } catch (_) {}
}

/** 启动消息折叠（幂等） */
function initMessageFold(): void {
  if (_initDone) return;
  _initDone = true;
  try {
    injectStyle();
    foldAll();
    dumpState('init');
    let timer: any = null;
    _observer = new MutationObserver(() => {
      if (_running) return;
      if (timer) return;
      timer = setTimeout(() => { timer = null; foldAll(); }, 800);
    });
    const root = document.documentElement || document.body;
    if (root) _observer.observe(root, { childList: true, subtree: true });
    setInterval(() => { try { foldAll(); } catch (_) {} }, 3000);
    console.log('[Cuckoo Code] 消息折叠已启动');
  } catch (err) {
    console.error('[Cuckoo Code] 启动消息折叠失败:', err);
  }
}

function makeMarker(): string { return ''; }

export { initMessageFold, makeMarker };


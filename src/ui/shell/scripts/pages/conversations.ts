/**
 * 对话页：读网页端会话列表（DOM 读取，实时同步网页），切换 / 新建 / 刷新。
 * harness 生成中禁用切换（运行安全）。
 */
import { api, escapeHtml, escapeAttr } from '../shared.js';

let harnessBusy = false; // harness 生成中 → 禁用对话切换

function applyBusyState(): void {
  const listEl = document.getElementById('conv-list');
  if (!listEl) return;
  listEl.querySelectorAll('.ck-conv-item').forEach((el) => {
    el.classList.toggle('ck-conv-disabled', harnessBusy);
  });
}

// retainOnEmpty=true：读到空时保留旧列表（页面正在导航/DOM 未就绪时避免误清空）
export async function loadConversations(retainOnEmpty?: boolean): Promise<void> {
  const listEl = document.getElementById('conv-list');
  if (!listEl || !api.listWebSessions) return;
  let res: any = null;
  try { res = await api.listWebSessions(); } catch (_) { res = null; }
  const sessions: any[] = (res && res.success && Array.isArray(res.sessions)) ? res.sessions : [];
  const curUrl: string = (res && res.currentUrl) || '';
  if (!sessions.length) {
    if (retainOnEmpty) return; // 保留现有列表
    if (listEl.querySelector('.ck-conv-item')) return; // 已有内容也不清
    listEl.innerHTML = '<div class="ck-list-empty">加载中…（若持续为空，请点刷新）</div>';
    return;
  }
  listEl.innerHTML = sessions.map((s) => {
    const active = (s.href === curUrl) ? ' ck-conv-active' : '';
    return '<div class="ck-conv-item' + active + '" data-url="' + escapeAttr(s.href) + '" title="' + escapeAttr(s.title) + '">' +
      '<span class="ck-conv-title">' + escapeHtml(s.title) + '</span>' +
      '</div>';
  }).join('');
  listEl.querySelectorAll('.ck-conv-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (harnessBusy) return; // 运行中：禁止切换对话
      const url = el.getAttribute('data-url');
      if (url && api.navigateWebSession) {
        api.navigateWebSession(url);
        listEl.querySelectorAll('.ck-conv-item').forEach((x) => x.classList.remove('ck-conv-active'));
        el.classList.add('ck-conv-active');
      }
    });
  });
  applyBusyState();
}

// 导航后延迟多次重试读取（网页导航中 DOM 未就绪 → 等加载完再读）
function reloadConversationsAfterNav(): void {
  loadConversations(true);
  setTimeout(() => loadConversations(true), 800);
  setTimeout(() => loadConversations(true), 1800);
  setTimeout(() => loadConversations(false), 3200);
}

document.getElementById('conv-refresh')?.addEventListener('click', () => loadConversations());

document.getElementById('conv-new')?.addEventListener('click', () => {
  if (api.newWebConversation) api.newWebConversation().then(() => reloadConversationsAfterNav());
});

// 网页导航变化 → 自动刷新对话列表（切换对话时同步高亮）
if (api.onHarnessBusy) api.onHarnessBusy((busy) => { harnessBusy = busy; applyBusyState(); });
if (api.onWebUrlChanged) api.onWebUrlChanged(() => {
  const panel = document.querySelector('.ck-tab[data-panel="conversations"]');
  if (panel && panel.classList.contains('ck-tab-active')) { try { reloadConversationsAfterNav(); } catch (_) { /* ignore */ } }
});

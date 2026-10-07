/**
 * 对话记录页：列出所有对话记录文件（当前项目 + 未绑定项目），点击查看完整内容。
 */
import { api, escapeHtml, escapeAttr } from '../shared.js';

export async function loadRecords(): Promise<void> {
  showListView();
  const listEl = document.getElementById('rec-list');
  if (!listEl || !(api as any).listConversationRecords) return;
  listEl.innerHTML = '<div class="ck-list-empty">加载中…</div>';
  try {
    const r: any = await (api as any).listConversationRecords();
    const items: any[] = (r && r.success && Array.isArray(r.items)) ? r.items : [];
    if (!items.length) {
      listEl.innerHTML = '<div class="ck-list-empty">暂无对话记录<br>在 DeepSeek 里对话后自动生成</div>';
      return;
    }
    listEl.innerHTML = items.map((it) => {
      const kb = Math.round((it.size || 0) / 1024);
      const time = it.mtime ? new Date(it.mtime).toLocaleString('zh-CN') : '';
      return '<div class="ck-conv-item" data-path="' + escapeAttr(it.path) + '" data-label="' + escapeAttr(it.file) + '">' +
        '<span class="ck-conv-title">' + escapeHtml(it.file) + '</span>' +
        '<span style="font-size:11px;color:var(--ck-text-dim);">' + escapeHtml(it.label) + ' · ' + kb + 'KB · ' + escapeHtml(time) + '</span>' +
      '</div>';
    }).join('');
    listEl.querySelectorAll('.ck-conv-item').forEach((el) => {
      el.addEventListener('click', () => openRecord(el.getAttribute('data-path') || '', el.getAttribute('data-label') || ''));
    });
  } catch (_) {
    listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>';
  }
}

async function openRecord(path: string, label: string): Promise<void> {
  const viewer = document.getElementById('rec-viewer');
  const listEl = document.getElementById('rec-list');
  const titleEl = document.getElementById('rec-viewer-title');
  const contentEl = document.getElementById('rec-content');
  if (!viewer || !contentEl) return;
  if (titleEl) titleEl.textContent = label || '';
  contentEl.textContent = '加载中…';
  if (listEl) listEl.style.display = 'none';
  viewer.style.display = '';
  try {
    const r: any = await (api as any).readConversationRecord(path);
    if (!r || !r.success) { contentEl.textContent = '读取失败: ' + ((r && r.error) || '未知'); return; }
    contentEl.textContent = r.content || '(空)';
    if (r.truncated) contentEl.textContent = '（文件较大，仅显示末尾部分）\n\n' + contentEl.textContent;
  } catch (err: any) {
    contentEl.textContent = '读取失败: ' + (err && err.message);
  }
}

function showListView(): void {
  const viewer = document.getElementById('rec-viewer');
  const listEl = document.getElementById('rec-list');
  if (viewer) viewer.style.display = 'none';
  if (listEl) listEl.style.display = '';
}

document.getElementById('rec-refresh')?.addEventListener('click', () => { loadRecords(); });
document.getElementById('rec-back')?.addEventListener('click', showListView);

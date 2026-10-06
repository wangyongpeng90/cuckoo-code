/**
 * 记忆（Memories）页：列表、新建、编辑、删除。
 */
import { api, ckAlert, ckConfirm, ckPrompt, escapeHtml, escapeAttr } from '../shared.js';

let memories: any[] = [];

export async function loadMemories(): Promise<void> {
  if (!api.listMemories) return;
  try {
    const res = await api.listMemories();
    memories = (res && res.success && Array.isArray(res.memories)) ? res.memories : [];
  } catch (_) { memories = []; }
  renderMemories();
}

function renderMemories(): void {
  const listEl = document.getElementById('mem-list');
  if (!listEl) return;
  if (!memories.length) {
    listEl.innerHTML = '<div class="ck-list-empty">还没有记忆，点上方新建，或让 AI 用 remember 工具记</div>';
    return;
  }
  listEl.innerHTML = memories.map((m: any) => {
    return '<div class="ck-snip-item" data-id="' + escapeAttr(m.id) + '">' +
      '<div class="ck-snip-top">' +
        '<span class="ck-snip-name">' + escapeHtml(m.text) + '</span>' +
        '<div class="ck-snip-actions">' +
          '<button class="ck-snip-icon-btn" data-edit="' + escapeAttr(m.id) + '" title="编辑">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
          '</button>' +
          '<button class="ck-snip-icon-btn danger" data-del="' + escapeAttr(m.id) + '" title="删除">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  listEl.querySelectorAll('[data-edit]').forEach((btn: any) => {
    btn.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      const m = memories.filter((x: any) => x.id === btn.dataset.edit)[0];
      if (!m) return;
      const text = await ckPrompt({ title: '编辑记忆', value: m.text });
      if (text === null) return;
      const t = text.trim();
      if (!t) { await ckAlert('内容不能为空'); return; }
      memories = memories.map((x: any) => x.id === m.id ? { ...x, text: t } : x);
      if (api.saveMemories) { try { await api.saveMemories(memories); } catch (_) {} }
      renderMemories();
    });
  });
  listEl.querySelectorAll('[data-del]').forEach((btn: any) => {
    btn.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const m = memories.filter((x: any) => x.id === id)[0];
      if (!(await ckConfirm('确定删除记忆「' + (m ? m.text : '') + '」？'))) return;
      if (api.deleteMemory) { try { await api.deleteMemory(id); } catch (_) {} }
      await loadMemories();
    });
  });
}

document.getElementById('mem-add')?.addEventListener('click', async () => {
  const text = await ckPrompt({ title: '新建记忆', placeholder: '如：用户偏好用中文回复' });
  if (text === null) return;
  const t = text.trim();
  if (!t) { await ckAlert('内容不能为空'); return; }
  if (api.addMemory) { try { await api.addMemory(t); } catch (_) {} }
  await loadMemories();
});
document.getElementById('mem-refresh')?.addEventListener('click', loadMemories);

if (api.onMemoriesChanged) {
  api.onMemoriesChanged(() => { loadMemories(); });
}

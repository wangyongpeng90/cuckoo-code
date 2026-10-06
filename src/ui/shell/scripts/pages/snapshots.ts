/**
 * 快照（Snapshots）页：列表、创建、恢复、删除。
 */
import { api, ckAlert, ckConfirm, ckPrompt, escapeHtml, escapeAttr } from '../shared.js';

let snapshots: any[] = [];
let currentProjectDir: string | null = null;

export async function loadSnapshots(): Promise<void> {
  if (!api.listSnapshots) return;
  try {
    if (api.getProjectDir) {
      const pr = await api.getProjectDir();
      currentProjectDir = (pr && pr.dir) ? pr.dir : null;
    }
  } catch (_) { /* ignore */ }
  try {
    const res = await api.listSnapshots(currentProjectDir || undefined);
    snapshots = (res && res.success && Array.isArray(res.snapshots)) ? res.snapshots : [];
  } catch (_) { snapshots = []; }
  renderSnapshots();
}

function fmtTime(ts: number): string {
  try { return new Date(ts).toLocaleString('zh-CN'); } catch (_) { return ''; }
}
function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function renderSnapshots(): void {
  const listEl = document.getElementById('snap-list');
  if (!listEl) return;
  if (!snapshots.length) {
    listEl.innerHTML = '<div class="ck-list-empty">暂无快照，点上方创建，或让 AI 用 createSnapshot 工具</div>';
    return;
  }
  listEl.innerHTML = snapshots.map((s: any) => {
    return '<div class="ck-snip-item" data-id="' + escapeAttr(s.id) + '">' +
      '<div class="ck-snip-top">' +
        '<span class="ck-snip-name">' + escapeHtml(s.name) + '</span>' +
        '<div class="ck-snip-actions">' +
          '<button class="ck-snip-icon-btn" data-restore="' + escapeAttr(s.id) + '" title="恢复">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>' +
          '</button>' +
          '<button class="ck-snip-icon-btn danger" data-del="' + escapeAttr(s.id) + '" title="删除">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<span class="ck-snip-preview">' + s.fileCount + ' 个文件 · ' + fmtSize(s.totalBytes || 0) + ' · ' + fmtTime(s.createdAt) + (s.description ? ' · ' + escapeHtml(s.description) : '') + '</span>' +
    '</div>';
  }).join('');

  listEl.querySelectorAll('[data-restore]').forEach((btn: any) => {
    btn.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      const id = btn.dataset.restore;
      const s = snapshots.filter((x: any) => x.id === id)[0];
      if (!(await ckConfirm('确定把快照「' + (s ? s.name : '') + '」恢复到项目目录？\n\n⚠️ 将覆盖项目中的同名文件，当前未保存的改动可能丢失。'))) return;
      if (api.restoreSnapshot) { try { await api.restoreSnapshot(id); } catch (_) {} }
      await ckAlert('已恢复');
    });
  });
  listEl.querySelectorAll('[data-del]').forEach((btn: any) => {
    btn.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const s = snapshots.filter((x: any) => x.id === id)[0];
      if (!(await ckConfirm('确定删除快照「' + (s ? s.name : '') + '」？'))) return;
      if (api.deleteSnapshot) { try { await api.deleteSnapshot(id); } catch (_) {} }
      await loadSnapshots();
    });
  });
}

document.getElementById('snap-add')?.addEventListener('click', async () => {
  if (!currentProjectDir) { await ckAlert('请先选择项目目录'); return; }
  const name = await ckPrompt({ title: '创建快照', placeholder: '如：重构前', value: '快照-' + new Date().toLocaleString('zh-CN') });
  if (name === null) return;
  const n = name.trim();
  if (!n) { await ckAlert('名称不能为空'); return; }
  if (api.createSnapshot) {
    try {
      const r = await api.createSnapshot(currentProjectDir, n);
      if (r && !r.success) { await ckAlert('创建失败：' + (r.error || '')); }
    } catch (_) {}
  }
  await loadSnapshots();
});
document.getElementById('snap-refresh')?.addEventListener('click', loadSnapshots);

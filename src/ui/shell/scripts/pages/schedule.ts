/**
 * 定时任务页：管理定时给 AI 发提示词的任务。
 */
import { api, escapeHtml, ckConfirm } from '../shared.js';

let tasks: any[] = [];

export async function loadScheduledTasks(): Promise<void> {
  const listEl = document.getElementById('sched-list');
  if (!listEl || !(api as any).listScheduledTasks) return;
  try {
    const r: any = await (api as any).listScheduledTasks();
    tasks = (r && r.success && Array.isArray(r.tasks)) ? r.tasks : [];
    render();
  } catch (_) { listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>'; }
}

function render(): void {
  const listEl = document.getElementById('sched-list')!;
  if (!tasks.length) { listEl.innerHTML = '<div class="ck-list-empty">暂无定时任务<br>点「＋ 新建」添加</div>'; return; }
  listEl.innerHTML = tasks.map((t: any, i: number) => {
    const dot = t.enabled ? 'var(--ck-green)' : 'var(--ck-text-dim)';
    return '<div class="ck-skill-item"><div class="ck-skill-top"><span class="ck-skill-name">' + escapeHtml(t.name || '未命名') + '</span>' +
      '<span style="font-size:12px;color:var(--ck-text-2);">' + escapeHtml(t.time || '') + '</span>' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + dot + ';flex-shrink:0;"></span></div>' +
      '<div style="font-size:12px;color:var(--ck-text-dim);margin:4px 0;word-break:break-all;">' + escapeHtml((t.prompt || '').slice(0, 80)) + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:8px;">' +
        '<button class="ck-btn-sm" data-sact="edit" data-idx="' + i + '">编辑</button>' +
        '<button class="ck-btn-sm" data-sact="toggle" data-idx="' + i + '">' + (t.enabled ? '禁用' : '启用') + '</button>' +
        '<button class="ck-btn-sm" data-sact="del" data-idx="' + i + '" style="color:var(--ck-danger);">删除</button>' +
      '</div></div>';
  }).join('');
  listEl.querySelectorAll('button[data-sact]').forEach((btn: any) => {
    btn.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.idx, 10); const act = btn.dataset.sact;
      if (act === 'toggle') { tasks[i].enabled = !tasks[i].enabled; await save(); loadScheduledTasks(); }
      else if (act === 'del') { if (await ckConfirm('删除定时任务「' + (tasks[i].name || '') + '」？')) { tasks.splice(i, 1); await save(); loadScheduledTasks(); } }
      else if (act === 'edit') openEdit(i);
    });
  });
}

async function save(): Promise<void> { try { await (api as any).saveScheduledTasks(tasks); } catch (_) {} }

function openEdit(idx: number): void {
  const t = idx >= 0 ? tasks[idx] : { id: 'task_' + Date.now(), name: '', time: '09:00', enabled: true, prompt: '', lastRun: '' };
  (document.getElementById('sched-edit-idx') as any).value = String(idx);
  (document.getElementById('sched-edit-name') as any).value = t.name || '';
  (document.getElementById('sched-edit-time') as any).value = t.time || '09:00';
  (document.getElementById('sched-edit-prompt') as any).value = t.prompt || '';
  (document.getElementById('sched-edit') as any).style.display = 'block';
}
function closeEdit(): void { (document.getElementById('sched-edit') as any).style.display = 'none'; }

document.getElementById('sched-add')?.addEventListener('click', () => openEdit(-1));
document.getElementById('sched-edit-cancel')?.addEventListener('click', closeEdit);
document.getElementById('sched-edit-save')?.addEventListener('click', async () => {
  const val = (id: string) => ((document.getElementById(id) as any).value || '').trim();
  const idx = parseInt(val('sched-edit-idx'), 10);
  const name = val('sched-edit-name'); const time = val('sched-edit-time'); const pr = val('sched-edit-prompt');
  if (!name || !/^\d{1,2}:\d{2}$/.test(time) || !pr) { alert('请填名称、正确时间(HH:MM)、提示词'); return; }
  const t = idx >= 0 ? tasks[idx] : { id: 'task_' + Date.now(), lastRun: '' };
  t.name = name; t.time = time; t.prompt = pr; t.enabled = true;
  if (idx >= 0) tasks[idx] = t; else tasks.push(t);
  await save(); closeEdit(); loadScheduledTasks();
});

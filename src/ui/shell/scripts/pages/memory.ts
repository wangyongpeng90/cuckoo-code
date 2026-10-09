/**
 * 长期记忆页：查看/筛选/编辑/置顶/删除/导入导出。
 */
import { api, escapeHtml, ckConfirm, ckAlert } from '../shared.js';

let memories: any[] = [];
let filter = 'all';
let groupByDate = true;

/** 把时间戳归为"日期分组"标签 */
function dateGroupLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((today0 - day0) / 86400000);
  const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
  if (diffDays === 0) return '今天 · ' + md;
  if (diffDays === 1) return '昨天 · ' + md;
  if (diffDays < 7) return diffDays + ' 天前 · ' + md;
  return d.getFullYear() + '年' + md;
}

/** 渲染单条记忆的 HTML */
function renderItem(m: any): string {
  const pin = m.pinned ? '📌 ' : '';
  const tags = (m.tags || []).map((t: string) => '#' + escapeHtml(t)).join(' ');
  return '<div class="ck-skill-item">' +
    '<div class="ck-skill-top"><span class="ck-skill-name">' + pin + escapeHtml(m.name || '未命名') + '</span>' +
    '<span style="font-size:11px;color:var(--ck-text-2);">' + (TYPE_LABEL[m.type] || m.type) + ' · 用' + (m.accessCount || 0) + '次</span></div>' +
    '<div style="font-size:12px;color:var(--ck-text-dim);margin:4px 0;word-break:break-all;">' + escapeHtml((m.content || '').slice(0, 120)) + '</div>' +
    (tags ? '<div style="font-size:11px;color:var(--ck-accent);margin:2px 0;">' + tags + '</div>' : '') +
    '<div class="ck-mem-actions">' +
      '<button class="ck-btn-sm" data-mact="edit" data-id="' + m.id + '">编辑</button>' +
      '<button class="ck-btn-sm" data-mact="pin" data-id="' + m.id + '">' + (m.pinned ? '取消置顶' : '置顶') + '</button>' +
      '<button class="ck-btn-sm ck-btn-danger" data-mact="del" data-id="' + m.id + '">删除</button>' +
    '</div></div>';
}

/** 绑定列表里按钮的事件 */
function bindItemEvents(listEl: HTMLElement): void {
  listEl.querySelectorAll('button[data-mact]').forEach((btn: any) => {
    btn.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id); const act = btn.dataset.mact;
      const m = memories.find((x) => x.id === id);
      if (!m) return;
      if (act === 'pin') { m.pinned = !m.pinned; await (api as any).updateMemory(m); loadMemories(); }
      else if (act === 'del') { if (await ckConfirm('删除记忆「' + (m.name || '') + '」？')) { await (api as any).deleteMemory(id); loadMemories(); } }
      else if (act === 'edit') openEdit(m);
    });
  });
}

const TYPE_LABEL: Record<string, string> = {
  user: '画像', feedback: '反馈', topic: '话题', reference: '资料',
};

export async function loadMemories(): Promise<void> {
  const listEl = document.getElementById('mem-list');
  if (!listEl || !(api as any).listMemories) return;
  try {
    const r: any = await (api as any).listMemories();
    memories = (r && r.success && Array.isArray(r.memories)) ? r.memories : [];
    render();
  } catch (_) { listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>'; }
}

function render(): void {
  const listEl = document.getElementById('mem-list')!;
  const shown = filter === 'all' ? memories : memories.filter((m) => m.type === filter);
  // 计数徽标
  const countEl = document.getElementById('mem-count');
  if (countEl) countEl.textContent = shown.length ? (shown.length + ' 条') : '';
  // 分段控件选中态
  document.querySelectorAll('#mem-filter-seg > button').forEach((b: any) => {
    b.classList.toggle('ck-seg-on', b.dataset.memFilter === filter);
  });
  document.querySelectorAll('#mem-group-seg > button').forEach((b: any) => {
    const on = (b.dataset.memGroup === 'date') === groupByDate;
    b.classList.toggle('ck-seg-on', on);
  });
  if (!shown.length) {
    listEl.innerHTML = '<div class="ck-list-empty">暂无记忆<br>AI 会在对话中自动保存</div>';
    return;
  }
  // 置顶优先，其次最近更新
  const sorted = [...shown].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

  if (!groupByDate) {
    listEl.innerHTML = sorted.map(renderItem).join('');
    bindItemEvents(listEl);
    return;
  }

  // 按创建日期分组（今天/昨天/N天前/年月），每组显示小计
  const groups: { key: string; order: number; items: any[] }[] = [];
  const map = new Map<string, { key: string; order: number; items: any[] }>();
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const m of sorted) {
    const key = dateGroupLabel(m.createdAt || m.updatedAt || 0);
    const d = new Date(m.createdAt || m.updatedAt || 0);
    const day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const order = -Math.round((today0 - day0) / 86400000); // 越新 order 越大
    let g = map.get(key);
    if (!g) { g = { key, order, items: [] }; map.set(key, g); groups.push(g); }
    g.items.push(m);
  }
  groups.sort((a, b) => b.order - a.order);
  listEl.innerHTML = groups.map((g) => {
    return '<div class="ck-mem-group">' +
      '<div class="ck-mem-group-head">' + escapeHtml(g.key) +
      ' <span style="color:var(--ck-text-2);font-weight:normal;">（' + g.items.length + ' 条）</span></div>' +
      g.items.map(renderItem).join('') +
      '</div>';
  }).join('');
  bindItemEvents(listEl);
}

function openEdit(m: any): void {
  (document.getElementById('mem-edit-id') as any).value = m ? String(m.id) : '';
  (document.getElementById('mem-edit-type') as any).value = m ? m.type : 'user';
  (document.getElementById('mem-edit-name') as any).value = m ? (m.name || '') : '';
  (document.getElementById('mem-edit-content') as any).value = m ? (m.content || '') : '';
  (document.getElementById('mem-edit-tags') as any).value = m && m.tags ? m.tags.join(',') : '';
  (document.getElementById('mem-edit') as any).style.display = 'block';
}
function closeEdit(): void { (document.getElementById('mem-edit') as any).style.display = 'none'; }

// 筛选
document.querySelectorAll('[data-mem-filter]').forEach((btn: any) => {
  btn.addEventListener('click', () => { filter = btn.dataset.memFilter; render(); });
});
// 分组开关
document.querySelectorAll('[data-mem-group]').forEach((btn: any) => {
  btn.addEventListener('click', () => { groupByDate = btn.dataset.memGroup === 'date'; render(); });
});
// 整理当天记忆
document.getElementById('mem-organize-today')?.addEventListener('click', async () => {
  if (!(api as any).triggerOrganizeTodayMemory) { await ckAlert('当前版本不支持'); return; }
  if (!(await ckConfirm('确定整理【今天】的记忆？\n\nAI 会分析今天对话，提炼要点保存为长期记忆。', '整理当天记忆'))) return;
  try { await (api as any).triggerOrganizeTodayMemory(); await ckAlert('已发送整理指令，稍后刷新查看'); } catch (e: any) { await ckAlert('失败: ' + (e.message || e)); }
});
document.getElementById('mem-edit-cancel')?.addEventListener('click', closeEdit);
document.getElementById('mem-edit-save')?.addEventListener('click', async () => {
  const val = (id: string) => ((document.getElementById(id) as any).value || '').trim();
  const id = val('mem-edit-id');
  const type = (document.getElementById('mem-edit-type') as any).value;
  const name = val('mem-edit-name');
  const content = val('mem-edit-content');
  const tags = val('mem-edit-tags').split(',').map((s: string) => s.trim()).filter(Boolean);
  if (!name || !content) { await ckAlert('标题、内容不能为空'); return; }
  if (id) {
    const m = memories.find((x) => x.id === Number(id));
    if (m) { Object.assign(m, { type, name, content, tags }); await (api as any).updateMemory(m); }
  } else {
    await (api as any).saveMemory({ type, name, content, tags });
  }
  closeEdit(); loadMemories();
});

// 导出
document.getElementById('mem-export')?.addEventListener('click', async () => {
  const r: any = await (api as any).exportMemories();
  if (!r || !r.success) { await ckAlert('导出失败'); return; }
  const blob = new Blob([JSON.stringify(r.memories, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cuckoo-memories.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// 导入
document.getElementById('mem-import')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) { await ckAlert('JSON 格式错误（应为数组）'); return; }
      const res: any = await (api as any).importMemories(arr);
      if (res && res.success) { await ckAlert('已导入 ' + res.count + ' 条记忆'); loadMemories(); }
      else await ckAlert('导入失败: ' + ((res && res.error) || '未知'));
    } catch (e: any) { await ckAlert('解析失败: ' + e.message); }
  };
  input.click();
});

// 其他窗口改了记忆 → 同步刷新
if ((api as any).onMemoriesChanged) {
  (api as any).onMemoriesChanged(() => { try { loadMemories(); } catch (_) {} });
}

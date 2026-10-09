/**
 * 技能页：已安装管理（发送/禁用/编辑）+ SkillHub 在线市场（搜索/安装）。
 * 编辑用模态弹窗（#skill-modal）；悬停技能名显示简介浮层。
 */
import { api, ckAlert, ckConfirm, escapeHtml, escapeAttr } from '../shared.js';

let cachedInstalled: any[] = [];
let cachedMarket: any[] = [];
let editingId: string | null = null;

export async function loadSkills(): Promise<void> {
  showInstalledView();
  await renderInstalledList();
}

function showInstalledView(): void {
  const ins = document.getElementById('skill-view-installed');
  const mkt = document.getElementById('skill-view-market');
  if (ins) ins.style.display = '';
  if (mkt) mkt.style.display = 'none';
}

function showMarketView(): void {
  const ins = document.getElementById('skill-view-installed');
  const mkt = document.getElementById('skill-view-market');
  if (ins) ins.style.display = 'none';
  if (mkt) mkt.style.display = '';
  renderMarketList();
}

// ===== 悬停简介浮层 =====
let tipEl: any = null;
function ensureTip(): any {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.style.cssText = 'position:fixed;z-index:99999;max-width:300px;padding:8px 10px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:12px;line-height:1.5;color:#333;white-space:pre-wrap;pointer-events:none;display:none;';
  document.body.appendChild(tipEl);
  return tipEl;
}
function showTip(target: any, text: string): void {
  if (!text) return;
  const t = ensureTip();
  t.textContent = text;
  t.style.display = 'block';
  const r = target.getBoundingClientRect();
  let top = r.bottom + 6;
  let left = r.left;
  const maxLeft = window.innerWidth - t.offsetWidth - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;
  if (top + t.offsetHeight > window.innerHeight - 8) top = r.top - t.offsetHeight - 6;
  t.style.top = top + 'px';
  t.style.left = left + 'px';
}
function hideTip(): void {
  if (tipEl) tipEl.style.display = 'none';
}

/** 渲染已安装技能列表：名称 + 绿点 + [发送][禁用/启用][编辑] */
async function renderInstalledList(): Promise<void> {
  const listEl = document.getElementById('skill-list');
  if (!listEl || !api.listAppSkills) return;
  listEl.innerHTML = '<div class="ck-list-empty">加载中…</div>';
  try {
    const r = await api.listAppSkills();
    const skills: any[] = (r && r.success) ? r.skills : [];
    cachedInstalled = skills;
    if (!skills.length) {
      listEl.innerHTML = '<div class="ck-list-empty">还没有安装技能<br>点上方「市场」搜索安装，或点 + 新建</div>';
      return;
    }
    listEl.innerHTML = skills.map((s) => {
      const name = s.displayName || s.name || s.id;
      return '<div class="skill-row" data-skill="' + escapeAttr(s.id) + '">' +
        '<div class="skill-row-head">' +
          '<span class="skill-row-name" data-tip="' + escapeAttr(s.description || '') + '">' + escapeHtml(name) + '</span>' +
          '<span class="skill-row-dot' + (s.enabled ? ' on' : '') + '" title="' + (s.enabled ? '已启用' : '已禁用') + '"></span>' +
        '</div>' +
        '<div class="skill-row-actions">' +
          '<button class="skill-row-btn primary" data-send="' + escapeAttr(s.id) + '">发送</button>' +
          '<button class="skill-row-btn" data-toggle="' + escapeAttr(s.id) + '">' + (s.enabled ? '禁用' : '启用') + '</button>' +
          '<button class="skill-row-btn" data-edit="' + escapeAttr(s.id) + '">编辑</button>' +
        '</div>' +
      '</div>';
    }).join('');

    listEl.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => showTip(el, (el as any).dataset.tip));
      el.addEventListener('mouseleave', hideTip);
    });

    listEl.querySelectorAll('[data-send]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as any).dataset.send;
        const s = cachedInstalled.filter((x) => x.id === id)[0];
        if (!s) return;
        const name = s.displayName || s.name || s.id;
        if (api.appendSnippet) {
          try { await api.appendSnippet('请使用 ' + name + ' 技能'); } catch (_) { /* ignore */ }
        }
      });
    });

    listEl.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as any).dataset.toggle;
        const s = cachedInstalled.filter((x) => x.id === id)[0];
        if (!s || !api.setSkillEnabled) return;
        const r = await api.setSkillEnabled(id, !s.enabled);
        if (!r || !r.success) { await ckAlert((r && r.error) || '操作失败'); return; }
        await renderInstalledList();
      });
    });

    listEl.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as any).dataset.edit;
        const s = cachedInstalled.filter((x) => x.id === id)[0];
        if (s) openSkillModal(s);
      });
    });
  } catch (_) {
    listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>';
  }
}

// ===== 技能编辑弹窗 =====
function openSkillModal(s: any): void {
  editingId = s.id;
  const mask = document.getElementById('skill-modal');
  if (!mask) return;
  const titleEl = document.getElementById('skill-modal-title');
  if (titleEl) titleEl.textContent = '编辑技能';
  (document.getElementById('skill-f-name') as any).value = s.name || '';
  (document.getElementById('skill-f-display') as any).value = s.displayName || '';
  (document.getElementById('skill-f-desc') as any).value = s.description || '';
  (document.getElementById('skill-f-license') as any).value = s.license || '';
  (document.getElementById('skill-f-tools') as any).value = Array.isArray(s.allowedTools) ? s.allowedTools.join(' ') : '';
  (document.getElementById('skill-f-content') as any).value = s.content || '';
  const delBtn = document.getElementById('skill-f-delete');
  if (delBtn) delBtn.style.display = s.id ? '' : 'none';
  mask.classList.remove('cuckoo-hidden');
}

function closeSkillModal(): void {
  const mask = document.getElementById('skill-modal');
  if (mask) mask.classList.add('cuckoo-hidden');
  editingId = null;
}

async function saveSkillModal(): Promise<void> {
  const name = String((document.getElementById('skill-f-name') as any).value || '').trim();
  const displayName = String((document.getElementById('skill-f-display') as any).value || '').trim();
  const description = String((document.getElementById('skill-f-desc') as any).value || '').trim();
  const license = String((document.getElementById('skill-f-license') as any).value || '').trim();
  const toolsRaw = String((document.getElementById('skill-f-tools') as any).value || '').trim();
  const content = String((document.getElementById('skill-f-content') as any).value || '').trim();
  if (!name) { await ckAlert('名称不能为空'); return; }
  if (!description) { await ckAlert('描述不能为空'); return; }
  if (!content) { await ckAlert('正文不能为空'); return; }
  const allowedTools = toolsRaw ? toolsRaw.split(/\s+/).filter(Boolean) : [];
  if (!api.upsertSkill) return;
  const r = await api.upsertSkill({ id: editingId, name, displayName, description, license, allowedTools, content });
  if (!r || !r.success) { await ckAlert((r && r.error) || '保存失败'); return; }
  closeSkillModal();
  await renderInstalledList();
}

async function deleteSkillModal(): Promise<void> {
  if (!editingId) return;
  if (!(await ckConfirm('确定删除技能「' + editingId + '」？\n\n技能目录与启用状态都会被删除。', '删除技能'))) return;
  if (!api.removeSkill) return;
  const r = await api.removeSkill(editingId);
  if (!r || !r.success) { await ckAlert((r && r.error) || '删除失败'); return; }
  closeSkillModal();
  await renderInstalledList();
}

/** 渲染市场列表：名称 + [安装] */
function renderMarketList(): void {
  const listEl = document.getElementById('skill-market-list');
  if (!listEl) return;
  if (!cachedMarket.length) {
    listEl.innerHTML = '<div class="ck-list-empty">输入关键词搜索</div>';
    return;
  }
  listEl.innerHTML = cachedMarket.map((s) => {
    const name = s.displayName || s.name || s.slug;
    return '<div class="skill-row">' +
      '<div class="skill-row-head" style="margin-bottom:0;">' +
        '<span class="skill-row-name" data-tip="' + escapeAttr(s.summary || '') + '">' + escapeHtml(name) + '</span>' +
        '<button class="skill-row-btn primary" data-install="' + escapeAttr(s.namespace + '|' + s.slug + '|' + name) + '">安装</button>' +
      '</div>' +
    '</div>';
  }).join('');

  listEl.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mouseenter', () => showTip(el, (el as any).dataset.tip));
    el.addEventListener('mouseleave', hideTip);
  });

  listEl.querySelectorAll('[data-install]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const parts = String((btn as any).dataset.install).split('|');
      await installFromMarket(parts[0], parts[1], parts[2]);
    });
  });
}

async function installFromMarket(namespace: string, slug: string, displayName: string): Promise<void> {
  const ok = await ckConfirm('确定安装技能「' + displayName + '」？\n\n从 SkillHub 下载到本地技能目录。', '安装技能');
  if (!ok) return;
  if (!api.installSkill) return;
  const listEl = document.getElementById('skill-market-list');
  if (listEl) listEl.innerHTML = '<div class="ck-list-empty">安装中…</div>';
  try {
    const r = await api.installSkill(slug, namespace, displayName);
    if (!r || !r.success) {
      await ckAlert((r && r.error) || '安装失败', '安装失败');
      renderMarketList();
      return;
    }
    await ckAlert('已安装：' + displayName, '安装完成');
    renderMarketList();
  } catch (err: any) {
    await ckAlert('安装失败: ' + (err && err.message), '安装失败');
    renderMarketList();
  }
}

async function doSearch(): Promise<void> {
  const input = document.getElementById('skill-search-input') as any;
  const listEl = document.getElementById('skill-market-list');
  const keyword = input ? String(input.value || '').trim() : '';
  if (!listEl || !api.searchSkills) return;
  listEl.innerHTML = '<div class="ck-list-empty">搜索中…</div>';
  try {
    const r = await api.searchSkills(keyword, 1, 50);
    if (!r || !r.success) {
      cachedMarket = [];
      listEl.innerHTML = '<div class="ck-list-empty">' + escapeHtml((r && r.error) || '搜索失败') + '</div>';
      return;
    }
    cachedMarket = r.skills || [];
    renderMarketList();
  } catch (err: any) {
    cachedMarket = [];
    listEl.innerHTML = '<div class="ck-list-empty">搜索失败: ' + escapeHtml(err && err.message) + '</div>';
  }
}

/** 新建技能：打开空白编辑弹窗 */
function createSkill(): void {
  openSkillModal({ id: '', name: '', displayName: '', description: '', license: '', allowedTools: [], content: '' });
  const titleEl = document.getElementById('skill-modal-title');
  if (titleEl) titleEl.textContent = '新建技能';
  const delBtn = document.getElementById('skill-f-delete');
  if (delBtn) delBtn.style.display = 'none';
}

document.getElementById('skill-refresh')?.addEventListener('click', () => { loadSkills(); });
document.getElementById('skill-new')?.addEventListener('click', createSkill);
document.getElementById('skill-goto-market')?.addEventListener('click', showMarketView);
document.getElementById('skill-back')?.addEventListener('click', showInstalledView);
document.getElementById('skill-search-btn')?.addEventListener('click', doSearch);
document.getElementById('skill-search-input')?.addEventListener('keydown', (e: any) => {
  if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
});
document.getElementById('skill-f-save')?.addEventListener('click', saveSkillModal);
document.getElementById('skill-f-cancel')?.addEventListener('click', closeSkillModal);
document.getElementById('skill-f-delete')?.addEventListener('click', deleteSkillModal);
document.getElementById('skill-modal')?.addEventListener('click', (e: any) => {
  if (e.target && e.target.id === 'skill-modal') closeSkillModal();
});

/**
 * Skill（技能）管理浮动面板：市场搜索 + 已安装管理 + 详情展示
 */
import { showToast, showConfirmDialog } from '../panel.js';

/** 当前 Tab：'market' | 'installed' */
let currentTab: 'market' | 'installed' = 'installed';
/** 已安装列表缓存 */
let cachedInstalled: any[] = [];
/** 市场搜索结果缓存 */
let cachedMarket: any[] = [];
/** 当前选中的项（市场或已安装） */
let selectedItem: any = null;
/** 当前详情数据 */
let currentDetail: any = null;

/** HTML 转义 */
function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 切换 Tab */
function switchTab(tab: 'market' | 'installed') {
  currentTab = tab;
  selectedItem = null;
  currentDetail = null;
  document.querySelectorAll('.cuckoo-skill-tab').forEach(el => {
    el.classList.toggle('cuckoo-skill-tab-active', (el as any).dataset.tab === tab);
  });
  const searchRow = document.getElementById('cuckoo-skill-search-row');
  if (searchRow) (searchRow as any).style.display = tab === 'market' ? 'flex' : 'none';
  clearSkillDetail();
  if (tab === 'market') {
    renderMarketList();
  } else {
    renderInstalledList();
  }
}

/** 渲染已安装列表 */
async function renderInstalledList() {
  const list = document.getElementById('cuckoo-skill-list');
  if (!list) return;
  try {
    const res = await (window as any).electronAPI.listSkills();
    const skills = res && res.success ? res.skills : [];
    cachedInstalled = skills;
    if (!skills || skills.length === 0) {
      list.innerHTML = '<div class="cuckoo-session-empty">暂无已安装技能</div>';
      return;
    }
    list.innerHTML = skills.map((s: any) => {
      const dotColor = s.enabled ? '#4ade80' : '#5d6280';
      return '<div class="cuckoo-skill-item" data-skill-id="' + escapeHtml(s.id) + '">' +
        '<span class="cuckoo-window-name">' + escapeHtml(s.name) + '</span>' +
        '<span class="cuckoo-mcp-dot" style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></span>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.cuckoo-skill-item').forEach(el => {
      el.addEventListener('click', () => selectInstalled((el as any).dataset.skillId));
    });
  } catch (err) {
    list.innerHTML = '<div class="cuckoo-session-empty">加载失败</div>';
  }
}

/** 选中已安装技能，显示详情 */
function selectInstalled(id: string) {
  const skill = cachedInstalled.find((s: any) => s.id === id);
  if (!skill) return;
  selectedItem = { type: 'installed', data: skill };
  highlight('data-skill-id', id);
  renderInstalledDetail(skill);
}

/** 渲染已安装技能详情（含编辑表单） */
function renderInstalledDetail(skill: any) {
  const detail = document.getElementById('cuckoo-skill-detail');
  if (!detail) return;
  detail.innerHTML =
    '<div class="cuckoo-skill-detail-head">' +
      '<span class="cuckoo-skill-detail-name">' + escapeHtml(skill.name) + '</span>' +
      '<span class="cuckoo-skill-badge">' + (skill.enabled ? '已启用' : '已禁用') + '</span>' +
    '</div>' +
    '<div class="cuckoo-skill-detail-meta">' +
      (skill.license ? '<span>许可证: ' + escapeHtml(skill.license) + '</span>' : '') +
      (skill.allowedTools && skill.allowedTools.length ? '<span>工具: ' + escapeHtml(skill.allowedTools.join(' ')) + '</span>' : '') +
    '</div>' +
    '<div class="cuckoo-skill-detail-desc">' + escapeHtml(skill.description) + '</div>' +
    '<details class="cuckoo-skill-detail-fold"><summary>查看技能正文</summary>' +
      '<pre class="cuckoo-skill-detail-body">' + escapeHtml(skill.content) + '</pre>' +
    '</details>' +
    '<div class="cuckoo-actions">' +
      '<button id="cuckoo-skill-toggle" class="cuckoo-btn cuckoo-btn-secondary">' + (skill.enabled ? '禁用' : '启用') + '</button>' +
      '<button id="cuckoo-skill-delete" class="cuckoo-btn cuckoo-btn-secondary">删除</button>' +
    '</div>';
  document.getElementById('cuckoo-skill-toggle')?.addEventListener('click', () => toggleSkillEnabled(skill));
  document.getElementById('cuckoo-skill-delete')?.addEventListener('click', () => deleteSkill(skill));
}

/** 清空详情区 */
function clearSkillDetail() {
  const detail = document.getElementById('cuckoo-skill-detail');
  if (detail) detail.innerHTML = '<div class="cuckoo-session-empty">选择左侧条目查看详情</div>';
}

/** 渲染市场搜索结果 */
async function renderMarketList() {
  const list = document.getElementById('cuckoo-skill-list');
  if (!list) return;
  if (cachedMarket.length === 0) {
    list.innerHTML = '<div class="cuckoo-session-empty">输入关键词搜索</div>';
    return;
  }
  list.innerHTML = cachedMarket.map((s: any) => {
    const installed = cachedInstalled.some((x: any) => x.id === (s.slug || ''));
    return '<div class="cuckoo-skill-item" data-market-key="' + escapeHtml(s.namespace + '/' + s.slug) + '">' +
      '<span class="cuckoo-window-name">' + escapeHtml(s.name) + '</span>' +
      (installed ? '<span class="cuckoo-skill-installed-tag">已装</span>' : '') +
    '</div>';
  }).join('');
  list.querySelectorAll('.cuckoo-skill-item').forEach(el => {
    el.addEventListener('click', () => selectMarket((el as any).dataset.marketKey));
  });
}

/** 执行市场搜索 */
async function doSearch() {
  const input = document.getElementById('cuckoo-skill-search-input') as any;
  const keyword = input ? input.value.trim() : '';
  const list = document.getElementById('cuckoo-skill-list');
  if (list) list.innerHTML = '<div class="cuckoo-session-empty">搜索中…</div>';
  try {
    const res = await (window as any).electronAPI.searchSkills(keyword, 1, 30);
    cachedMarket = res && res.success ? res.skills : [];
    if (res && res.success) {
      showToast('找到 ' + (res.total || cachedMarket.length) + ' 个技能', 2000);
    } else {
      showToast('搜索失败: ' + ((res && res.error) || '未知'), 3000);
    }
    await renderMarketList();
  } catch (err: any) {
    if (list) list.innerHTML = '<div class="cuckoo-session-empty">搜索失败</div>';
  }
}

/** 选中市场技能，加载详情 */
async function selectMarket(key: string) {
  const item = cachedMarket.find((s: any) => (s.namespace + '/' + s.slug) === key);
  if (!item) return;
  selectedItem = { type: 'market', data: item };
  highlight('data-market-key', key);
  const detail = document.getElementById('cuckoo-skill-detail');
  if (detail) detail.innerHTML = '<div class="cuckoo-session-empty">加载详情中…</div>';
  try {
    const res = await (window as any).electronAPI.getSkillDetail(item.slug, item.namespace);
    if (res && res.success) {
      currentDetail = res.detail;
      renderMarketDetail(res.detail, item);
    } else {
      if (detail) detail.innerHTML = '<div class="cuckoo-session-empty">详情加载失败</div>';
    }
  } catch (err) {
    if (detail) detail.innerHTML = '<div class="cuckoo-session-empty">详情加载失败</div>';
  }
}

/** 渲染市场技能详情 */
function renderMarketDetail(detail: any, item: any) {
  const el = document.getElementById('cuckoo-skill-detail');
  if (!el) return;
  const stats = detail.stats || {};
  const isInstalled = cachedInstalled.some((x: any) => x.id === (item.slug || ''));
  el.innerHTML =
    '<div class="cuckoo-skill-detail-head">' +
      '<span class="cuckoo-skill-detail-name">' + escapeHtml(detail.name || item.name) + '</span>' +
      (item.verified ? '<span class="cuckoo-skill-badge cuckoo-skill-verified">认证</span>' : '') +
    '</div>' +
    '<div class="cuckoo-skill-detail-meta">' +
      '<span>@' + escapeHtml(detail.namespace || item.namespace) + '/' + escapeHtml(detail.slug || item.slug) + '</span>' +
      (detail.version ? '<span>v' + escapeHtml(detail.version) + '</span>' : '') +
      '<span>↓ ' + (stats.downloads || item.downloads || 0) + '</span>' +
      (stats.stars != null ? '<span>★ ' + stats.stars + '</span>' : '') +
    '</div>' +
    '<div class="cuckoo-skill-detail-desc">' + escapeHtml(detail.summary || item.summary || '') + '</div>' +
    '<div class="cuckoo-actions">' +
      (isInstalled
        ? '<button class="cuckoo-btn cuckoo-btn-secondary" disabled>已安装</button>'
        : '<button id="cuckoo-skill-install" class="cuckoo-btn cuckoo-btn-primary">安装</button>') +
    '</div>';
  document.getElementById('cuckoo-skill-install')?.addEventListener('click', () => installSkill(item));
}

/** 从市场安装技能 */
async function installSkill(item: any) {
  const btn = document.getElementById('cuckoo-skill-install') as any;
  if (btn) { btn.disabled = true; btn.textContent = '安装中…'; }
  try {
    const res = await (window as any).electronAPI.installSkill(item.slug, item.namespace);
    if (res && res.success) {
      showToast('已安装: ' + (res.skill ? res.skill.name : item.name), 2500);
      await renderInstalledList();
      // 切到已安装 Tab 并选中新技能
      switchTab('installed');
      if (res.skill) selectInstalled(res.skill.id);
    } else {
      showToast('安装失败: ' + ((res && res.error) || '未知'), 3500);
      if (btn) { btn.disabled = false; btn.textContent = '安装'; }
    }
  } catch (err: any) {
    showToast('安装失败: ' + (err.message || err), 3500);
    if (btn) { btn.disabled = false; btn.textContent = '安装'; }
  }
}

/** 高亮选中项 */
function highlight(attr: string, value: string) {
  document.querySelectorAll('.cuckoo-skill-item').forEach(el => {
    el.classList.toggle('cuckoo-item-active', (el as any).getAttribute(attr) === value);
  });
}

/** 切换启用状态 */
async function toggleSkillEnabled(skill: any) {
  try {
    await (window as any).electronAPI.setSkillEnabled(skill.id, !skill.enabled);
    showToast(skill.enabled ? '已禁用' : '已启用', 1800);
    await renderInstalledList();
    selectInstalled(skill.id);
  } catch (err: any) {
    showToast('操作失败: ' + (err.message || err), 3000);
  }
}

/** 删除已安装技能 */
async function deleteSkill(skill: any) {
  const confirmed = await showConfirmDialog(
    '确定删除技能「' + skill.name + '」吗？此操作不可恢复。',
    { okText: '删除', showCancel: true, cancelText: '取消' }
  );
  if (!confirmed) return;
  try {
    const res = await (window as any).electronAPI.removeSkill(skill.id);
    if (res && res.success) {
      showToast('已删除', 2000);
      clearSkillDetail();
      await renderInstalledList();
    } else {
      showToast('删除失败', 3000);
    }
  } catch (err: any) {
    showToast('删除失败: ' + (err.message || err), 3000);
  }
}

/** 打开 Skill 管理面板 */
function openSkillManager() {
  const panel = document.getElementById('cuckoo-skill-manager');
  if (panel) {
    panel.classList.remove('cuckoo-hidden');
    cachedMarket = [];
    switchTab('installed');
    // 预加载已安装列表供市场列表判断"已装"
    renderInstalledList();
  }
}

/** 关闭 Skill 管理面板 */
function closeSkillManager() {
  const panel = document.getElementById('cuckoo-skill-manager');
  if (panel) panel.classList.add('cuckoo-hidden');
}

export {
  openSkillManager,
  closeSkillManager,
  switchTab,
  doSearch,
  renderInstalledList,
  renderMarketList,
  clearSkillDetail,
};

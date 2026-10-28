/**
 * 技能页：列出技能，点击追加"请使用 xxx 技能"；每项带开关决定是否加入上下文。
 */
import { api, escapeHtml, ckAlert } from '../shared.js';
import { addRecent } from '../recent.js';

export async function loadSkills(): Promise<void> {
  const listEl = document.getElementById('skill-list');
  if (!listEl || !api.listSkills) return;
  try {
    const r = await api.listSkills();
    const skills = (r && r.success) ? r.skills : [];
    if (!skills || skills.length === 0) {
      listEl.innerHTML = '<div class="ck-list-empty">未发现技能<br>（.cuckoo/skills/ 或 ~/.cuckoo/skills/）</div>';
      return;
    }
    const skillCard = (s: any) => {
      const on = s.enabled !== false;
      return '<div class="ck-skill-item' + (on ? '' : ' ck-skill-off') + '" data-name="' + escapeHtml(s.name) + '" data-source="' + escapeHtml(s.source) + '">' +
        '<div class="ck-skill-top">' +
          '<span class="ck-skill-name">' + escapeHtml(s.name) + '</span>' +
          '<label class="ck-switch" title="' + (on ? '已加入上下文' : '不加入上下文') + '">' +
            '<input type="checkbox" class="ck-skill-toggle"' + (on ? ' checked' : '') + ' />' +
            '<span class="ck-switch-track"></span>' +
          '</label>' +
        '</div>' +
        '<div class="ck-skill-desc">' + escapeHtml(s.description || '（无描述）') + '</div>' +
      '</div>';
    };
    const userSkills = skills.filter((s: any) => s.source !== 'project');
    const projSkills = skills.filter((s: any) => s.source === 'project');
    let html = '';
    if (userSkills.length) html += '<div class="ck-mcp-group-title">用户级</div>' + userSkills.map(skillCard).join('');
    if (projSkills.length) html += '<div class="ck-mcp-group-title">项目级</div>' + projSkills.map(skillCard).join('');
    listEl.innerHTML = html;
    listEl.querySelectorAll('.ck-skill-item').forEach((el: any) => {
      el.addEventListener('click', async () => {
        // 已关闭的技能不加入上下文，点卡片不做任何事（不填提示词、不记最近使用）
        if (el.classList.contains('ck-skill-off')) return;
        if (api.appendSnippet) {
          try { await api.appendSnippet('请使用 ' + el.dataset.name + ' 技能'); } catch (_) { /* ignore */ }
        }
        addRecent('skill', el.dataset.name);
      });
    });
    // 开关：控制技能是否加入上下文（关闭后不注入系统提示词）
    listEl.querySelectorAll('.ck-skill-toggle').forEach((input: any) => {
      const label = input.closest('.ck-switch');
      // label 的点击会冒泡到卡片（触发"请使用技能"），这里截断
      if (label) label.addEventListener('click', (e: any) => e.stopPropagation());
      input.addEventListener('change', async (e: any) => {
        e.stopPropagation();
        const item = input.closest('.ck-skill-item');
        const name = item.dataset.name;
        const source = item.dataset.source;
        const on = input.checked;
        if (!api.setSkillEnabled) return;
        const r = await api.setSkillEnabled(name, source, on);
        if (!r || !r.success) {
          input.checked = !on; // 失败回滚，避免 UI 与真实状态不一致
          await ckAlert((r && r.error) || '保存失败');
          return;
        }
        item.classList.toggle('ck-skill-off', !on);
        if (label) label.title = on ? '已加入上下文' : '不加入上下文';
      });
    });
  } catch (_) {
    listEl.innerHTML = '<div class="ck-list-empty">加载失败</div>';
  }
}

document.getElementById('skill-refresh')?.addEventListener('click', loadSkills);

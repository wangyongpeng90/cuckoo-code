/**
 * 技能页（React 版）
 *
 * 迁移自 pages/skills.ts：
 * - 列出技能（用户级 / 项目级分组）
 * - 点击 → 追加"请使用 xxx 技能"
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api } from '../shared.js';
import { addRecent } from '../recent.js';

interface Skill { name: string; description?: string; source?: string; }

/** 技能条目 */
function SkillItem({ s, onClick }: { s: Skill; onClick: () => void }) {
  return createElement('div', { className: 'ck-skill-item', onClick },
    createElement('div', { className: 'ck-skill-top' },
      createElement('span', { className: 'ck-skill-name' }, s.name),
    ),
    createElement('div', { className: 'ck-skill-desc' }, s.description || '（无描述）'),
  );
}

/** 技能页 */
export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    if (!api.listSkills) { setSkills([]); return; }
    try {
      const r = await api.listSkills();
      setSkills((r && r.success ? r.skills : []) || []);
      setErr(false);
    } catch (_) { setErr(true); setSkills([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSkillClick = useCallback(async (name: string) => {
    if (api.appendSnippet) {
      try { await api.appendSnippet('请使用 ' + name + ' 技能'); } catch (_) { /* ignore */ }
    }
    addRecent('skill', name);
  }, []);

  const list = skills || [];
  const userSkills = list.filter((s) => s.source !== 'project');
  const projSkills = list.filter((s) => s.source === 'project');

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-actions' },
      createElement('span', { className: 'ck-set-group-title', style: { flex: 1 } }, '技能'),
      createElement('button', { className: 'ck-icon-btn', title: '刷新', onClick: load },
        createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
          createElement('path', { d: 'M21 3v6h-6' }),
        ),
      ),
    ),
    createElement('div', { className: 'ck-list' },
      skills === null ? createElement('div', { className: 'ck-list-empty' }, '加载中…')
        : err ? createElement('div', { className: 'ck-list-empty' }, '加载失败')
        : list.length === 0 ? createElement('div', { className: 'ck-list-empty' }, '未发现技能', createElement('br'), '（.cuckoo/skills/ 或 ~/.cuckoo/skills/）')
        : [
            userSkills.length ? createElement('div', { key: 'u-title', className: 'ck-mcp-group-title' }, '用户级') : null,
            ...userSkills.map((s) => createElement(SkillItem, { key: 'u-' + s.name, s, onClick: () => onSkillClick(s.name) })),
            projSkills.length ? createElement('div', { key: 'p-title', className: 'ck-mcp-group-title' }, '项目级') : null,
            ...projSkills.map((s) => createElement(SkillItem, { key: 'p-' + s.name, s, onClick: () => onSkillClick(s.name) })),
          ],
    ),
  );
}

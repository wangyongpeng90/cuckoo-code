/**
 * Agent 悬浮卡片：在 AI 页面左侧显示所有子代理及其运行状态
 * 数据来源：主进程 overlay-agent-updated 事件（bridge 转发）
 *
 * 仿左侧栏风格，支持拖动 + 收起。常驻显示所有已配置的 agent。
 */

/** agent 名称 → emoji */
const EMOJI_POOL = ['🙋', '🔍', '💻', '🤖', '🧠', '⚙️', '📊', '🧩', '🚀', '🛠️'];
function agentEmoji(name: string): string {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return EMOJI_POOL[h % EMOJI_POOL.length];
}
function esc(s: any): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
}

const POS_KEY = 'cuckoo-agent-float-pos';
const COLLAPSE_KEY = 'cuckoo-agent-float-collapsed';

/** 渲染卡片内容 */
function renderAgentFloat(agents: any[]): void {
  const card = document.getElementById('cuckoo-agent-float');
  if (!card) return;
  const list = document.getElementById('cuckoo-af-list');
  const count = document.getElementById('cuckoo-af-count');
  const arr = agents || [];
  if (count) count.textContent = String(arr.length);
  if (!list) return;
  if (arr.length === 0) {
    list.innerHTML = '<div class="cuckoo-af-empty">暂无子代理</div>';
    return;
  }
  list.innerHTML = arr.map((a: any) => {
    const working = !!a.working;
    const stateCls = working ? 'working' : 'idle';
    const stateText = working ? '工作中' : '已停止';
    const task = a.task ? '<div class="cuckoo-af-task" title="' + esc(a.task) + '">' + esc(a.task) + '</div>' : '';
    return '<div class="cuckoo-af-item ' + stateCls + '">' +
      '<span class="cuckoo-af-emoji">' + agentEmoji(a.name) + '</span>' +
      '<div class="cuckoo-af-info">' +
        '<div class="cuckoo-af-name" title="' + esc(a.name) + '">' + esc(a.name) + '</div>' +
        '<div class="cuckoo-af-state"><span class="cuckoo-af-dot"></span>' + stateText + '</div>' +
        task +
      '</div>' +
    '</div>';
  }).join('');
}

/** 恢复拖动位置 */
function restorePos(card: HTMLElement): void {
  try {
    const saved = localStorage.getItem(POS_KEY);
    if (saved) {
      const p = JSON.parse(saved);
      if (typeof p.left === 'number' && typeof p.top === 'number') {
        card.style.left = p.left + 'px';
        card.style.top = p.top + 'px';
        card.style.right = 'auto';
      }
    }
    if (localStorage.getItem(COLLAPSE_KEY) === '1') {
      card.classList.add('cuckoo-af-collapsed');
      const btn = document.getElementById('cuckoo-af-toggle');
      if (btn) btn.textContent = '+';
    }
  } catch (_) { /* ignore */ }
}

/** 初始化拖动 */
function initDrag(card: HTMLElement): void {
  const header = card.querySelector('.cuckoo-af-header') as HTMLElement;
  if (!header) return;
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  header.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.cuckoo-af-toggle')) return;
    dragging = true;
    const rect = card.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    const w = card.offsetWidth || 60;
    const h = card.offsetHeight || 40;
    const left = Math.max(0, Math.min(window.innerWidth - w, startLeft + (e.clientX - startX)));
    const top = Math.max(0, Math.min(window.innerHeight - h, startTop + (e.clientY - startY)));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: parseInt(card.style.left, 10), top: parseInt(card.style.top, 10) }));
    } catch (_) { /* ignore */ }
  });
}

/** 初始化 Agent 悬浮卡片（幂等：重复调用只生效一次） */
let _agentFloatInited = false;
function initAgentFloat(): void {
  if (_agentFloatInited) return;
  _agentFloatInited = true;
  const card = document.getElementById('cuckoo-agent-float');
  if (!card) { _agentFloatInited = false; return; }
  card.classList.remove('cuckoo-hidden');
  restorePos(card);
  initDrag(card);

  const toggle = document.getElementById('cuckoo-af-toggle');
  toggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = card.classList.toggle('cuckoo-af-collapsed');
    toggle.textContent = collapsed ? '+' : '−';
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  });

  const api = (window as any).electronAPI;
  if (api && api.onAgentUpdated) {
    try { api.onAgentUpdated((data: any) => { if (data) renderAgentFloat(data.agents); }); } catch (_) {}
  }
  if (api && api.getAgentStatus) {
    api.getAgentStatus().then((r: any) => { if (r && r.success) renderAgentFloat(r.agents); }).catch(() => {});
  }
}

export { initAgentFloat, renderAgentFloat };

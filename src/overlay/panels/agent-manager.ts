/**
 * Agent（子代理）管理浮动面板：列表渲染、配置加载/保存、打开/关闭
 * 参照 mcp-manager.ts 的实现风格。
 */
import { showToast, showConfirmDialog } from '../panel.js';

/** 当前选中的 agent id */
let selectedId: string | null = null;
/** 缓存的 agent 列表 */
let cachedAgents: any[] = [];

/** 加载 agent 列表并渲染 */
async function renderAgentList() {
  const list = document.getElementById('cuckoo-agent-list');
  if (!list) return;
  try {
    const res = await (window as any).electronAPI.listAgents();
    const agents = res && res.success ? res.agents : [];
    cachedAgents = agents;
    if (!agents || agents.length === 0) {
      list.innerHTML = '<div class="cuckoo-session-empty">暂无 Agent</div>';
      return;
    }
    list.innerHTML = agents.map((a: any) => {
      const dotColor = a.enabled ? '#4ade80' : '#5d6280';
      return '<div class="cuckoo-window-item cuckoo-agent-item" data-agent-id="' + a.id + '">' +
        '<span class="cuckoo-window-name">' + escapeHtml(a.name) + '</span>' +
        '<span class="cuckoo-mcp-dot" style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;" title="' + (a.enabled ? '已启用' : '已禁用') + '"></span>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.cuckoo-agent-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as any).dataset.agentId;
        selectAgent(id);
      });
      if ((el as any).dataset.agentId === selectedId) {
        el.classList.add('cuckoo-item-active');
      }
    });
  } catch (err) {
    list.innerHTML = '<div class="cuckoo-session-empty">加载失败</div>';
  }
}

function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 选中某个 agent，填充到右侧编辑区 */
function selectAgent(id: string) {
  const agent = cachedAgents.find((a: any) => a.id === id);
  if (!agent) return;
  selectedId = id;
  (document.getElementById('cuckoo-agent-id') as any).value = agent.id || '';
  (document.getElementById('cuckoo-agent-name') as any).value = agent.name || '';
  (document.getElementById('cuckoo-agent-desc') as any).value = agent.description || '';
  (document.getElementById('cuckoo-agent-tools') as any).value = (agent.tools || []).join(', ');
  (document.getElementById('cuckoo-agent-maxturns') as any).value = agent.maxTurns || '';
  (document.getElementById('cuckoo-agent-prompt') as any).value = agent.systemPrompt || '';
  const delBtn = document.getElementById('cuckoo-agent-delete');
  if (delBtn) (delBtn as any).style.display = '';
  // 高亮选中项
  document.querySelectorAll('.cuckoo-agent-item').forEach(el => {
    el.classList.toggle('cuckoo-item-active', (el as any).dataset.agentId === id);
  });
}

/** 清空编辑区，进入"新增"模式 */
function clearAgentForm() {
  selectedId = null;
  ['cuckoo-agent-id', 'cuckoo-agent-name', 'cuckoo-agent-desc', 'cuckoo-agent-tools', 'cuckoo-agent-maxturns', 'cuckoo-agent-prompt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) (el as any).value = '';
  });
  const delBtn = document.getElementById('cuckoo-agent-delete');
  if (delBtn) (delBtn as any).style.display = 'none';
  document.querySelectorAll('.cuckoo-agent-item').forEach(el => el.classList.remove('cuckoo-item-active'));
}

/** 保存当前编辑的 agent */
async function saveAgent() {
  const val = (id: string) => { const el = document.getElementById(id); return el ? (el as any).value : ''; };
  const name = val('cuckoo-agent-name').trim();
  const description = val('cuckoo-agent-desc').trim();
  const systemPrompt = val('cuckoo-agent-prompt').trim();
  if (!name) { showToast('Agent 名称不能为空', 3000); return; }
  if (!description) { showToast('Agent 描述不能为空', 3000); return; }
  if (!systemPrompt) { showToast('Agent 系统提示词不能为空', 3000); return; }
  const toolsRaw = val('cuckoo-agent-tools').trim();
  const maxTurnsRaw = val('cuckoo-agent-maxturns').trim();
  const agent: any = {
    id: val('cuckoo-agent-id').trim() || undefined,
    name,
    description,
    systemPrompt,
    tools: toolsRaw ? toolsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
    maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
  };
  try {
    const res = await (window as any).electronAPI.upsertAgent(agent);
    if (!res || !res.success) {
      showToast('保存失败: ' + ((res && res.error) || '未知错误'), 3500);
      return;
    }
    showToast('Agent 已保存', 2200);
    selectedId = res.agent ? res.agent.id : selectedId;
    await renderAgentList();
    if (selectedId) selectAgent(selectedId);
  } catch (err: any) {
    showToast('保存失败: ' + (err.message || err), 3500);
  }
}

/** 删除当前选中的 agent */
async function deleteAgent() {
  if (!selectedId) { showToast('请先选择一个 Agent', 2500); return; }
  const agent = cachedAgents.find((a: any) => a.id === selectedId);
  const confirmed = await showConfirmDialog(
    '确定删除 Agent「' + ((agent && agent.name) || selectedId) + '」吗？此操作不可恢复。',
    { okText: '删除', showCancel: true, cancelText: '取消' }
  );
  if (!confirmed) return;
  try {
    const res = await (window as any).electronAPI.removeAgent(selectedId);
    if (!res || !res.success) {
      showToast('删除失败', 3000);
      return;
    }
    showToast('已删除', 2000);
    clearAgentForm();
    await renderAgentList();
  } catch (err: any) {
    showToast('删除失败: ' + (err.message || err), 3000);
  }
}

/** 切换启用状态 */
async function toggleAgentEnabled() {
  if (!selectedId) { showToast('请先选择一个 Agent', 2500); return; }
  const agent = cachedAgents.find((a: any) => a.id === selectedId);
  if (!agent) return;
  try {
    await (window as any).electronAPI.setAgentEnabled(selectedId, !agent.enabled);
    showToast(agent.enabled ? '已禁用' : '已启用', 1800);
    await renderAgentList();
    selectAgent(selectedId);
  } catch (err: any) {
    showToast('操作失败: ' + (err.message || err), 3000);
  }
}

/** 打开 Agent 管理面板 */
function openAgentManager() {
  const panel = document.getElementById('cuckoo-agent-manager');
  if (panel) {
    panel.classList.remove('cuckoo-hidden');
    renderAgentList();
    clearAgentForm();
  }
}

/** 关闭 Agent 管理面板 */
function closeAgentManager() {
  const panel = document.getElementById('cuckoo-agent-manager');
  if (panel) panel.classList.add('cuckoo-hidden');
}

export {
  renderAgentList,
  selectAgent,
  clearAgentForm,
  saveAgent,
  deleteAgent,
  toggleAgentEnabled,
  openAgentManager,
  closeAgentManager,
};

/**
 * 窗口管理浮动面板：列表渲染、打开/关闭、生成文档
 * 由 events.ts 拆分而来（P4.5），逻辑保持不变。
 */
import { showToast } from '../panel.js';

/**
 * 渲染窗口列表（浮动管理面板内）
 */
async function renderWindowList() {
  const list = document.getElementById('cuckoo-window-list');
  if (!list) return;
  try {
    const res = await (window as any).electronAPI.listProfiles();
    const profiles = res && res.success ? res.profiles : [];
    if (!profiles || profiles.length === 0) {
      list.innerHTML = '<div class="cuckoo-session-empty">暂无窗口</div>';
      return;
    }
    // 获取平台名映射
    const providerMap: Record<string, string> = {};
    try {
      const pvRes = await (window as any).electronAPI.listProviders();
      if (pvRes && pvRes.success) {
        (pvRes.providers || []).forEach((pv: any) => { providerMap[pv.id] = pv.name; });
      }
    } catch (_) {}

    list.innerHTML = profiles.map((p: any) => {
      const pname = providerMap[p.providerId] || '平台';
      const checked = p.autoOpen === true ? ' checked' : '';
      return '<div class="cuckoo-window-item" data-profile-id="' + p.id + '">' +
        '<label class="cuckoo-window-auto" title="启动时默认打开此窗口">' +
          '<input type="checkbox" data-profile-id="' + p.id + '"' + checked + ' />' +
          '默认' +
        '</label>' +
        '<span class="cuckoo-window-left">' +
          '<span class="cuckoo-window-name">' + p.name + '</span>' +
          '<span class="cuckoo-window-sep">|</span>' +
          '<span class="cuckoo-window-status">' + pname + '</span>' +
        '</span>' +
        '<span class="cuckoo-window-del" data-profile-id="' + p.id + '" title="删除窗口">删除</span>' +
      '</div>';
    }).join('');
    // 绑定"默认打开"复选框
    list.querySelectorAll('.cuckoo-window-auto input').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        e.stopPropagation();
        const profileId = (cb as any).dataset.profileId;
        const on = (cb as any).checked;
        try {
          const r = await (window as any).electronAPI.setProfileAutoOpen(profileId, on);
          if (!r || !r.success) {
            showToast((r && r.error) || '设置失败', 3000);
            (cb as any).checked = !on; // 回滚
          }
        } catch (err: any) {
          showToast('设置失败: ' + (err.message || err), 3000);
          (cb as any).checked = !on;
        }
      });
      (cb as any).addEventListener('click', (e: any) => e.stopPropagation());
    });

    list.querySelectorAll('.cuckoo-window-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        // 点击删除按钮或复选框不触发切换
        if ((e.target as any).classList.contains('cuckoo-window-del')) return;
        if ((e.target as any).closest('.cuckoo-window-auto')) return;
        const profileId = (el as any).dataset.profileId;
        try {
          const r = await (window as any).electronAPI.openProfileWindow(profileId);
          if (r && r.success) {
            showToast(r.focused ? '已切换到该窗口' : '已打开窗口', 2000);
            closeWindowManager();
          } else {
            showToast((r && r.error) || '打开失败', 3000);
          }
        } catch (err: any) {
          showToast('打开窗口失败: ' + (err.message || err), 3000);
        }
      });
    });
    // 绑定删除按钮
    list.querySelectorAll('.cuckoo-window-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const profileId = (btn as any).dataset.profileId;
        try {
          const r = await (window as any).electronAPI.deleteProfileWindow(profileId);
          if (r && r.success) {
            showToast('已删除窗口', 2000);
            await renderWindowList();
          } else {
            showToast((r && r.error) || '删除失败', 3000);
          }
        } catch (err: any) {
          showToast('删除失败: ' + (err.message || err), 3000);
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="cuckoo-session-empty">加载失败</div>';
  }
}

/** 打开窗口管理浮动面板 */
function openWindowManager() {
  const panel = document.getElementById('cuckoo-window-manager');
  if (panel) {
    panel.classList.remove('cuckoo-hidden');
    renderWindowList();
  }
}

/** 关闭窗口管理浮动面板 */
function closeWindowManager() {
  const panel = document.getElementById('cuckoo-window-manager');
  if (panel) panel.classList.add('cuckoo-hidden');
}

/** 生成项目说明文档按钮点击处理 */
async function handleGenerateDoc(sendToChat: any) {
  const message = '根据当前项目生成一个类似 claude.md 的项目说明文件，并将文件放到当前项目 .cuckoo/CUCKOO.md';
  if (!(await sendToChat(message, '生成文档', 300))) {
    showToast('未找到输入框，请确保已打开聊天界面', 3000);
  }
}

export { renderWindowList, openWindowManager, closeWindowManager, handleGenerateDoc };
